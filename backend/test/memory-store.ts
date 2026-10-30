import { contextPageInput, checkContextPage, type ContextPageInput } from '../src/core/context-page.js';
import { imageContent, type PreparedChatImage } from '../src/core/team/data/chat-images.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {WorkspaceStore,WorkspaceRecord,MemberBaseline} from '../src/core/workspace/data/model.js';
import type { WorkspaceBootstrap } from '../src/core/workspace-bootstrap.js';
import type { MemberRecord, NewMember, StoredMember, TeamStore, MemberActivation, MemberActivationState } from '../src/core/team/data/members.js';
import { randomUUID } from 'node:crypto';
import { AgentMessageContext, type GroupContextMessage } from '../src/core/agent/data/context.js';
import { chatHistoryInput, groupEntry, groupSender, type ChatHistoryInput, type ChatHistoryPage, type ChatStore, type ChatMessage, type ChatPublication, type ChatSnapshot, type TimelineEntry, type TimelineSnapshot } from '../src/core/team/data/group-chat.js';
import type { ContextEntry, RunState } from '../src/core/agent/data/model.js';
import { AppError } from '../src/core/agent/data/model.js';
import { defaultRunSettings, type WorkspaceModels, type StoredWorkspaceModels } from '../src/core/workspace/data/models.js';
import { generatedSource } from '../src/core/team/data/member-config.js';
import type { RunSettings } from '../src/core/team/data/config.js';

export const testModels = (connectionId = 'conn', modelId = 'model'): WorkspaceModels => ({ models: [{ connectionId, modelId }], defaultModel: { connectionId, modelId } });
export const testModelValidator = { issuesFor: async (settings: readonly RunSettings[]) => settings.map(s => s.connectionId && s.modelId ? [] : ['Select a provider and model']) };

interface Stored {record:WorkspaceRecord;key:string}

/** Workspace, member and conversation persistence used by tests; project context stays in files. */
export class MemoryStore implements WorkspaceStore, TeamStore, ChatStore {
  async initialMemberFiles(id:string){const files:Record<string,string>={};for(const member of await this.listMembers(id))if(member.value.retiredAt===null&&member.value.configuration){const source=member.value.configuration;for(const [path,text]of Object.entries(source.files))files[`${source.path.slice(0,source.path.lastIndexOf('/'))}/${path}`]=text;}return files;}

  readonly memberBaselines = new Map<string, MemberBaseline>();
  async getMemberBaseline(id: string) { return structuredClone(this.memberBaselines.get(id) ?? null); }
  async initializeMemberBaseline(id: string, value: MemberBaseline) { if(!this.memberBaselines.has(id))this.memberBaselines.set(id,structuredClone(value));return (await this.getMemberBaseline(id))!; }
  readonly workspaces = new Map<string, Stored>();
  readonly members = new Map<string, { member: StoredMember; lead: boolean; nameKey: string | null; ordinal: number }>();
  readonly workspaceModels = new Map<string, StoredWorkspaceModels>();
  readonly memberActivations = new Map<string, MemberActivationState>();
  async getMemberActivation(workspaceId: string) { return structuredClone(this.memberActivations.get(workspaceId) ?? null); }
  private ordinal = 0;

