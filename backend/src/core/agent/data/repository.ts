import { contextPageInput, checkContextPage, type ContextPageInput, type ContextPage } from '../../context-page.js';
import type { AgentRecord, AgentExecutionState } from './model.js';
import { validateEntries, validateRun, validateReactHarnessData } from './validation.js';
import { interruptedCompactionContext, validateCompactionState, type CompactionState } from './compaction.js';
import { adoptRecordedContext, sharedAttributionUpdates, type GroupContextMessage } from './context.js';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { MySqlStorage } from '../../../storage/mysql.js';
import type { UserMessage } from '@earendil-works/pi-ai';
import { decode, encode } from '../../codec.js';
import { AppError, identity, position, type ReactHarnessData, type CompletedMessage, type ContextEntry, type ContextHistory, type CurrentState, type FollowSnapshot, type RunState, type RunStatus } from './model.js';
import { clearTables, dataTransaction, insertRows, rows, type DataConnection as Db } from '../../data-transaction.js';
import { schema } from './schema.js';
import { ResidentContexts, type ContextChange } from './resident-context.js';
import type { ContextPatch, ContextMetadataUpdate, ReactHarnessMessageEffects } from './model.js';
export interface AgentDataHooks {
    created?(db: PoolConnection, agentId: string): Promise<void>;
    finished?(db: PoolConnection, run: RunState): Promise<void>;
}
export class AgentData {
    readonly pool: Db;
    private lease?: PoolConnection;
    private leaseError?: Error;
    private leaseListener?: (error: Error) => void;
    private readonly lockName: string;
    constructor(readonly storage: MySqlStorage, private readonly hooks: AgentDataHooks = {}, private readonly connection?: PoolConnection, private readonly contexts = new ResidentContexts()) {
        this.pool = connection ?? storage.pool;
        this.lockName = `rsi:${createHash('sha256').update('/' + storage.database).digest('hex').slice(0, 56)}`;
    }
    inTransaction(db: PoolConnection): AgentData { return new AgentData(this.storage, this.hooks, db, this.contexts); }
    private transaction<T>(fn: (db: PoolConnection) => Promise<T>): Promise<T> { return dataTransaction(this.storage, this.connection, fn); }
    async migrate(): Promise<void> {
        for (const statement of schema)
            await this.pool.query(statement);
        const columns = await rows(this.pool, 'SHOW COLUMNS FROM agents');
        if (!columns.some(row => row.Field === 'context_format'))
            await this.pool.query('ALTER TABLE agents ADD COLUMN context_format TINYINT UNSIGNED NOT NULL DEFAULT 0');
        if (String(columns.find(row => row.Field === 'context_format')?.Default) !== '1')
            await this.pool.query('ALTER TABLE agents ALTER COLUMN context_format SET DEFAULT 1');
        if (!columns.some(row => row.Field === 'context_length'))
            await this.pool.query('ALTER TABLE agents ADD COLUMN context_length BIGINT UNSIGNED NOT NULL DEFAULT 0');
        if (columns.some(row => row.Field === 'context')) {
            const ids = await rows(this.pool, 'SELECT id FROM agents ORDER BY id');
            for (const {id} of ids) await this.transaction(async db => {
                const [row] = await rows(db, 'SELECT context FROM agents WHERE id = ? FOR UPDATE', [id]);
                const entries = decode<ContextEntry[]>(row!.context, validateEntries);
                await this.writeContext(db, id, entries);
                await db.execute('UPDATE agents SET context_length = ? WHERE id = ?', [entries.length, id]);
            });
            await this.pool.query('ALTER TABLE agents DROP COLUMN context');
            this.contexts.clear();
        }
        await this.pool.query('DROP TABLE IF EXISTS chunks');
        await this.pool.query('DROP TABLE IF EXISTS live_messages');
    }
    async acquireRuntime(onLost: (error: Error) => void): Promise<void> {
        if (this.lease)
            throw new AppError('runtime_conflict', 'This store already has a runtime owner', 409);
        const connection = await this.storage.pool.getConnection();
        try {
            const [result] = await rows(connection, 'SELECT GET_LOCK(?, 0) AS acquired', [this.lockName]);
            if (result?.acquired !== 1)
                throw new AppError('runtime_conflict', 'Another runtime owns this database', 409);
            this.lease = connection;
            this.leaseError = undefined;
            this.leaseListener = (error: Error) => {
                this.leaseError = error;
                onLost(error);
            };
            connection.on('error', this.leaseListener);
        }
        catch (error) {
            connection.release();
            throw error;
        }
    }
    assertRuntime(): void {
        if (!this.lease || this.leaseError)
            throw new AppError('runtime_unavailable', 'Runtime database ownership is unavailable', 503);
    }
    async releaseRuntime(): Promise<void> {
        const lease = this.lease;
        this.lease = undefined;
        this.contexts.clear();
        if (lease) {
            try {
                if (!this.leaseError)
                    await lease.execute('SELECT RELEASE_LOCK(?)', [this.lockName]);
            }
            finally {
                if (this.leaseListener)
                    lease.removeListener('error', this.leaseListener);
                this.leaseListener = undefined;
                lease.release();
            }
        }
    }
    async executionState(agentId: string, lock = false): Promise<AgentExecutionState> {
        identity(agentId, 'agentId');
        const [row] = await rows(this.pool, `SELECT id,history_position,active_run_id FROM agents WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [agentId]);
        if (!row)
            throw new AppError('not_found', 'Agent not found', 404);
        return { id: row.id, historyPosition: row.history_position, activeRunId: row.active_run_id };
    }
    private async agent(db: Db, agentId: string, lock = false): Promise<AgentRecord> {
        identity(agentId, 'agentId');
        const [row] = await rows(db, `SELECT id,context_length,context_revision,history_position,active_run_id,latest_run_id,context_format FROM agents WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [agentId]);
        if (!row)
            throw new AppError('not_found', 'Agent not found', 404);
        return { id: row.id, contextLength: row.context_length, contextRevision: row.context_revision, historyPosition: row.history_position, activeRunId: row.active_run_id, latestRunId: row.latest_run_id, contextFormat: row.context_format };
    }
    private async run(db: Db, agentId: string, runId: string): Promise<RunState> {
        identity(runId, 'runId');
        const [row] = await rows(db, 'SELECT state FROM runs WHERE id = ? AND agent_id = ?', [runId, agentId]);
        if (!row)
            throw new AppError('not_found', 'Run not found for this agent', 404);
        return decode<RunState>(row.state, validateRun);
    }
    private async active(db: Db, agent: AgentRecord, runId: string): Promise<RunState> {
        if (agent.activeRunId !== runId)
            throw new AppError('run_conflict', 'Run is no longer active', 409);
        return this.run(db, agent.id, runId);
    }
    private async saveRun(db: Db, run: RunState): Promise<void> {
        validateRun(run);
        await db.execute('UPDATE runs SET state = ? WHERE id = ?', [encode(run), run.runId]);
    }
    async createAgent(agentId: string = randomUUID(), entries: ContextEntry[] = []): Promise<CurrentState> {
        identity(agentId, 'agentId');
        validateEntries(entries);
        await this.transaction(async (db) => {
            await db.execute('INSERT INTO agents (id, context_length) VALUES (?, ?)', [agentId, entries.length]);
            await this.writeContext(db, agentId, entries);
            await this.hooks.created?.(db, agentId);
        });
        return this.getState(agentId);
    }
    async listAgents(): Promise<string[]> {
        const result = await rows(this.pool, 'SELECT id FROM agents ORDER BY id');
        return result.map(row => row.id as string);
    }
    // Read in primary-key position order; the identity index can trigger a filesort of large JSON bodies.
    private async contextRows(db: Db, agent: AgentRecord): Promise<ContextHistory> {
        const records = await rows(db, 'SELECT position,id,entry FROM agent_context_entries FORCE INDEX (PRIMARY) WHERE agent_id = ? ORDER BY position', [agent.id]);
        if (records.length !== agent.contextLength || records.some((row, index) => row.position !== index + 1))
            throw new AppError('corrupt_data', 'Context row order or length is invalid', 500);
        const entries = records.map(row => decode<ContextEntry>(row.entry, value => validateEntries([value])));
        if (entries.some((entry, index) => entry.messageId !== records[index]!.id))
            throw new AppError('corrupt_data', 'Context row identity is invalid', 500);
        validateEntries(entries);
        return {revision: agent.contextRevision, entries};
    }
    async getReactHarnessData(agentId: string, harnessId: string): Promise<ReactHarnessData> {
        identity(agentId, 'agentId'); identity(harnessId, 'harnessId');
        return this.transaction(async db => {
            await this.agent(db, agentId);
            const [row] = await rows(db, 'SELECT revision,data FROM agent_assistant_response_handler_state WHERE agent_id = ? AND handler_id = ?', [agentId, harnessId]);
            if (!row) return {revision: 0, data: {}};
            const value = {revision: row.revision, data: decode<Record<string, unknown>>(row.data, data => validateReactHarnessData({revision: row.revision, data}))};
            validateReactHarnessData(value);
            return structuredClone(value);
        });
    }
    async saveReactHarnessData(agentId: string, harnessId: string, revision: number, data: Record<string, unknown>): Promise<ReactHarnessData> {
        identity(agentId, 'agentId'); identity(harnessId, 'harnessId'); position(revision);
        const next = {revision: revision + 1, data: structuredClone(data)};
        validateReactHarnessData(next);
        return this.transaction(async db => {
            await this.agent(db, agentId, true);
            const [row] = await rows(db, 'SELECT revision FROM agent_assistant_response_handler_state WHERE agent_id = ? AND handler_id = ? FOR UPDATE', [agentId, harnessId]);
            if (!row) {
                if (revision !== 0) throw new AppError('context_conflict', 'React Harness state revision changed', 409);
                await db.execute('INSERT INTO agent_assistant_response_handler_state (agent_id,handler_id,revision,data) VALUES (?,?,?,?)', [agentId, harnessId, next.revision, encode(next.data)]);
            } else {
                if (row.revision !== revision) throw new AppError('context_conflict', 'React Harness state revision changed', 409);
                const [result] = await db.execute<ResultSetHeader>('UPDATE agent_assistant_response_handler_state SET revision = ?, data = ? WHERE agent_id = ? AND handler_id = ? AND revision = ?', [next.revision, encode(next.data), agentId, harnessId, revision]);
                if (result.affectedRows !== 1) throw new AppError('context_conflict', 'React Harness state revision changed', 409);
            }
            return structuredClone(next);
        });
    }
    async getContext(agentId: string): Promise<ContextHistory> {
        return this.transaction(async db => this.contextRows(db, await this.agent(db, agentId)));
    }
    /** Startup-only attribution migration; update changed rows without touching stable history. */
    async refreshSharedAttribution(agentId: string, groupId: string, groups: readonly GroupContextMessage[]): Promise<void> {
        await this.transaction(async db => {
            const agent = await this.agent(db, agentId, true);
            if (agent.contextFormat !== 1) return; // Legacy adoption below uses the current shared envelopes.
            const context = await this.contextRows(db, agent);
            const update = sharedAttributionUpdates(context.entries, groupId, groups);
            if (update.length) await this.inTransaction(db).patchContext(agentId, context.revision, {append: [], update});
        });
    }
    /** Detached, bounded SQL read; no runtime lease, resident context, repair or synchronization. */
    async inspectContext(agentId: string, options: ContextPageInput = {}): Promise<ContextPage<ContextEntry>> {
        const input = contextPageInput(options);
        return this.transaction(async db => {
            const agent = await this.agent(db, agentId);
            if (agent.contextFormat !== 1) throw new AppError('runtime_unavailable', 'Agent context migration is incomplete', 503);
            checkContextPage(agent.contextRevision, agent.contextLength, input);
            const records = await rows(db, 'SELECT position,id,entry FROM agent_context_entries FORCE INDEX (PRIMARY) WHERE agent_id = ? AND position > ? ORDER BY position LIMIT ' + input.limit, [agentId, input.offset]);
            const expected = Math.min(input.limit, agent.contextLength - input.offset);
            if (records.length !== expected || records.some((row, index) => row.position !== input.offset + index + 1))
                throw new AppError('corrupt_data', 'Context page order or length is invalid', 500);
            const entries = records.map(row => {
                const entry = decode<ContextEntry>(row.entry, value => validateEntries([value]));
                if (entry.messageId !== row.id) throw new AppError('corrupt_data', 'Context row identity is invalid', 500);
                return entry;
            });
            const next = input.offset + entries.length;
            return { revision: agent.contextRevision, offset: input.offset, total: agent.contextLength, nextOffset: next < agent.contextLength ? next : null, entries };
        });
    }
    residentContext(agentId: string) {
        if (this.connection) throw new AppError('context_conflict', 'Resident context cannot be loaded from an uncommitted transaction', 409);
        return this.contexts.get(agentId, () => this.getContext(agentId));
    }
    private acknowledge(db: PoolConnection, id: string, change: ContextChange): void {
        const saved = structuredClone(change);
        this.storage.afterCommit(db, () => this.contexts.changed(id, saved), () => this.contexts.invalidate(id));
    }
    private async writeContext(db: Db, id: string, entries: ContextEntry[]): Promise<void> {
        await db.execute('DELETE FROM agent_context_entries WHERE agent_id = ?', [id]);
        await insertRows(db, 'INSERT INTO agent_context_entries (agent_id,position,id,entry) VALUES ?',
            entries.map((entry, index) => [id, index + 1, entry.messageId, encode(entry)]));
    }
    async replaceContext(agentId: string, revision: number, entries: ContextEntry[]): Promise<ContextHistory> {
        position(revision);
        validateEntries(entries);
        const saved = structuredClone(entries);
        await this.transaction(async db => {
            const agent = await this.agent(db, agentId, true);
            if (agent.contextRevision !== revision) throw new AppError('context_conflict', 'Context revision changed', 409);
            await this.writeContext(db, agentId, saved);
            await db.execute('UPDATE agents SET context_length = ?, context_revision = context_revision + 1 WHERE id = ?', [saved.length, agentId]);
            this.acknowledge(db, agentId, {baseRevision: revision, revision: revision + 1, replace: saved});
        });
        return {revision: revision + 1, entries: saved};
    }
    async patchContext(agentId: string, revision: number, patch: ContextPatch): Promise<void> {
        position(revision);
        validateEntries([...patch.update, ...patch.append]);
        if (!patch.update.length && !patch.append.length && !patch.metadata?.length) return;
        const saved = structuredClone(patch);
        await this.transaction(async db => {
            const agent = await this.agent(db, agentId, true);
            if (agent.contextRevision !== revision) throw new AppError('context_conflict', 'Context revision changed', 409);
            await this.writeContextMetadata(db, agentId, saved.metadata ?? []);
            for (const entry of saved.update) {
                const [result] = await db.execute<ResultSetHeader>('UPDATE agent_context_entries SET entry = ? WHERE agent_id = ? AND id = ?', [encode(entry), agentId, entry.messageId]);
                if (result.affectedRows !== 1) throw new AppError('context_conflict', 'Context entry no longer exists', 409);
            }
            await insertRows(db, 'INSERT INTO agent_context_entries (agent_id,position,id,entry) VALUES ?',
                saved.append.map((entry, index) => [agentId, agent.contextLength + index + 1, entry.messageId, encode(entry)]));
            await db.execute('UPDATE agents SET context_length = ?, context_revision = context_revision + 1 WHERE id = ?', [agent.contextLength + saved.append.length, agentId]);
            this.acknowledge(db, agentId, {baseRevision: revision, revision: revision + 1, patch: saved});
        });
    }
    private async writeContextMetadata(db: Db, agentId: string, updates: ContextMetadataUpdate[]): Promise<void> {
        for (const update of updates) {
            identity(update.messageId, 'messageId');
            const [result] = await db.execute<ResultSetHeader>("UPDATE agent_context_entries SET entry = JSON_SET(entry, '$.data.metadata', CAST(? AS JSON)) WHERE agent_id = ? AND id = ?", [JSON.stringify(update.metadata), agentId, update.messageId]);
            if (result.affectedRows !== 1) throw new AppError('context_conflict', 'Context entry no longer exists', 409);
        }
    }
    private async append(db: PoolConnection, agent: AgentRecord, runId: string, entry: ContextEntry, metadataUpdates: ContextMetadataUpdate[] = []): Promise<CompletedMessage> {
        validateEntries([entry]);
        const next = agent.historyPosition + 1;
        position(next);
        const serialized = encode(entry);
        await this.writeContextMetadata(db, agent.id, metadataUpdates);
        await db.execute('INSERT INTO messages (agent_id, position, id, run_id, entry) VALUES (?, ?, ?, ?, ?)', [agent.id, next, entry.messageId, runId, serialized]);
        await db.execute('INSERT INTO agent_context_entries (agent_id,position,id,entry) VALUES (?, ?, ?, ?)', [agent.id, agent.contextLength + 1, entry.messageId, serialized]);
        await db.execute('UPDATE agents SET history_position = ?, context_length = context_length + 1, context_revision = context_revision + 1 WHERE id = ?', [next, agent.id]);
        this.acknowledge(db, agent.id, {baseRevision: agent.contextRevision, revision: agent.contextRevision + 1, patch: {append: [entry], update: [], ...(metadataUpdates.length ? {metadata: metadataUpdates} : {})}});
        return { ...entry, agentId: agent.id, runId, position: next };
    }
    async startRun(agentId: string, input: UserMessage, runId: string = randomUUID()): Promise<RunState> {
        identity(runId, 'runId');
        if (input.role !== 'user')
            throw new AppError('invalid_data', 'Starting a run requires a user message');
        const state: RunState = { agentId, runId, status: 'running', phase: 'model', step: 0, startedAt: Date.now(), endedAt: null, endPosition: null, activeMessageId: null, error: null };
        await this.transaction(async (db) => {
            const agent = await this.agent(db, agentId, true);
            if (agent.activeRunId)
                throw new AppError('agent_busy', 'Agent already has an active run', 409);
            await db.execute('INSERT INTO runs (id, agent_id, state) VALUES (?, ?, ?)', [runId, agentId, encode(state)]);
            await this.append(db, agent, runId, { messageId: randomUUID(), message: input, metadata: {} });
            await db.execute('UPDATE agents SET active_run_id = ?, latest_run_id = ? WHERE id = ?', [runId, runId, agentId]);
        });
        return state;
    }
    async beginMessage(agentId: string, runId: string, messageId: string, step: number): Promise<number> {
        identity(messageId, 'messageId');
        return this.transaction(async (db) => {
            const agent = await this.agent(db, agentId, true);
            const run = await this.active(db, agent, runId);
            if (run.activeMessageId)
                throw new AppError('conflict', 'A model message is already active', 409);
            await this.saveRun(db, { ...run, phase: 'model', step, activeMessageId: messageId });
            return agent.historyPosition as number;
        });
    }
    async commitMessage(agentId: string, runId: string, entry: ContextEntry, metadataUpdates: ContextMetadataUpdate[] = []): Promise<CompletedMessage> {
        validateEntries([entry]);
        if (entry.message.role === 'assistant' && !['stop', 'length', 'toolUse'].includes(entry.message.stopReason))
            throw new AppError('invalid_data', 'Only finished model responses can be committed');
        return this.transaction(async (db) => {
            const agent = await this.agent(db, agentId, true);
            const run = await this.active(db, agent, runId);
            if (entry.message.role === 'assistant' && run.activeMessageId !== entry.messageId)
                throw new AppError('conflict', 'Assistant message identity does not match active message', 409);
            const record = await this.append(db, agent, runId, entry, metadataUpdates);
            if (run.activeMessageId === entry.messageId) {
                await this.saveRun(db, { ...run, activeMessageId: null, phase: 'tools' });
            }
            return record;
        });
    }
    /** New result, targeted visibility/argument metadata and small handler state acknowledge together. */
    async commitReactHarnessMessage(record: CompletedMessage, effects: ReactHarnessMessageEffects): Promise<CompletedMessage> {
        return this.transaction(async db => {
            const session = this.inTransaction(db);
            let saved: CompletedMessage;
            if (record.metadata.source === 'context-compaction') {
                saved = await session.commitCompactionMessage(record);
                const [row] = await rows(db, 'SELECT state FROM context_compactions WHERE id = ? AND agent_id = ? FOR UPDATE', [String(record.metadata.compactionId), record.agentId]);
                const state = decode<CompactionState>(row!.state, validateCompactionState);
                const updates = new Map((state.contextMetadata ?? []).map(update => [update.messageId, update]));
                for (const update of effects.metadataUpdates) updates.set(update.messageId, update);
                await db.execute('UPDATE context_compactions SET state = ? WHERE id = ?', [encode({...state, contextMetadata: [...updates.values()]}), String(record.metadata.compactionId)]);
            } else saved = await session.commitMessage(record.agentId, record.runId, {messageId: record.messageId, message: record.message, metadata: record.metadata}, effects.metadataUpdates);
            await session.saveReactHarnessData(record.agentId, effects.harnessId, effects.revision, effects.data);
            return saved;
        });
    }
    async beginCompaction(state: CompactionState): Promise<void> {
        validateCompactionState(state);
        if (state.status !== 'preparing')
            throw new AppError('invalid_data', 'Compaction must start in preparation');
        await this.transaction(async (db) => {
            const agent = await this.agent(db, state.agentId, true);
            await this.run(db, state.agentId, state.runId);
            await db.execute('INSERT INTO context_compactions (id, agent_id, run_id, active_agent_id, history_after, state) VALUES (?, ?, ?, ?, ?, ?)', [state.id, state.agentId, state.runId, state.agentId, agent.historyPosition, encode(state)]);
        });
    }
    /** Tentative preparation is stable private history, not current model context or a new run. */
    async commitCompactionMessage(record: CompletedMessage): Promise<CompletedMessage> {
        validateEntries([record]);
        identity(record.metadata.compactionId, 'compactionId');
        if (record.metadata.source !== 'context-compaction')
            throw new AppError('invalid_data', 'Compaction message source is required');
        return this.transaction(async (db) => {
            const agent = await this.agent(db, record.agentId, true);
            const [row] = await rows(db, 'SELECT state FROM context_compactions WHERE id = ? AND agent_id = ? AND run_id = ? AND active_agent_id = ?', [String(record.metadata.compactionId), record.agentId, record.runId, record.agentId]);
            if (!row || decode<CompactionState>(row.state, validateCompactionState).status !== 'preparing')
                throw new AppError('context_conflict', 'Compaction is not preparing', 409);
            const position = agent.historyPosition + 1;
            const entry = { messageId: record.messageId, message: record.message, metadata: record.metadata };
            await db.execute('INSERT INTO messages (agent_id, position, id, run_id, entry) VALUES (?, ?, ?, ?, ?)', [record.agentId, position, record.messageId, record.runId, encode(entry)]);
            await db.execute('UPDATE agents SET history_position = ? WHERE id = ?', [position, record.agentId]);
            return { ...record, position };
        });
    }
    async finishCompaction(state: CompactionState, revision: number, entries: ContextEntry[]): Promise<ContextHistory> {
        validateCompactionState(state);
        position(revision);
        validateEntries(entries);
        if (state.status === 'preparing')
            throw new AppError('invalid_data', 'A terminal compaction state is required');
        await this.transaction(async (db) => {
            const agent = await this.agent(db, state.agentId, true);
            const [row] = await rows(db, 'SELECT state FROM context_compactions WHERE id = ? AND agent_id = ? AND run_id = ? AND active_agent_id = ?', [state.id, state.agentId, state.runId, state.agentId]);
            if (!row || decode<CompactionState>(row.state, validateCompactionState).status !== 'preparing' || agent.contextRevision !== revision)
                throw new AppError('context_conflict', 'Context or compaction state changed', 409);
            await this.writeContext(db, state.agentId, entries);
            await db.execute('UPDATE agents SET context_length = ?, context_revision = context_revision + 1 WHERE id = ?', [entries.length, state.agentId]);
            this.acknowledge(db, state.agentId, {baseRevision: agent.contextRevision, revision: agent.contextRevision + 1, replace: entries});
            await db.execute('UPDATE context_compactions SET state = ?, active_agent_id = NULL WHERE id = ?', [encode(state), state.id]);
        });
        return { revision: revision + 1, entries: structuredClone(entries) };
    }
    async recoverCompactions(): Promise<void> {
        this.assertRuntime();
        const pending = await rows(this.pool, 'SELECT id, agent_id FROM context_compactions WHERE active_agent_id IS NOT NULL');
        for (const item of pending)
            await this.transaction(async (db) => {
                const agent = await this.agent(db, item.agent_id, true);
                const [row] = await rows(db, 'SELECT * FROM context_compactions WHERE id = ? AND active_agent_id IS NOT NULL', [item.id]);
                if (!row)
                    return;
                const state = decode<CompactionState>(row.state, validateCompactionState);
                const records = await rows(db, 'SELECT entry FROM messages WHERE agent_id = ? AND position > ? AND run_id = ? ORDER BY position', [state.agentId, row.history_after, state.runId]);
                const trace = records.map(row => decode<ContextEntry>(row.entry, value => validateEntries([value]))).filter(entry => entry.metadata.compactionId === state.id);
                const error = { code: 'runtime_restarted', message: 'Runtime stopped during context preparation; recorded effects were not replayed' };
                const entries = interruptedCompactionContext({ revision: agent.contextRevision, entries: (await this.contextRows(db, agent)).entries }, trace, error);
                const metadata = new Map((state.contextMetadata ?? []).map(update => [update.messageId, update.metadata]));
                for (const entry of entries) { const update = metadata.get(entry.messageId); if (update) entry.metadata = update; }
                await this.writeContext(db, state.agentId, entries);
                await db.execute('UPDATE agents SET context_length = ?, context_revision = context_revision + 1 WHERE id = ?', [entries.length, state.agentId]);
                this.acknowledge(db, state.agentId, {baseRevision: agent.contextRevision, revision: agent.contextRevision + 1, replace: entries});
                await db.execute('UPDATE context_compactions SET state = ?, active_agent_id = NULL WHERE id = ?', [encode({ ...state, status: 'failed', endedAt: Date.now(), error }), state.id]);
            });
    }
    async finishRun(agentId: string, runId: string, status: Exclude<RunStatus, 'running'>, error: RunState['error'] = null): Promise<RunState> {
        return this.transaction(async (db) => {
            const agent = await this.agent(db, agentId, true);
            const existing = await this.run(db, agentId, runId);
            if (existing.status !== 'running')
                return existing;
            const run = await this.active(db, agent, runId);
            const finished: RunState = { ...run, status, phase: 'finished', activeMessageId: null, endedAt: Date.now(), endPosition: agent.historyPosition, error };
            await this.saveRun(db, finished);
            await db.execute('UPDATE agents SET active_run_id = NULL WHERE id = ?', [agentId]);
            await this.hooks.finished?.(db, finished);
            return finished;
        });
    }
    async recoverInterruptedRuns(beforeFinish?: (run: {
        agentId: string;
        runId: string;
    }) => Promise<void>): Promise<void> {
        this.assertRuntime();
        const active = await rows(this.pool, 'SELECT id, active_run_id FROM agents WHERE active_run_id IS NOT NULL');
        for (const agent of active) {
            await beforeFinish?.({ agentId: agent.id, runId: agent.active_run_id });
            await this.finishRun(agent.id, agent.active_run_id, 'interrupted', { code: 'runtime_restarted', message: 'Runtime stopped before the run finished' });
        }
    }
    async getState(agentId: string): Promise<CurrentState> {
        return (await this.followSnapshot(agentId, undefined, 0, false)).state;
    }
    async followSnapshot(agentId: string, runId: string | null | undefined = undefined, after = 0, includeHistory = true): Promise<FollowSnapshot> {
        position(after);
        return this.transaction(async (db) => {
            identity(agentId, 'agentId');
            const [agent] = await rows(db, 'SELECT id, latest_run_id, history_position, context_revision FROM agents WHERE id = ?', [agentId]);
            if (!agent)
                throw new AppError('not_found', 'Agent not found', 404);
            const selected = runId === undefined ? agent.latest_run_id : runId;
            const run = selected ? await this.run(db, agentId, selected) : null;
            const upper = run?.endPosition ?? agent.history_position;
            if (after > upper)
                throw new AppError('invalid_cursor', 'History cursor is ahead of this run', 409);
            const records = includeHistory ? await rows(db, 'SELECT * FROM messages WHERE agent_id = ? AND position > ? AND position <= ? ORDER BY position', [agentId, after, upper]) : [];
            const history = records.map(row => {
                const entry = decode<ContextEntry>(row.entry, value => validateEntries([value]));
                return { ...entry, agentId, runId: row.run_id as string, position: row.position as number };
            });
            return { state: { agentId, contextRevision: agent.context_revision, historyPosition: upper, run }, history };
        });
    }
    /** The completed messages of one run, in order. A run is short, so this does not read the agent's whole history. */
    async runMessages(agentId: string, runId: string): Promise<CompletedMessage[]> {
        identity(agentId, 'agentId');
        identity(runId, 'runId');
        const records = await rows(this.pool, 'SELECT position, entry FROM messages WHERE agent_id = ? AND run_id = ? ORDER BY position', [agentId, runId]);
        return records.map(row => ({ ...decode<ContextEntry>(row.entry, value => validateEntries([value])), agentId, runId, position: row.position as number }));
    }
    /** Original shared content in one repeatable-read view. Agent owns the requested consumption position. */
    async createRecord(agentId: string, entries: ContextEntry[] = []): Promise<void> {
        identity(agentId, 'agentId');
        validateEntries(entries);
        await this.transaction(async db => {
            await db.execute('INSERT INTO agents (id,context_length) VALUES (?, ?)', [agentId, entries.length]);
            await this.writeContext(db, agentId, entries);
        });
    }
    async readRun(runId: string): Promise<RunState> {
        identity(runId, 'runId');
        const [row] = await rows(this.pool, 'SELECT state FROM runs WHERE id = ?', [runId]);
        if (!row)
            throw new AppError('not_found', 'Run not found', 404);
        return decode<RunState>(row.state, validateRun);
    }
    async readRuns(runIds: string[]): Promise<RunState[]> {
        if (!runIds.length)
            return [];
        for (const id of runIds)
            identity(id, 'runId');
        const [found] = await this.pool.query<RowDataPacket[]>('SELECT state FROM runs WHERE id IN (?) ORDER BY id', [runIds]);
        return found.map(row => decode<RunState>(row.state, validateRun));
    }
    async activeRuns(runIds: string[]): Promise<RunState[]> {
        if (!runIds.length)
            return [];
        for (const id of runIds)
            identity(id, 'runId');
        const [found] = await this.pool.query<RowDataPacket[]>('SELECT r.state FROM runs r JOIN agents a ON a.active_run_id = r.id WHERE r.id IN (?) ORDER BY r.id', [runIds]);
        return found.map(row => decode<RunState>(row.state, validateRun));
    }
    async legacyContextIds(): Promise<string[]> {
        return (await rows(this.pool, 'SELECT id FROM agents WHERE context_format = 0')).map(row => row.id as string);
    }
    async listRuns(agentIds: string[]): Promise<RunState[]> {
        if (!agentIds.length)
            return [];
        for (const id of agentIds)
            identity(id, 'agentId');
        const [found] = await this.pool.query<RowDataPacket[]>('SELECT state FROM runs WHERE agent_id IN (?) ORDER BY id', [agentIds]);
        return found.map(row => decode<RunState>(row.state, validateRun));
    }
    async completedMessage(agentId: string, selector: {
        messageId: string;
    } | {
        position: number;
    }): Promise<CompletedMessage | null> {
        identity(agentId, 'agentId');
        const byId = 'messageId' in selector;
        const [row] = await rows(this.pool, `SELECT position,id,run_id,entry FROM messages WHERE agent_id = ? AND ${byId ? 'id' : 'position'} = ?`, [agentId, byId ? selector.messageId : selector.position]);
        return row ? { ...decode<ContextEntry>(row.entry, value => validateEntries([value])), agentId, runId: row.run_id, position: row.position } : null;
    }
    async admitRun(agentId: string): Promise<RunState> {
        return this.transaction(async (db) => {
            const agent = await this.agent(db, agentId, true);
            if (agent.activeRunId)
                throw new AppError('agent_busy', 'Agent already has an active run', 409);
            const run: RunState = { agentId, runId: randomUUID(), status: 'running', phase: 'model', step: 0, startedAt: Date.now(), endedAt: null, endPosition: null, activeMessageId: null, error: null };
            await db.execute('INSERT INTO runs (id,agent_id,state) VALUES (?,?,?)', [run.runId, agentId, encode(run)]);
            await db.execute('UPDATE agents SET active_run_id = ?, latest_run_id = ? WHERE id = ?', [run.runId, run.runId, agentId]);
            return run;
        });
    }
    /** Publication coordinates its own presentation write in the same transaction. */
    async completePublishedRun(agentId: string, runId: string): Promise<RunState> {
        return this.transaction(async (db) => {
            const agent = await this.agent(db, agentId, true), run = await this.active(db, agent, runId);
            if (run.activeMessageId)
                throw new AppError('conflict', 'Finish the private response before publication', 409);
            const finished: RunState = { ...run, status: 'completed', phase: 'finished', endedAt: Date.now(), endPosition: agent.historyPosition };
            await this.saveRun(db, finished);
            await db.execute('UPDATE agents SET active_run_id = NULL WHERE id = ?', [agentId]);
            return finished;
        });
    }
    async adoptLegacyContext(agentId: string, group: import('./context.js').GroupContextReference): Promise<void> {
        await this.transaction(async (db) => {
            const agent = await this.agent(db, agentId, true);
            if (agent.contextFormat !== 0)
                return;
            const recorded = await rows(db, 'SELECT entry FROM messages WHERE agent_id = ? ORDER BY position', [agentId]);
            const entries = adoptRecordedContext(agentId, group.id, (await this.contextRows(db, agent)).entries, recorded.map(row => decode<ContextEntry>(row.entry, value => validateEntries([value]))), await group.read(0));
            await this.writeContext(db, agentId, entries);
            await db.execute('UPDATE agents SET context_length = ?, context_revision = context_revision + 1, context_format = 1 WHERE id = ?', [entries.length, agentId]);
            this.acknowledge(db, agentId, {baseRevision: agent.contextRevision, revision: agent.contextRevision + 1, replace: entries});
        });
    }
    async finishLegacyMigration(): Promise<void> {
        await this.pool.query('UPDATE agents SET context_format = 1 WHERE context_format = 0');
        await this.pool.query('DROP TABLE IF EXISTS member_context_runs');
        await this.pool.query('DROP TABLE IF EXISTS member_contexts');
    }
    async resetConversations(ids: string[]): Promise<void> {
        await this.transaction(async (db) => {
            for (const id of ids) {
                const agent = await this.agent(db, id, true);
                if (agent.activeRunId)
                    throw new AppError('workspace_busy', 'Stop team work before resetting context', 409);
                for (const table of ['context_compactions', 'messages', 'runs', 'agent_assistant_response_handler_state'])
                    await db.execute(`DELETE FROM ${table} WHERE agent_id = ?`, [id]);
                await this.writeContext(db, id, []);
                await db.execute('UPDATE agents SET context_length = 0, context_revision = context_revision + 1, history_position = 0, active_run_id = NULL, latest_run_id = NULL WHERE id = ?', [id]);
                this.acknowledge(db, id, {baseRevision: agent.contextRevision, revision: agent.contextRevision + 1, replace: []});
            }
        });
    }
    async clearHistory(): Promise<void> { await clearTables(this.pool, ['context_compactions', 'agent_assistant_response_handler_state', 'agent_context_entries', 'messages', 'runs']); }
    async deleteRecords(): Promise<void> {
        await clearTables(this.pool, ['agents']);
        if (this.connection) this.storage.afterCommit(this.connection, () => this.contexts.clear());
        else this.contexts.clear();
    }
}
