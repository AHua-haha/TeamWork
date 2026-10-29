import { contextPageInput, checkContextPage, type ContextPageInput, type ContextPage } from '../../context-page.js';
import { imageContent, validateChatImages, type PreparedChatImage } from './chat-images.js';
import { type GroupContextMessage } from '../../agent/data/context.js';
import { finalAnswer } from '../../agent/final-answer.js';
import { parseMemberResponse } from '../member-response.js';
import { randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { MySqlStorage } from '../../../storage/mysql.js';
import { decode, encode } from '../../codec.js';
import type { MemberRecord, NewMember, StoredMember, TeamStore, MemberActivation, MemberActivationState } from './members.js';
import { defaultRunSettings, type WorkspaceModels } from '../../workspace/data/models.js';
import { generatedSource } from './member-config.js';
import { AppError, identity, position, type RunState } from '../../agent/data/model.js';
import { defaultMentionLimit, groupEntry, groupContextMessage, migrateGroupEnvelope, validateGroupContextEntry, mentionLimit, validateChatMessage, validateTimelineEntry, type ChatPublication, type ChatMessage, type ChatSnapshot, type ChatStore, type StoredChatMessage, type FinalReference, type TimelineEntry, type TimelineSnapshot, type ChatAcceptance, type ChatReset, type GroupContextEntry } from './group-chat.js';
import { clearTables, dataTransaction, rows, insertRows, limitClause, duplicate, type DataConnection as Db } from '../../data-transaction.js';
import { schema } from './schema.js';
import { GroupContexts, GroupContextState, type GroupContextHistory } from './group-context.js';
import { groupSummaryEntry, prepareGroupSummary, validateGroupSummary, validateGroupSummaryText, type GroupSummary, type GroupSummaryInput, type GroupSummarySubmission } from './group-summary.js';
import type { AgentData } from '../../agent/data/repository.js';
import type { AgentExecutionState } from '../../agent/data/model.js';
import type { WorkspaceData } from '../../workspace/data/repository.js';
const memberRow = (row: RowDataPacket): StoredMember => ({ id: row.id as string, workspaceId: row.workspace_id as string, revision: Number(row.revision), value: decode<MemberRecord>(row.data, () => undefined) });
/** A duplicate key on a member row, named by the key that was violated. */
function memberConflict(error: unknown): unknown {
    if (!duplicate(error))
        return error;
    const message = String((error as {
        message?: unknown;
    }).message);
    if (message.includes('members_lead'))
        return new AppError('lead_exists', 'The workspace already has a lead', 409);
    if (message.includes('members_name'))
        return new AppError('member_exists', 'Another member of this team has that name', 409);
    return new AppError('conflict', 'Identity already exists', 409);
}
export class TeamData implements TeamStore, ChatStore {
    readonly pool: Db;
    constructor(readonly storage: MySqlStorage, readonly agents: AgentData, readonly workspaces: WorkspaceData, private readonly connection?: PoolConnection, private readonly contexts = new GroupContexts()) { this.pool = connection ?? storage.pool; }
    inTransaction(db: PoolConnection): TeamData { return new TeamData(this.storage, this.agents, this.workspaces, db, this.contexts); }
    private transaction<T>(fn: (db: PoolConnection) => Promise<T>): Promise<T> { return dataTransaction(this.storage, this.connection, fn); }
    async migrate(): Promise<void> {
        for (const statement of schema)
            await this.pool.query(statement);
        const columns = await rows(this.pool, 'SHOW COLUMNS FROM chat_settings');
        if (String(columns.find(row => row.Field === 'context_format')?.Default) !== '2') await this.pool.query('ALTER TABLE chat_settings ALTER COLUMN context_format SET DEFAULT 2');
        for (const column of ['reset_cursor', 'reset_position'])
            if (!columns.some(row => row.Field === column))
                await this.pool.query(`ALTER TABLE chat_settings ADD COLUMN ${column} BIGINT UNSIGNED NOT NULL DEFAULT 0`);
        if (!columns.some(row => row.Field === 'context_length'))
            await this.pool.query('ALTER TABLE chat_settings ADD COLUMN context_length BIGINT UNSIGNED NOT NULL DEFAULT 0');
        if (!columns.some(row => row.Field === 'context_revision')) {
            await this.pool.query('ALTER TABLE chat_settings ADD COLUMN context_revision BIGINT UNSIGNED NOT NULL DEFAULT 0');
            await this.pool.query('UPDATE chat_settings SET context_revision = position');
        }
        // Retire derived semantic state only; original chat/history rows remain intact.
        await this.pool.query('DROP TABLE IF EXISTS chat_semantic_indexes');
        for (const column of ['semantic_position', 'semantic_revision'])
            if (columns.some(row => row.Field === column)) await this.pool.query(`ALTER TABLE chat_settings DROP COLUMN ${column}`);
    }
    /** Inspect the effective shared summary/tail without warming runtime context. */
    async inspectGroupContext(workspaceId: string, options: ContextPageInput = {}): Promise<ContextPage<GroupContextEntry>> {
        identity(workspaceId, 'workspaceId');
        const input = contextPageInput(options);
        return this.transaction(async db => {
            await this.workspaces.inTransaction(db).requireWorkspace(workspaceId);
            const [settings] = await rows(db, 'SELECT position,reset_position,context_format,context_length,context_revision FROM chat_settings WHERE workspace_id = ?', [workspaceId]);
            if (settings && settings.context_format !== 2) throw new AppError('runtime_unavailable', 'Group context migration is incomplete', 503);
            const summary = await this.inTransaction(db).readGroupSummary(workspaceId);
            const resetPosition = Number(settings?.reset_position ?? 0), upper = Number(settings?.position ?? 0);
            if (summary && (summary.from !== resetPosition + 1 || summary.analyzedThrough > upper)) throw new AppError('corrupt_data', 'Group summary coverage differs from current context', 500);
            const revision = Number(settings?.context_revision ?? 0);
            const total = Number(settings?.context_length ?? 0) - (summary ? summary.through - resetPosition - 1 : 0);
            checkContextPage(revision, total, input);
            const includeSummary = !!summary && input.offset === 0;
            const wanted = Math.max(0, Math.min(input.limit, total - input.offset) - (includeSummary ? 1 : 0));
            const offset = Math.max(0, input.offset - (summary ? 1 : 0));
            const records = wanted ? await rows(db, 'SELECT position,id,entry FROM chat_context_entries FORCE INDEX (PRIMARY) WHERE workspace_id = ? AND position > ? AND position <= ? ORDER BY position LIMIT ' + wanted + ' OFFSET ' + offset, [workspaceId, summary?.through ?? resetPosition, upper]) : [];
            if (records.length !== wanted) throw new AppError('corrupt_data', 'Group context page length is invalid', 500);
            const entries = records.map(row => {
                const entry = decode<GroupContextEntry>(row.entry, validateGroupContextEntry);
                if (entry.messageId !== row.id || entry.metadata.groupPosition !== row.position || entry.metadata.workspaceId !== workspaceId)
                    throw new AppError('corrupt_data', 'Group context row identity is invalid', 500);
                return entry;
            });
            if (includeSummary) entries.unshift(groupSummaryEntry(workspaceId, summary!));
            const next = input.offset + entries.length;
            return { revision, offset: input.offset, total, nextOffset: next < total ? next : null, entries };
        });
    }
    async readGroupContext(workspaceId: string, after: number, through?: number): Promise<GroupContextMessage[]> {
        identity(workspaceId, 'workspaceId'); position(after);
        const model = this.connection ? new GroupContextState(workspaceId, await this.loadGroupContext(workspaceId))
            : await this.contexts.get(workspaceId, () => this.loadGroupContext(workspaceId));
        return model.read(after, through).map(groupContextMessage);
    }
    async readGroupSummary(workspaceId: string): Promise<GroupSummary | undefined> {
        identity(workspaceId, 'workspaceId');
        const [row] = await rows(this.pool, 'SELECT data FROM chat_context_summaries WHERE workspace_id = ?', [workspaceId]);
        return row ? decode<GroupSummary>(row.data, validateGroupSummary) : undefined;
    }
    async summaryInput(workspaceId: string): Promise<GroupSummaryInput> {
        const model = this.connection ? new GroupContextState(workspaceId, await this.loadGroupContext(workspaceId))
            : await this.contexts.get(workspaceId, () => this.loadGroupContext(workspaceId));
        const previous = model.summary();
        return prepareGroupSummary(model.source(previous?.through ?? 0).map(groupContextMessage), model.resetPosition, previous);
    }
    async submitGroupSummary(workspaceId: string, submission: GroupSummarySubmission): Promise<GroupSummary> {
        validateGroupSummaryText(submission.text);
        return this.transaction(async db => {
            await this.workspaces.inTransaction(db).requireWorkspace(workspaceId, true);
            await rows(db, 'SELECT position FROM chat_settings WHERE workspace_id = ? FOR UPDATE', [workspaceId]);
            const history = await this.inTransaction(db).loadGroupContext(workspaceId);
            if ((history.summary?.revision ?? 0) !== submission.baseRevision) throw new AppError('context_conflict', 'Group summary revision changed; a new snapshot is required', 409);
            const expected = prepareGroupSummary(history.entries.map(groupContextMessage), history.resetPosition, history.summary, submission.analyzedThrough);
            if (!expected.messages.length || expected.from !== submission.from || expected.through !== submission.through || expected.sourceDigest !== submission.sourceDigest)
                throw new AppError('context_conflict', 'Group summary source changed; a new snapshot is required', 409);
            const summary: GroupSummary = { revision: submission.baseRevision + 1, from: submission.from, through: submission.through,
                analyzedThrough: submission.analyzedThrough, sourceDigest: submission.sourceDigest, text: submission.text,
                messageId: randomUUID(), time: Date.now() };
            validateGroupSummary(summary);
            await db.execute('INSERT INTO chat_context_summaries (workspace_id,revision,through_position,analyzed_through,data) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE revision=VALUES(revision),through_position=VALUES(through_position),analyzed_through=VALUES(analyzed_through),data=VALUES(data)', [workspaceId, summary.revision, summary.through, summary.analyzedThrough, encode(summary)]);
            await db.execute('UPDATE chat_settings SET context_revision = context_revision + 1 WHERE workspace_id = ?', [workspaceId]);
            this.storage.afterCommit(db, () => this.contexts.changed(workspaceId, {summary}), () => this.contexts.invalidate(workspaceId));
            return summary;
        });
    }
    private async loadGroupContext(workspaceId: string): Promise<GroupContextHistory> {
        return this.transaction(async db => {
            const [settings] = await rows(db, 'SELECT position,reset_position,context_format,context_length FROM chat_settings WHERE workspace_id = ?', [workspaceId]);
            if (settings && settings.context_format !== 2) throw new AppError('runtime_unavailable', 'Group context migration is incomplete', 503);
            const upper = settings?.position ?? 0, resetPosition = settings?.reset_position ?? 0;
            const records = await rows(db, 'SELECT position,id,entry FROM chat_context_entries FORCE INDEX (PRIMARY) WHERE workspace_id = ? AND position > ? AND position <= ? ORDER BY position', [workspaceId, resetPosition, upper]);
            if (records.length !== (settings?.context_length ?? 0)) throw new AppError('corrupt_data', 'Group context row length differs from its bookkeeping', 500);
            const entries = records.map(row => {
                const entry = decode<GroupContextEntry>(row.entry, validateGroupContextEntry);
                if (entry.messageId !== row.id || entry.metadata.groupPosition !== row.position || entry.metadata.workspaceId !== workspaceId)
                    throw new AppError('corrupt_data', 'Group context row identity or order differs from its entry', 500);
                return entry;
            });
            const summary = await this.inTransaction(db).readGroupSummary(workspaceId);
            return {position: upper, resetPosition, entries, ...(summary ? {summary} : {})};
        });
    }
    /** Startup-only conversion. Existing frontend history and origin references are unchanged. */
    async migrateGroupContext(): Promise<void> {
        const workspaces = await rows(this.pool, 'SELECT workspace_id FROM chat_settings WHERE context_format < 2 UNION SELECT workspace_id FROM chat_messages WHERE workspace_id NOT IN (SELECT workspace_id FROM chat_settings) ORDER BY workspace_id');
        for (const {workspace_id: workspaceId} of workspaces) await this.transaction(async db => {
            await this.workspaces.inTransaction(db).requireWorkspace(workspaceId, true);
            const records = await rows(db, 'SELECT position,entry FROM chat_messages WHERE workspace_id = ? ORDER BY position', [workspaceId]);
            await db.execute('INSERT IGNORE INTO chat_settings (workspace_id,position,context_format) VALUES (?, ?, 0)', [workspaceId, records.at(-1)?.position ?? 0]);
            const [settings] = await rows(db, 'SELECT position,reset_position,context_format,context_length FROM chat_settings WHERE workspace_id = ?', [workspaceId]);
            if (settings!.context_format === 2) return;
            const names = new Map((await this.inTransaction(db).listMembers(workspaceId)).map(member => [member.id, member.value.name]));
            if (settings!.context_format === 1) {
                const old = await rows(db, 'SELECT position,entry FROM chat_context_entries WHERE workspace_id = ? ORDER BY position', [workspaceId]);
                const migrated: GroupContextEntry[] = [];
                for (const row of old) {
                    const entry = migrateGroupEnvelope(decode<GroupContextEntry>(row.entry, () => undefined), names);
                    if (entry.metadata.workspaceId !== workspaceId || entry.metadata.groupPosition !== row.position) throw new AppError('corrupt_data', 'Legacy group row differs from its metadata', 500);
                    await db.execute('UPDATE chat_context_entries SET entry = ? WHERE workspace_id = ? AND position = ?', [encode(entry), workspaceId, row.position]);
                    migrated.push(entry);
                }
                const summary = await this.inTransaction(db).readGroupSummary(workspaceId);
                if (summary) migrated.unshift(groupSummaryEntry(workspaceId, summary));
                const groups = migrated.map(groupContextMessage);
                for (const id of names.keys()) await this.agents.inTransaction(db).refreshSharedAttribution(id, workspaceId, groups);
                await db.execute('UPDATE chat_settings SET context_format = 2, context_revision = context_revision + 1 WHERE workspace_id = ?', [workspaceId]);
                this.storage.afterCommit(db, () => this.contexts.invalidate(workspaceId), () => this.contexts.invalidate(workspaceId));
                return;
            }
            const entries: GroupContextEntry[] = [];
            for (const row of records) {
                if (row.position <= settings!.reset_position) continue;
                const stored = decode<StoredChatMessage>(row.entry, () => undefined);
                const message = await this.resolveChatMessage(db, stored);
                if (message.position !== row.position || message.workspaceId !== workspaceId || row.position > settings!.position)
                    throw new AppError('corrupt_data', 'Shared history position differs from group context', 500);
                const images = await Promise.all((message.attachments ?? []).map(image => this.readChatImage(db, workspaceId, image.id)));
                const entry = groupEntry({...message, recipientNames: message.recipients.map(id => { const name = names.get(id); if (!name) throw new AppError('corrupt_data', 'Group recipient is unavailable', 500); return name; })}, images.map(imageContent), stored.finalRef);
                validateGroupContextEntry(entry); entries.push(entry);
            }
            await db.execute('DELETE FROM chat_context_entries WHERE workspace_id = ?', [workspaceId]);
            await insertRows(db, 'INSERT INTO chat_context_entries (workspace_id,position,id,entry) VALUES ?', entries.map(entry => [workspaceId, Number(entry.metadata.groupPosition), entry.messageId, encode(entry)]));
            await db.execute('UPDATE chat_settings SET context_format = 2, context_length = ?, context_revision = GREATEST(context_revision, position) WHERE workspace_id = ?', [entries.length, workspaceId]);
            this.storage.afterCommit(db, () => this.contexts.invalidate(workspaceId), () => this.contexts.invalidate(workspaceId));
        });
    }
    close(): void { this.contexts.clear(); }
    async configureChat(workspaceId: string, value: number): Promise<void> {
        mentionLimit(value);
        await this.transaction(async (db) => {
            await this.workspaces.inTransaction(db).requireWorkspace(workspaceId, true);
            await db.execute('INSERT INTO chat_settings (workspace_id, mention_limit) VALUES (?, ?) ON DUPLICATE KEY UPDATE mention_limit = VALUES(mention_limit)', [workspaceId, value]);
        });
    }
    async publishChat(input: ChatPublication): Promise<ChatAcceptance> {
        if (input.author.type === 'member' && input.images?.length)
            throw new AppError('invalid_input', 'Only user publications accept picture attachments');
        if (input.author.type === 'member' && input.recipients.length > 1)
            throw new AppError('invalid_mentions', 'An agent response can mention at most one member');
        return this.transaction(async (db) => {
            // Workspace lock serializes publication, budget allocation and stop. Runtime writes lock agents.
            await this.workspaces.inTransaction(db).requireWorkspace(input.workspaceId, true);
            await db.execute('INSERT IGNORE INTO chat_settings (workspace_id) VALUES (?)', [input.workspaceId]);
            const [settings] = await rows(db, 'SELECT * FROM chat_settings WHERE workspace_id = ?', [input.workspaceId]);
            const memberRows = await rows(db, 'SELECT id, data, revision FROM members WHERE workspace_id = ? ORDER BY id', [input.workspaceId]);
            const active = memberRows.filter(row => decode<MemberRecord>(row.data, () => undefined).retiredAt === null);
            const agents = new Map<string, AgentExecutionState>();
            for (const member of active)
                agents.set(member.id, await this.agents.inTransaction(db).executionState(member.id, true));
            const sender = input.author.type === 'member' ? agents.get(input.author.memberId) : undefined;
            if (input.author.type === 'member') {
                if (!sender || sender.activeRunId !== input.author.runId)
                    throw new AppError('member_unavailable', 'The sending member is no longer working', 409);
                const [origin] = await rows(db, 'SELECT exchange_id FROM chat_runs WHERE run_id = ?', [input.author.runId]);
                if (!origin || origin.exchange_id !== input.exchangeId)
                    throw new AppError('invalid_input', 'Response does not belong to this exchange');
            }
            for (const recipient of input.recipients) {
                if (input.memberRevisions && Number(active.find(member => member.id === recipient)?.revision) !== input.memberRevisions[recipient])
                    throw new AppError('config_conflict', 'Recipient configuration changed before activation; retry publication', 409);
                const agent = agents.get(recipient);
                if (!agent)
                    throw new AppError('member_unavailable', 'A mentioned member has retired', 409);
                if (agent.activeRunId)
                    throw new AppError('member_busy', 'A mentioned member is already working; revise or try again when it is free', 409);
            }
            const exchangeId = input.exchangeId ?? randomUUID();
            if (!input.exchangeId)
                await db.execute('INSERT INTO chat_exchanges (id, workspace_id, mention_limit) VALUES (?, ?, ?)', [exchangeId, input.workspaceId, settings!.mention_limit]);
            const [exchange] = await rows(db, 'SELECT * FROM chat_exchanges WHERE id = ? AND workspace_id = ?', [exchangeId, input.workspaceId]);
            if (!exchange || exchange.stopped)
                throw new AppError('exchange_stopped', 'This exchange has stopped', 409);
            if (exchange.used + input.recipients.length > exchange.mention_limit)
                throw new AppError('mention_limit', 'The exchange mention limit is reached; finish with a response without mentions', 409);
            let finalRef: FinalReference | undefined;
            if (sender && input.author.type === 'member') {
                const record = await this.agents.inTransaction(db).completedMessage(sender.id, { messageId: input.finalMessageId ?? '' });
                if (!record || record.runId !== input.author.runId)
                    throw new AppError('invalid_input', 'Final reference must identify the committed response of this activation');
                if (record.position !== sender.historyPosition)
                    throw new AppError('invalid_input', 'Final reference must identify the latest committed response');
                const candidate = record;
                const answer = finalAnswer(candidate.message);
                if (!answer)
                    throw new AppError('invalid_input', 'Final reference must identify naturally completed answer text');
                const response = parseMemberResponse(answer.text);
                finalRef = { agentId: sender.id, runId: record.runId, messageId: record.messageId, position: record.position, contentIndices: answer.contentIndices, bodyOffset: response.bodyOffset };
                if (await this.finalText(db, finalRef) !== input.text)
                    throw new AppError('invalid_input', 'Final response text does not match its committed reference');
            }
            const entries: TimelineEntry[] = [];
            const author = input.author.type === 'user' ? input.author : { ...input.author, name: decode<MemberRecord>(active.find(member => member.id === sender!.id)!.data, () => undefined).name };
            const message: ChatMessage = { workspaceId: input.workspaceId, messageId: randomUUID(), position: settings!.position + 1, exchangeId, author, text: input.text, ...(input.images?.length ? { attachments: input.images.map(image => image.metadata) } : {}), recipients: input.recipients, recipientNames: input.recipients.map(id => decode<MemberRecord>(active.find(member => member.id === id)!.data, () => undefined).name), time: Date.now() };
            validateChatMessage(message);
            for (const image of input.images ?? [])
                await db.execute('INSERT INTO chat_images (workspace_id, id, metadata, content) VALUES (?, ?, ?, ?)', [input.workspaceId, image.metadata.id, encode(image.metadata), image.bytes]);
            await db.execute('INSERT INTO chat_messages (workspace_id, position, entry) VALUES (?, ?, ?)', [input.workspaceId, message.position, encode(finalRef ? { ...message, text: undefined, finalRef } : message)]);
            const contextEntry = groupEntry(message, (input.images ?? []).map(imageContent), finalRef);
            validateGroupContextEntry(contextEntry);
            await db.execute('INSERT INTO chat_context_entries (workspace_id,position,id,entry) VALUES (?, ?, ?, ?)', [input.workspaceId, message.position, message.messageId, encode(contextEntry)]);
            this.storage.afterCommit(db, () => this.contexts.changed(input.workspaceId, {append: contextEntry, before: message.position - 1}), () => this.contexts.invalidate(input.workspaceId));
            await db.execute('UPDATE chat_settings SET position = ?, context_length = context_length + 1, context_revision = context_revision + 1 WHERE workspace_id = ?', [message.position, input.workspaceId]);
            await db.execute('UPDATE chat_exchanges SET used = used + ? WHERE id = ?', [input.recipients.length, exchangeId]);
            if (sender && input.author.type === 'member') {
                const finished = await this.agents.inTransaction(db).completePublishedRun(sender.id, input.author.runId);
                const completedEntry = await this.finishChatEntry(db, finished, finalRef, author.type === 'member' ? author.name : '');
                if (!completedEntry)
                    throw new AppError('corrupt_data', 'Member response reservation is missing', 500);
                entries.push(completedEntry);
                sender.activeRunId = null;
            }
            if (input.author.type === 'user')
                entries.push(await this.writeChatEntry(db, { workspaceId: input.workspaceId, entryId: message.messageId, position: 0, revision: 0, exchangeId, time: message.time, kind: 'user', text: input.text, messageId: message.messageId, ...(message.attachments ? { attachments: message.attachments } : {}) }));
            const runs: RunState[] = [];
            for (const agentId of input.recipients) {
                const run = await this.agents.inTransaction(db).admitRun(agentId);
                await db.execute('INSERT INTO chat_runs (run_id, exchange_id) VALUES (?, ?)', [run.runId, exchangeId]);
                const member = memberRows.find(row => row.id === agentId)!;
                const name = decode<MemberRecord>(member.data, () => undefined).name;
                entries.push(await this.writeChatEntry(db, { workspaceId: input.workspaceId, entryId: run.runId, position: 0, revision: 0, exchangeId, time: run.startedAt, kind: 'member', memberId: agentId, name, run, working: { after: agents.get(agentId)!.historyPosition, through: null }, finalRef: null, text: null }));
                runs.push(run);
            }
            return { message, runs, entries };
        });
    }
    async chatSnapshot(workspaceId: string, after = 0, limit = 100): Promise<ChatSnapshot> {
        identity(workspaceId, 'workspaceId');
        position(after);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
            throw new AppError('invalid_input', 'limit is 1–500');
        return this.transaction(async (db) => {
            await this.workspaces.inTransaction(db).requireWorkspace(workspaceId, false);
            const [settings] = await rows(db, 'SELECT * FROM chat_settings WHERE workspace_id = ?', [workspaceId]);
            const upper = settings?.position ?? 0;
            if (after > upper)
                throw new AppError('invalid_cursor', 'Chat cursor is ahead of history', 409);
            const resetPosition = settings?.reset_position ?? 0;
            const records = await rows(db, 'SELECT entry FROM chat_messages WHERE workspace_id = ? AND position > ? ORDER BY position' + limitClause(limit), [workspaceId, Math.max(after, resetPosition)]);
            const messages = await Promise.all(records.map(row => this.resolveChatMessage(db, decode<StoredChatMessage>(row.entry, () => undefined))));
            const activity = await rows(db, 'SELECT cr.run_id,cr.exchange_id FROM chat_runs cr JOIN chat_exchanges e ON e.id = cr.exchange_id WHERE e.workspace_id = ? ORDER BY cr.run_id', [workspaceId]);
            const runValues = await this.agents.inTransaction(db).readRuns(activity.map(row => row.run_id));
            if (runValues.length !== activity.length)
                throw new AppError('corrupt_data', 'A shared run reference is unavailable', 500);
            const exchanges = new Map(activity.map(row => [row.run_id, row.exchange_id]));
            const runs = runValues.map(run => ({ exchangeId: exchanges.get(run.runId), run }));
            return { workspaceId, position: upper, resetPosition, mentionLimit: settings?.mention_limit ?? defaultMentionLimit, messages, more: (messages.at(-1)?.position ?? Math.max(after, resetPosition)) < upper, runs };
        });
    }
    /** The clock is locked after agent rows, including on terminal writes. */
    private async writeChatEntry(db: PoolConnection, input: TimelineEntry): Promise<TimelineEntry> {
        await db.execute('INSERT INTO chat_clock (workspace_id) VALUES (?) ON DUPLICATE KEY UPDATE workspace_id = VALUES(workspace_id)', [input.workspaceId]);
        const [clock] = await rows(db, 'SELECT position, seq FROM chat_clock WHERE workspace_id = ? FOR UPDATE', [input.workspaceId]);
        const entry: TimelineEntry = { ...input, position: input.position || clock!.position + 1, revision: clock!.seq + 1 };
        validateTimelineEntry(entry);
        const stored = { ...entry, ...(entry.kind === 'member' ? { text: null } : {}) };
        await db.execute('INSERT INTO chat_entries (workspace_id, id, position, run_id, data) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)', [entry.workspaceId, entry.entryId, entry.position, entry.kind === 'member' ? entry.run.runId : null, encode(stored)]);
        await db.execute('INSERT INTO chat_changes (workspace_id, seq, data) VALUES (?, ?, ?)', [entry.workspaceId, entry.revision, encode(stored)]);
        await db.execute('UPDATE chat_clock SET position = ?, seq = ? WHERE workspace_id = ?', [Math.max(clock!.position, entry.position), entry.revision, entry.workspaceId]);
        return entry;
    }
    private async finishChatEntry(db: PoolConnection, run: RunState, finalRef?: FinalReference, publishedName?: string): Promise<TimelineEntry | null> {
        const [row] = await rows(db, 'SELECT data FROM chat_entries WHERE run_id = ?', [run.runId]);
        if (!row)
            return null; // Solo runs have no group entry.
        const entry = decode<TimelineEntry>(row.data, validateTimelineEntry);
        if (entry.kind !== 'member')
            throw new AppError('corrupt_data', 'Invalid member entry', 500);
        if (entry.run.status !== 'running')
            return this.resolveTimelineEntry(db, entry);
        return this.writeChatEntry(db, { ...entry, name: publishedName ?? entry.name, run, working: { ...entry.working, through: run.endPosition }, finalRef: finalRef ?? null, text: finalRef ? await this.finalText(db, finalRef) : null });
    }
    private async finalText(db: PoolConnection, ref: FinalReference): Promise<string> {
        identity(ref.agentId);
        identity(ref.runId);
        identity(ref.messageId);
        position(ref.position);
        if (ref.bodyOffset !== undefined && (!ref.contentIndices || ref.toolCallId !== undefined))
            throw new AppError('corrupt_data', 'Final body offset requires selected text blocks', 500);
        const entry = await this.agents.inTransaction(db).completedMessage(ref.agentId, { position: ref.position });
        if (!entry || entry.messageId !== ref.messageId || entry.runId !== ref.runId)
            throw new AppError('corrupt_data', 'Referenced final message is unavailable', 500);
        if (entry.message.role !== 'assistant')
            throw new AppError('corrupt_data', 'Final reference must identify assistant output', 500);
        // Decode immutable publications accepted before ordinary model completion replaced the response tool.
        if (ref.toolCallId) {
            const call = entry.message.content.find(part => part.type === 'toolCall' && part.id === ref.toolCallId);
            if (call?.type !== 'toolCall' || call.name !== 'final_response' || typeof call.arguments.text !== 'string')
                throw new AppError('corrupt_data', 'Historical final action is unavailable', 500);
            return call.arguments.text;
        }
        if (ref.contentIndices) {
            const answer = finalAnswer(entry.message);
            if (!answer || JSON.stringify(answer.contentIndices) !== JSON.stringify(ref.contentIndices))
                throw new AppError('corrupt_data', 'Final text selection does not match its stored response', 500);
            if (ref.bodyOffset === undefined)
                return answer.text;
            if (!Number.isSafeInteger(ref.bodyOffset) || ref.bodyOffset < 0 || ref.bodyOffset >= answer.text.length)
                throw new AppError('corrupt_data', 'Invalid final body offset', 500);
            return answer.text.slice(ref.bodyOffset);
        }
        if (entry.message.content.some(part => part.type === 'toolCall'))
            throw new AppError('corrupt_data', 'Historical final reference contains tool calls', 500);
        return entry.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
    }
    private async readChatImage(db: Db, workspaceId: string, imageId: string): Promise<PreparedChatImage> {
        const [row] = await rows(db, 'SELECT metadata, content FROM chat_images WHERE workspace_id = ? AND id = ?', [workspaceId, imageId]);
        if (!row)
            throw new AppError('not_found', 'Picture not found', 404);
        const metadata = decode<PreparedChatImage['metadata']>(row.metadata, value => validateChatImages([value]));
        if (!Buffer.isBuffer(row.content) || row.content.length !== metadata.size)
            throw new AppError('corrupt_data', 'Stored picture size does not match metadata', 500);
        return { metadata, bytes: row.content };
    }
    async chatImage(workspaceId: string, imageId: string): Promise<PreparedChatImage> {
        identity(workspaceId, 'workspaceId');
        identity(imageId, 'imageId');
        return this.readChatImage(this.pool, workspaceId, imageId);
    }
    private async resolveChatMessage(db: PoolConnection, stored: StoredChatMessage): Promise<ChatMessage> {
        if (stored.author.type === 'member' && (!stored.finalRef || stored.finalRef.agentId !== stored.author.memberId || stored.finalRef.runId !== stored.author.runId || stored.text !== undefined))
            throw new AppError('corrupt_data', 'Invalid shared final reference', 500);
        const { finalRef, ...record } = stored;
        const message = { ...record, text: finalRef ? await this.finalText(db, finalRef) : record.text } as ChatMessage;
        validateChatMessage(message);
        return message;
    }
    private async resolveTimelineEntry(db: PoolConnection, entry: TimelineEntry): Promise<TimelineEntry> {
        return entry.kind === 'member' && entry.finalRef ? { ...entry, text: await this.finalText(db, entry.finalRef) } : entry;
    }
    async chatTimeline(workspaceId: string, after = 0, limit = 100): Promise<TimelineSnapshot> {
        identity(workspaceId, 'workspaceId');
        position(after);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
            throw new AppError('invalid_input', 'limit is 1–500');
        return this.transaction(async (db) => {
            await this.workspaces.inTransaction(db).requireWorkspace(workspaceId, false);
            const [clock] = await rows(db, 'SELECT seq FROM chat_clock WHERE workspace_id = ?', [workspaceId]);
            const cursor = clock?.seq ?? 0;
            if (after > cursor)
                throw new AppError('invalid_cursor', 'Timeline cursor is ahead of history', 409);
            const [settings] = await rows(db, 'SELECT mention_limit, reset_cursor FROM chat_settings WHERE workspace_id = ?', [workspaceId]);
            const resetCursor = settings?.reset_cursor ?? 0;
            const records = await rows(db, 'SELECT seq, data FROM chat_changes WHERE workspace_id = ? AND seq > ? ORDER BY seq' + limitClause(limit), [workspaceId, Math.max(after, resetCursor)]);
            const changes = await Promise.all(records.map(async (row) => ({ cursor: row.seq as number, entry: await this.resolveTimelineEntry(db, decode<TimelineEntry>(row.data, validateTimelineEntry)) })));
            return { workspaceId, cursor, resetCursor, changes, more: (changes.at(-1)?.cursor ?? Math.max(after, resetCursor)) < cursor, mentionLimit: settings?.mention_limit ?? defaultMentionLimit };
        });
    }
    /** Upgrade old prototype records once. Old display order is publication order. */
    async importChatHistory(): Promise<void> {
        const workspaces = await rows(this.pool, 'SELECT DISTINCT workspace_id FROM chat_messages');
        for (const workspace of workspaces)
            await this.transaction(async (db) => {
                await this.workspaces.inTransaction(db).requireWorkspace(workspace.workspace_id, true);
                if ((await rows(db, 'SELECT workspace_id FROM chat_clock WHERE workspace_id = ?', [workspace.workspace_id])).length)
                    return;
                const records = await rows(db, 'SELECT position, entry FROM chat_messages WHERE workspace_id = ? ORDER BY position', [workspace.workspace_id]);
                const imported = new Set<string>();
                for (const row of records) {
                    const message = decode<ChatMessage>(row.entry, validateChatMessage);
                    const base = { workspaceId: message.workspaceId, entryId: message.messageId, position: 0, revision: 0, exchangeId: message.exchangeId, time: message.time };
                    if (message.author.type === 'user')
                        await this.writeChatEntry(db, { ...base, kind: 'user', text: message.text, messageId: message.messageId });
                    else {
                        const run = await this.agents.inTransaction(db).readRun(message.author.runId);
                        // The old atomic final publication pinned endPosition to its committed candidate.
                        const final = run.endPosition === null ? null : await this.agents.inTransaction(db).completedMessage(run.agentId, { position: run.endPosition });
                        if (!final)
                            throw new AppError('corrupt_data', 'Old group final history is unavailable', 500);
                        const ref: FinalReference = { agentId: run.agentId, runId: run.runId, messageId: final.messageId, position: run.endPosition! };
                        if (await this.finalText(db, ref) !== message.text)
                            throw new AppError('corrupt_data', 'Old group final reference differs from publication', 500);
                        const first = (await this.agents.inTransaction(db).runMessages(run.agentId, run.runId))[0];
                        await this.writeChatEntry(db, { ...base, entryId: run.runId, kind: 'member', memberId: run.agentId, name: message.author.name, run, working: { after: first!.position - 1, through: run.endPosition }, finalRef: ref, text: null });
                        await db.execute('UPDATE chat_messages SET entry = ? WHERE workspace_id = ? AND position = ?', [encode({ ...message, text: undefined, finalRef: ref }), message.workspaceId, row.position]);
                        imported.add(run.runId);
                    }
                }
                const members = await this.inTransaction(db).listMembers(workspace.workspace_id);
                const memberIds = new Set(members.map(member => member.id));
                const runs = await this.agents.inTransaction(db).listRuns([...memberIds]);
                for (const run of runs) {
                    const [link] = await rows(db, 'SELECT exchange_id FROM chat_runs WHERE run_id = ?', [run.runId]);
                    if (!link || imported.has(run.runId))
                        continue;
                    const first = (await this.agents.inTransaction(db).runMessages(run.agentId, run.runId))[0];
                    const agent = await this.agents.inTransaction(db).executionState(run.agentId);
                    await this.writeChatEntry(db, { workspaceId: workspace.workspace_id, entryId: run.runId, position: 0, revision: 0, exchangeId: link.exchange_id, time: run.startedAt, kind: 'member', memberId: run.agentId, name: members.find(member => member.id === run.agentId)!.value.name, run, working: { after: first?.position ? first.position - 1 : run.endPosition ?? agent.historyPosition, through: run.endPosition }, finalRef: null, text: null });
                }
            });
    }
    async stopChat(workspaceId: string): Promise<RunState[]> {
        return this.transaction(async (db) => {
            await this.workspaces.inTransaction(db).requireWorkspace(workspaceId, true);
            await db.execute('UPDATE chat_exchanges SET stopped = 1 WHERE workspace_id = ?', [workspaceId]);
            const links = await rows(db, 'SELECT cr.run_id FROM chat_runs cr JOIN chat_exchanges e ON e.id = cr.exchange_id WHERE e.workspace_id = ?', [workspaceId]);
            return this.agents.inTransaction(db).activeRuns(links.map(link => link.run_id));
        });
    }
    /** Explicit user reset is the only operation that removes stable conversation history. */
    async resetChat(workspaceId: string): Promise<ChatReset> {
        identity(workspaceId, 'workspaceId');
        return this.transaction(async (db) => {
            await this.workspaces.inTransaction(db).requireWorkspace(workspaceId, true);
            const members = await rows(db, 'SELECT id, data FROM members WHERE workspace_id = ? ORDER BY id', [workspaceId]);
            for (const member of members) {
                const agent = await this.agents.inTransaction(db).executionState(member.id, true);
                if (agent.activeRunId)
                    throw new AppError('workspace_busy', 'Stop team work and wait for every member to finish before resetting the chat', 409);
            }
            await db.execute('INSERT IGNORE INTO chat_settings (workspace_id) VALUES (?)', [workspaceId]);
            await db.execute('INSERT IGNORE INTO chat_clock (workspace_id) VALUES (?)', [workspaceId]);
            const [settings] = await rows(db, 'SELECT position FROM chat_settings WHERE workspace_id = ?', [workspaceId]);
            const [clock] = await rows(db, 'SELECT seq FROM chat_clock WHERE workspace_id = ? FOR UPDATE', [workspaceId]);
            const resetCursor = clock!.seq + 1;
            const resetPosition = settings!.position + 1;
            for (const table of ['chat_changes', 'chat_entries', 'chat_context_entries', 'chat_messages', 'chat_images'])
                await db.execute(`DELETE FROM ${table} WHERE workspace_id = ?`, [workspaceId]);
            await db.execute('DELETE FROM chat_context_summaries WHERE workspace_id = ?', [workspaceId]);
            // Include all member runs, even ones not linked to an exchange, but never solo agents.
            for (const run of await this.agents.inTransaction(db).listRuns(members.map(member => member.id)))
                await db.execute('DELETE FROM chat_runs WHERE run_id = ?', [run.runId]);
            await db.execute('DELETE FROM chat_exchanges WHERE workspace_id = ?', [workspaceId]);
            await this.agents.inTransaction(db).resetConversations(members.map(member => member.id));
            await db.execute('UPDATE chat_clock SET seq = ? WHERE workspace_id = ?', [resetCursor, workspaceId]);
            await db.execute('UPDATE chat_settings SET position = ?, reset_cursor = ?, reset_position = ?, context_length = 0, context_format = 2, context_revision = context_revision + 1 WHERE workspace_id = ?', [resetPosition, resetCursor, resetPosition, workspaceId]);
            this.storage.afterCommit(db, () => this.contexts.changed(workspaceId, {reset: resetPosition}), () => this.contexts.invalidate(workspaceId));
            return { workspaceId, resetCursor, resetPosition };
        });
    }
    async listMembers(workspaceId: string): Promise<StoredMember[]> {
        return (await rows(this.pool, 'SELECT id, workspace_id, revision, data FROM members WHERE workspace_id = ? ORDER BY ordinal', [workspaceId])).map(memberRow);
    }
    async getMember(memberId: string): Promise<StoredMember | null> {
        const [row] = await rows(this.pool, 'SELECT id, workspace_id, revision, data FROM members WHERE id = ?', [memberId]);
        return row ? memberRow(row) : null;
    }
    /** The member's conversation and the member, which the caller's transaction commits together. */
    private async insertMember(db: PoolConnection, member: NewMember): Promise<StoredMember> {
        identity(member.id, 'memberId');
        const data = encode(member.value);
        await this.agents.inTransaction(db).createRecord(member.id);
        try {
            await db.execute('INSERT INTO members (id, workspace_id, is_lead, name_key, data) VALUES (?, ?, ?, ?, ?)', [member.id, member.workspaceId, member.lead ? 1 : null, member.nameKey, data]);
        }
        catch (error) {
            throw memberConflict(error);
        }
        return { id: member.id, workspaceId: member.workspaceId, revision: 0, value: decode<MemberRecord>(data, () => undefined) };
    }
    async getMemberActivation(workspaceId: string): Promise<MemberActivationState | null> {
        const [row] = await rows(this.pool, 'SELECT revision, time FROM member_activation WHERE workspace_id = ?', [workspaceId]);
        return row ? { revision: String(row.revision), time: Number(row.time) } : null;
    }
    async activateMembers(workspaceId: string, input: MemberActivation): Promise<void> {
        await this.transaction(async (db) => {
            await this.workspaces.inTransaction(db).requireWorkspace(workspaceId, true);
            const [activation] = await rows(db, 'SELECT revision, time FROM member_activation WHERE workspace_id = ? FOR UPDATE', [workspaceId]);
            if ((activation?.revision ?? null) !== (input.expectedActivation?.revision ?? null) || (activation ? Number(activation.time) : null) !== (input.expectedActivation?.time ?? null))
                throw new AppError('stale_revision', 'Configuration activation changed after review', 409);
            const current = (await rows(db, 'SELECT id, workspace_id, revision, data FROM members WHERE workspace_id = ? ORDER BY ordinal FOR UPDATE', [workspaceId])).map(memberRow);
            const active = current.filter(m => m.value.retiredAt === null);
            const expected = new Map(input.expected.map(m => [m.id, m.revision]));
            if (active.length !== expected.size || active.some(m => expected.get(m.id) !== m.revision))
                throw new AppError('config_conflict', 'Team changed after review; review again', 409);
            const models = await this.workspaces.inTransaction(db).getWorkspaceModels(workspaceId);
            if (!models || Number(models.revision) !== input.modelsRevision)
                throw new AppError('config_conflict', 'Workspace models changed after review', 409);
            for (const member of active.slice().sort((a, b) => a.id.localeCompare(b.id)))
                if ((await this.agents.inTransaction(db).executionState(member.id, true)).activeRunId)
                    throw new AppError('workspace_busy', 'All workspace members must be idle', 409);
            // Retire first so a replacement may reuse its name within the same transaction.
            for (const next of input.update.slice().sort((a, b) => Number(b.value.retiredAt !== null) - Number(a.value.retiredAt !== null))) {
                const old = active.find(m => m.id === next.id);
                if (!old || next.workspaceId !== workspaceId || next.value.workspaceId !== workspaceId || next.revision !== old.revision + 1 || old.value.lead !== next.value.lead || (old.value.lead && next.value.retiredAt !== null))
                    throw new AppError('config_conflict', 'Invalid member activation', 409);
                try {
                    await db.execute('UPDATE members SET data = ?, name_key = ?, revision = ? WHERE id = ?', [encode(next.value), next.value.retiredAt === null ? next.value.name.toLowerCase() : null, next.revision, next.id]);
                }
                catch (error) {
                    throw memberConflict(error);
                }
            }
            for (const member of input.create) {
                if (member.workspaceId !== workspaceId || member.value.workspaceId !== workspaceId || member.lead || member.value.lead || member.value.retiredAt !== null)
                    throw new AppError('invalid_config', 'Invalid member creation');
                await this.insertMember(db, member);
            }
            await db.execute('INSERT INTO member_activation (workspace_id, revision, time) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE revision = VALUES(revision), time = VALUES(time)', [workspaceId, input.activation.revision, input.activation.time]);
        });
    }
    async createMember(member: NewMember): Promise<StoredMember> {
        return this.transaction(async (db) => {
            await this.workspaces.inTransaction(db).requireWorkspace(member.workspaceId, true);
            return this.insertMember(db, member);
        });
    }
    async updateMember(memberId: string, revision: number, nameKey: string | null, value: MemberRecord, requireIdle = false): Promise<StoredMember> {
        identity(memberId, 'memberId');
        position(revision);
        const data = encode(value);
        await this.transaction(async (db) => {
            await this.workspaces.inTransaction(db).requireWorkspace(value.workspaceId, true);
            if (requireIdle && (await this.agents.inTransaction(db).executionState(memberId, true)).activeRunId)
                throw new AppError('member_busy', 'Wait for the member before submitting configuration', 409);
            let result: ResultSetHeader;
            try {
                [result] = await db.execute<ResultSetHeader>('UPDATE members SET data = ?, name_key = ?, revision = revision + 1 WHERE id = ? AND revision = ?', [data, nameKey, memberId, revision]);
            }
            catch (error) {
                throw memberConflict(error);
            }
            if (result.affectedRows) {
                return;
            }
            const [existing] = await rows(db, 'SELECT id FROM members WHERE id = ?', [memberId]);
            throw new AppError(existing ? 'config_conflict' : 'not_found', existing ? 'Member revision changed' : 'Member not found', existing ? 409 : 404);
        });
        return { id: memberId, workspaceId: value.workspaceId, revision: revision + 1, value: decode<MemberRecord>(data, () => undefined) };
    }
    async observeRunFinished(run: RunState): Promise<void> { await this.transaction(db => this.finishChatEntry(db, run)); }
    async initializeActivation(workspaceId: string, value: MemberActivationState): Promise<void> { await this.pool.execute('INSERT INTO member_activation (workspace_id,revision,time) VALUES (?,?,?)', [workspaceId, value.revision, value.time]); }
    async initializeLeadModels(workspaceId: string, value: WorkspaceModels): Promise<void> {
        const [row] = await rows(this.pool, 'SELECT id,workspace_id,revision,data FROM members WHERE workspace_id = ? AND is_lead = 1', [workspaceId]);
        if (!row)
            return;
        const lead = memberRow(row);
        if (lead.value.settings.connectionId !== null || lead.value.settings.modelId !== null)
            return;
        const defaults = defaultRunSettings(value), next = { ...lead.value, settings: { ...lead.value.settings, connectionId: defaults.connectionId, modelId: defaults.modelId, modelOptions: defaults.modelOptions } };
        next.configuration = generatedSource(next);
        if (lead.value.configuration)
            { next.configuration.path = lead.value.configuration.path; next.configuration.legacyPaths = lead.value.configuration.legacyPaths; }
        await this.pool.execute('UPDATE members SET data = ?, revision = revision + 1 WHERE id = ?', [encode(next), lead.id]);
    }
    async contextMembers(): Promise<{
        id: string;
        workspaceId: string;
    }[]> { return (await rows(this.pool, 'SELECT id,workspace_id FROM members')).map(row => ({ id: row.id, workspaceId: row.workspace_id })); }
    async initialMemberFiles(workspaceId: string): Promise<Record<string, string>> {
        const files: Record<string, string> = {};
        for (const member of await this.listMembers(workspaceId))
            if (member.value.retiredAt === null && member.value.configuration) {
                const source = member.value.configuration;
                for (const [path, text] of Object.entries(source.files))
                    files[`${source.path.slice(0, source.path.lastIndexOf('/'))}/${path}`] = text;
            }
        return files;
    }
    async clearConversations(): Promise<void> {
        await clearTables(this.pool, ['chat_changes', 'chat_entries', 'chat_clock', 'chat_runs', 'chat_context_entries', 'chat_messages', 'chat_images', 'chat_exchanges', 'chat_context_summaries', 'chat_settings']);
        if (this.connection) this.storage.afterCommit(this.connection, () => this.contexts.clear(), () => this.contexts.clear());
        else this.contexts.clear();
    }
    async clearMembers(): Promise<void> { await clearTables(this.pool, ['member_activation', 'members']); }
}