  readonly timelineChanges = new Map<string, { cursor: number; entry: TimelineEntry }[]>();
  private resets = new Map<string, { resetCursor: number; resetPosition: number }>();
  private timelinePositions = new Map<string, number>();
  private timelineEntries = new Map<string, TimelineEntry>();
  private writeEntry(entry: TimelineEntry) {
    const changes = this.timelineChanges.get(entry.workspaceId) ?? [];
    const entries = [...this.timelineEntries.values()].filter(item => item.workspaceId === entry.workspaceId);
    entry.position ||= Math.max(this.timelinePositions.get(entry.workspaceId) ?? 0, ...entries.map(item => item.position)) + 1;
    this.timelinePositions.set(entry.workspaceId, Math.max(this.timelinePositions.get(entry.workspaceId) ?? 0, entry.position));
    entry.revision = (changes.at(-1)?.cursor ?? this.resets.get(entry.workspaceId)?.resetCursor ?? 0) + 1;
    this.timelineEntries.set(entry.entryId, structuredClone(entry));
    changes.push({ cursor: entry.revision, entry: structuredClone(entry) });
    this.timelineChanges.set(entry.workspaceId, changes);
    return entry;
  }
  finishEntry(run: RunState) {
    const entry = this.timelineEntries.get(run.runId);
    if (entry?.kind === 'member' && entry.run.status === 'running') this.writeEntry({ ...entry, run: structuredClone(run), working: { ...entry.working, through: run.endPosition } });
  }
  async chatTimeline(workspaceId: string, after = 0, limit = 100): Promise<TimelineSnapshot> {
    this.stored(workspaceId);
    const all = this.timelineChanges.get(workspaceId) ?? [];
    const changes = all.filter(item => item.cursor > after).slice(0, limit);
    return { workspaceId, resetCursor: this.resets.get(workspaceId)?.resetCursor ?? 0, cursor: all.at(-1)?.cursor ?? this.resets.get(workspaceId)?.resetCursor ?? 0, changes: structuredClone(changes), more: all.some(item => item.cursor > (changes.at(-1)?.cursor ?? after)), mentionLimit: this.limits.get(workspaceId) ?? 32 };
  }
  async chatHistory(workspaceId: string, options: ChatHistoryInput = {}): Promise<ChatHistoryPage> {
    this.stored(workspaceId);
    const input = chatHistoryInput(options), resetCursor = this.resets.get(workspaceId)?.resetCursor ?? 0;
    if (input.resetCursor !== undefined && input.resetCursor !== resetCursor) throw new AppError('history_reset', 'Chat was reset; reload the latest history', 409);
    const all = [...this.timelineEntries.values()].filter(entry => entry.workspaceId === workspaceId && (input.before === undefined || entry.position < input.before)).sort((a,b) => a.position - b.position);
    const entries = structuredClone(all.slice(-input.limit)), hasOlder = all.length > input.limit;
    return {workspaceId, cursor: this.timelineChanges.get(workspaceId)?.at(-1)?.cursor ?? resetCursor, resetCursor, entries, hasOlder, nextBefore: hasOlder ? entries[0]!.position : null};
  }
  readonly chatImages = new Map<string, PreparedChatImage>();
  async chatImage(workspaceId: string, id: string) {
    const image = this.chatImages.get(`${workspaceId}:${id}`);
    if (!image) throw new AppError('not_found', 'Picture not found', 404);
    return image;
  }
  readonly chatMessages = new Map<string, ChatMessage[]>();
  readonly chatRuns = new Map<string, { exchangeId: string; run: RunState }>();
  readonly agentContexts = new Map<string, ContextEntry[]>();
  private readonly limits = new Map<string, number>();
  private readonly exchanges = new Map<string, { used: number; limit: number; stopped: boolean }>();
  onPublicationComplete?: (runId: string) => void;
  failNextPublication = false;

  async publishChat(input: ChatPublication) {
    if (input.author.type === 'member' && input.recipients.length > 1) throw new AppError('invalid_mentions', 'An agent response can mention at most one member');
    this.stored(input.workspaceId);
    const active = [...this.chatRuns.values()].filter(item => item.run.status === 'running');
    for (const id of input.recipients) if (active.some(item => item.run.agentId === id)) throw new AppError('member_busy', 'Member is working', 409);
    for (const id of input.recipients) if (input.memberRevisions && this.members.get(id)?.member.revision !== input.memberRevisions[id]) throw new AppError('config_conflict', 'Recipient configuration changed', 409);
    const exchangeId = input.exchangeId ?? randomUUID();
    const exchange = this.exchanges.get(exchangeId) ?? { used: 0, limit: this.limits.get(input.workspaceId) ?? 32, stopped: false };
    if (exchange.stopped) throw new AppError('exchange_stopped', 'Exchange stopped', 409);
    if (exchange.used + input.recipients.length > exchange.limit) throw new AppError('mention_limit', 'Mention limit reached', 409);
    if (this.failNextPublication) { this.failNextPublication = false; throw new Error('injected publication failure'); }
    const messages = this.chatMessages.get(input.workspaceId) ?? [];
    const { images, ...publication } = input;
    for (const image of images ?? []) this.chatImages.set(`${input.workspaceId}:${image.metadata.id}`, image);
    const message: ChatMessage = { ...publication, recipientNames: input.recipients.map(id => this.members.get(id)!.member.value.name), ...(images?.length ? { attachments: images.map(image => image.metadata) } : {}), exchangeId, messageId: randomUUID(), position: (messages.at(-1)?.position ?? this.resets.get(input.workspaceId)?.resetPosition ?? 0) + 1, time: Date.now() };
    messages.push(structuredClone(message)); this.chatMessages.set(input.workspaceId, messages);
    exchange.used += input.recipients.length; this.exchanges.set(exchangeId, exchange);
    const entries: TimelineEntry[] = [];
    if (input.author.type === 'user') entries.push(this.writeEntry({ workspaceId: input.workspaceId, entryId: message.messageId, position: 0, revision: 0, exchangeId, time: message.time, kind: 'user', text: input.text, messageId: message.messageId, ...(message.attachments ? { attachments: message.attachments } : {}) }));
    else {
      this.onPublicationComplete?.(input.author.runId);
      const entry = this.timelineEntries.get(input.author.runId)!;
      if (entry.kind === 'member') entries.push(this.writeEntry({ ...entry, run: structuredClone(this.chatRuns.get(input.author.runId)!.run), text: input.text, working: { after: 0, through: 1 }, finalRef: { agentId: input.author.memberId, runId: input.author.runId, messageId: input.finalMessageId!, position: 1 } }));
    }

    const runs = input.recipients.map(agentId => {
      const run: RunState = { agentId, runId: randomUUID(), status: 'running', phase: 'model', step: 0, startedAt: Date.now(), endedAt: null, endPosition: null, activeMessageId: null, error: null };
      this.chatRuns.set(run.runId, { exchangeId, run });
      entries.push(this.writeEntry({ workspaceId: input.workspaceId, entryId: run.runId, position: 0, revision: 0, exchangeId, time: run.startedAt, kind: 'member', memberId: agentId, name: this.members.get(agentId)!.member.value.name, run: structuredClone(run), working: { after: 0, through: null }, finalRef: null, text: null })); return run;
    });
    return { message, runs, entries };
  }

  async inspectGroupContext(workspaceId: string, options: ContextPageInput = {}) {
    this.stored(workspaceId);
    const input = contextPageInput(options), all = this.chatMessages.get(workspaceId) ?? [];
    const revision = all.at(-1)?.position ?? this.resets.get(workspaceId)?.resetPosition ?? 0;
    checkContextPage(revision, all.length, input);
    const entries = all.slice(input.offset, input.offset + input.limit).map(message => groupEntry(message));
    const next = input.offset + entries.length;
    return { revision, offset: input.offset, total: all.length, nextOffset: next < all.length ? next : null, entries };
  }
  async readGroupContext(workspaceId: string, after: number): Promise<GroupContextMessage[]> {
    return (this.chatMessages.get(workspaceId) ?? []).filter(message => message.position > after).map(message => ({
      position: message.position, sender: groupSender(message),
      entry: groupEntry(message, (message.attachments ?? []).map(image => imageContent(this.chatImages.get(`${workspaceId}:${image.id}`)!))),
    }));
  }
  async syncMemberContext(memberId: string) {
    const member = this.members.get(memberId)!.member;
    const entries = await new AgentMessageContext(memberId, { revision: 0, entries: this.agentContexts.get(memberId) ?? [] })
      .incoming({ id: member.workspaceId, read: after => this.readGroupContext(member.workspaceId, after) });
    if (entries) this.agentContexts.set(memberId, entries);
  }

  async chatSnapshot(workspaceId: string, after = 0, limit = 100): Promise<ChatSnapshot> {
    this.stored(workspaceId);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AppError('invalid_input', 'Invalid cursor or limit');
    const all = this.chatMessages.get(workspaceId) ?? [];
    const upper = all.at(-1)?.position ?? this.resets.get(workspaceId)?.resetPosition ?? 0;
    if (after > upper) throw new AppError('invalid_cursor', 'Cursor ahead', 409);
    const messages = all.filter(item => item.position > after).slice(0, limit);
    return { workspaceId, resetPosition: this.resets.get(workspaceId)?.resetPosition ?? 0, position: upper, mentionLimit: this.limits.get(workspaceId) ?? 32, messages: structuredClone(messages), more: all.some(item => item.position > (messages.at(-1)?.position ?? after)), runs: [...this.chatRuns.values()].filter(item => this.members.get(item.run.agentId)?.member.workspaceId === workspaceId).map(item => structuredClone(item)) };
  }

  async configureChat(workspaceId: string, value: number) { this.stored(workspaceId); this.limits.set(workspaceId, value); }
  async stopChat(workspaceId: string) {
    this.stored(workspaceId);
    const runs = [...this.chatRuns.values()].filter(item => item.run.status === 'running' && this.members.get(item.run.agentId)?.member.workspaceId === workspaceId);
    for (const item of runs) this.exchanges.get(item.exchangeId)!.stopped = true;
    return runs.map(item => item.run);
  }

  async resetChat(workspaceId: string) {
    this.stored(workspaceId);
    const members = await this.listMembers(workspaceId);
    const runs = [...this.chatRuns.values()].filter(item => members.some(member => member.id === item.run.agentId));
    if (runs.some(item => item.run.status === 'running')) throw new AppError('workspace_busy', 'Workspace busy', 409);
    for (const key of this.chatImages.keys()) if (key.startsWith(`${workspaceId}:`)) this.chatImages.delete(key);
    const resetCursor = (await this.chatTimeline(workspaceId)).cursor + 1;
    const resetPosition = (await this.chatSnapshot(workspaceId)).position + 1;
    this.resets.set(workspaceId, { resetCursor, resetPosition });
    this.chatMessages.delete(workspaceId); this.timelineChanges.delete(workspaceId);
    for (const [id, entry] of this.timelineEntries) if (entry.workspaceId === workspaceId) this.timelineEntries.delete(id);
    for (const item of runs) { this.chatRuns.delete(item.run.runId); this.exchanges.delete(item.exchangeId); }
    for (const member of members) { this.agentContexts.set(member.id, []); }
    return { workspaceId, resetCursor, resetPosition };
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    return [...this.workspaces.values()].map(stored => stored.record).sort((a, b) => a.name.localeCompare(b.name) || a.workspaceId.localeCompare(b.workspaceId));
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    return this.workspaces.get(workspaceId)?.record ?? null;
  }

  async createWorkspace(record: WorkspaceRecord, key: string, lead: NewMember, models?: WorkspaceModels, bootstrap?: WorkspaceBootstrap): Promise<void> {
    if (this.workspaces.has(record.workspaceId) || [...this.workspaces.values()].some(stored => stored.key === key)) throw new AppError('workspace_exists', 'A workspace with this ID or folder already exists', 409);
    const members = structuredClone(this.members), contexts = structuredClone(this.agentContexts), ordinal = this.ordinal;
    this.workspaces.set(record.workspaceId, {record,key});
    try { await this.createMember(lead); if (models) this.workspaceModels.set(record.workspaceId, { revision: 0, value: structuredClone(models) });
      if (bootstrap) {
      this.memberBaselines.set(record.workspaceId, structuredClone(bootstrap.baseline)); this.memberActivations.set(record.workspaceId, structuredClone(bootstrap.activation)); }
    }
    catch (error) {
      // Like the real store's transaction: a workspace is never stored without its lead.
      this.workspaces.delete(record.workspaceId);this.memberBaselines.delete(record.workspaceId);
      this.workspaceModels.delete(record.workspaceId); this.memberActivations.delete(record.workspaceId);
      this.members.clear(); for (const [key,value] of members) this.members.set(key,value);
      this.agentContexts.clear(); for (const [key,value] of contexts) this.agentContexts.set(key,value); this.ordinal = ordinal;
      throw error;
    }
  }

  async getWorkspaceModels(id: string): Promise<StoredWorkspaceModels | null> { return structuredClone(this.workspaceModels.get(id) ?? null); }
  async saveWorkspaceModels(id: string, expected: number | null, value: WorkspaceModels, initializeLead: boolean): Promise<StoredWorkspaceModels> {
    this.stored(id);
    const previous = this.workspaceModels.get(id);
    if (previous ? previous.revision !== expected : expected !== null) throw new AppError('config_conflict', 'Workspace models changed', 409);
    const next = { revision: previous ? previous.revision + 1 : initializeLead ? 1 : 0, value: structuredClone(value) };
    if (initializeLead) {
      const entry = [...this.members.values()].find(m => m.member.workspaceId === id && m.lead);
      if (entry && entry.member.value.settings.connectionId === null && entry.member.value.settings.modelId === null) {
        const defaults = defaultRunSettings(value), member = entry.member;
        const updated = { ...member.value, settings: { ...member.value.settings, connectionId: defaults.connectionId, modelId: defaults.modelId, modelOptions: defaults.modelOptions } };
        updated.configuration = generatedSource(updated);
        if (member.value.configuration) updated.configuration.path = member.value.configuration.path;
        entry.member = { ...member, revision: member.revision + 1, value: updated };
      }
    }
    this.workspaceModels.set(id, next);
    return structuredClone(next);
  }

  async listMembers(workspaceId: string): Promise<StoredMember[]> {
    return [...this.members.values()].filter(item => item.member.workspaceId === workspaceId).sort((a, b) => a.ordinal - b.ordinal).map(item => structuredClone(item.member));
  }

  async getMember(memberId: string): Promise<StoredMember | null> {
    const item = this.members.get(memberId);
    return item ? structuredClone(item.member) : null;
  }

  async activateMembers(workspaceId: string, input: MemberActivation): Promise<void> {
    if (JSON.stringify(this.memberActivations.get(workspaceId) ?? null) !== JSON.stringify(input.expectedActivation)) throw new AppError('stale_revision', 'Configuration activation changed', 409);
    const active = (await this.listMembers(workspaceId)).filter(m => m.value.retiredAt === null);
    const expected = new Map(input.expected.map(m => [m.id,m.revision]));
    if (active.length !== expected.size || active.some(m => expected.get(m.id) !== m.revision)) throw new AppError('config_conflict','Team changed',409);
    if (this.workspaceModels.get(workspaceId)?.revision !== input.modelsRevision) throw new AppError('config_conflict','Workspace models changed',409);
    if ([...this.chatRuns.values()].some(({run}) => run.status === 'running' && active.some(m => m.id === run.agentId))) throw new AppError('workspace_busy','Workspace busy',409);
    const members = structuredClone(this.members), contexts = structuredClone(this.agentContexts), ordinal = this.ordinal;
    try {
      for (const next of input.update.slice().sort((a,b) => Number(b.value.retiredAt !== null)-Number(a.value.retiredAt !== null))) {
        const old = active.find(m => m.id === next.id);
        if (!old || next.revision !== old.revision+1 || old.value.lead !== next.value.lead || (old.value.lead && next.value.retiredAt !== null)) throw new AppError('config_conflict','Invalid member activation',409);
        await this.updateMember(next.id,old.revision,next.value.retiredAt === null ? next.value.name.toLowerCase() : null,next.value);
      }
      for (const next of input.create) await this.createMember(next);
      this.memberActivations.set(workspaceId, structuredClone(input.activation));
    } catch (error) {
      this.members.clear(); for (const [k,v] of members) this.members.set(k,v);
      this.agentContexts.clear(); for (const [k,v] of contexts) this.agentContexts.set(k,v);
      this.ordinal=ordinal; throw error;
    }
  }

  async createMember(input: NewMember): Promise<StoredMember> {
    this.stored(input.workspaceId);
    const others = [...this.members.values()].filter(item => item.member.workspaceId === input.workspaceId);
    if (input.lead && others.some(item => item.lead)) throw new AppError('lead_exists', 'The workspace already has a lead', 409);
    if (others.some(item => item.nameKey === input.nameKey)) throw new AppError('member_exists', 'Another member of this team has that name', 409);
    const member = { id: input.id, workspaceId: input.workspaceId, revision: 0, value: structuredClone(input.value) };
    this.members.set(input.id, { member, lead: input.lead, nameKey: input.nameKey, ordinal: ++this.ordinal });
    this.agentContexts.set(member.id, []);
    return structuredClone(member);
  }

  async updateMember(memberId: string, revision: number, nameKey: string | null, value: MemberRecord, requireIdle = false): Promise<StoredMember> {
    const item = this.members.get(memberId);
    if (requireIdle && [...this.chatRuns.values()].some(({run}) => run.agentId === memberId && run.status === 'running')) throw new AppError('member_busy', 'Wait for the member before submitting configuration', 409);
    if (!item) throw new AppError('not_found', 'Member not found', 404);
    if (item.member.revision !== revision) throw new AppError('config_conflict', 'Member revision changed', 409);
    if (nameKey !== null && [...this.members.values()].some(other => other !== item && other.member.workspaceId === item.member.workspaceId && other.nameKey === nameKey)) throw new AppError('member_exists', 'Another member of this team has that name', 409);
    item.nameKey = nameKey;
    item.member = { ...item.member, revision: revision + 1, value: structuredClone(value) };
    return structuredClone(item.member);
  }

  private stored(workspaceId: string): Stored {
    const stored = this.workspaces.get(workspaceId);
    if (!stored) throw new AppError('not_found', `Workspace ${workspaceId} not found`, 404);
    return stored;
  }
}

/** A temporary folder removed after the callback. */
export async function withFolder<T>(run: (folder: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), 'context-test-'));
  try { return await run(folder); }
  finally { await rm(folder, { recursive: true, force: true }); }
}
