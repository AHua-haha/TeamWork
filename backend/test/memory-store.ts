import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeRecord, ContextCommit, ContextStore, IndexedFile, StoredVersion, WorkspaceRecord } from '../src/context-base.js';
import type { MemberRecord, NewMember, StoredMember, TeamStore } from '../src/team.js';
import { randomUUID } from 'node:crypto';
import { groupEntry, type ChatStore, type ChatMessage, type ChatPublication, type ChatSnapshot } from '../src/group-chat.js';
import type { ContextEntry, RunState } from '../src/types.js';
import { AppError } from '../src/types.js';

interface Stored { record: WorkspaceRecord; key: string; seq: number; blobs: Map<string, string>; versions: StoredVersion[]; files: Map<string, IndexedFile>; records: ChangeRecord[] }

/** The MySQL store's context semantics in memory. `failNextCommit` makes the next commit fail before it applies. */
export class MemoryStore implements ContextStore, TeamStore, ChatStore {
  readonly workspaces = new Map<string, Stored>();
  readonly members = new Map<string, { member: StoredMember; lead: boolean; nameKey: string | null; ordinal: number }>();
  private ordinal = 0;
  failNextCommit = false;

  readonly chatMessages = new Map<string, ChatMessage[]>();
  readonly chatRuns = new Map<string, { exchangeId: string; run: RunState }>();
  readonly agentContexts = new Map<string, ContextEntry[]>();
  readonly delivery = new Map<string, number>();
  private readonly limits = new Map<string, number>();
  private readonly exchanges = new Map<string, { used: number; limit: number; stopped: boolean }>();
  onPublicationComplete?: (runId: string) => void;
  failNextPublication = false;

  async publishChat(input: ChatPublication) {
    this.stored(input.workspaceId);
    const active = [...this.chatRuns.values()].filter(item => item.run.status === 'running');
    for (const id of input.recipients) if (active.some(item => item.run.agentId === id)) throw new AppError('member_busy', 'Member is working', 409);
    const exchangeId = input.exchangeId ?? randomUUID();
    const exchange = this.exchanges.get(exchangeId) ?? { used: 0, limit: this.limits.get(input.workspaceId) ?? 32, stopped: false };
    if (exchange.stopped) throw new AppError('exchange_stopped', 'Exchange stopped', 409);
    if (exchange.used + input.recipients.length > exchange.limit) throw new AppError('mention_limit', 'Mention limit reached', 409);
    if (this.failNextPublication) { this.failNextPublication = false; throw new Error('injected publication failure'); }
    const messages = this.chatMessages.get(input.workspaceId) ?? [];
    const message: ChatMessage = { ...input, exchangeId, messageId: randomUUID(), position: messages.length + 1, time: Date.now() };
    messages.push(structuredClone(message)); this.chatMessages.set(input.workspaceId, messages);
    exchange.used += input.recipients.length; this.exchanges.set(exchangeId, exchange);
    if (input.author.type === 'member') this.onPublicationComplete?.(input.author.runId);
    for (const member of await this.listMembers(input.workspaceId)) if (member.value.retiredAt === null) await this.syncChatMember(member.id);
    const runs = input.recipients.map(agentId => {
      const run: RunState = { agentId, runId: randomUUID(), status: 'running', phase: 'model', step: 0, startedAt: Date.now(), endedAt: null, endPosition: null, activeMessageId: null, error: null };
      this.chatRuns.set(run.runId, { exchangeId, run }); return run;
    });
    return { message, runs };
  }

  async syncChatMember(memberId: string) {
    if ([...this.chatRuns.values()].some(item => item.run.agentId === memberId && item.run.status === 'running')) return;
    const member = this.members.get(memberId)?.member;
    if (!member) return;
    const pending = (this.chatMessages.get(member.workspaceId) ?? []).filter(item => item.position > (this.delivery.get(memberId) ?? 0));
    const entries = this.agentContexts.get(memberId) ?? [];
    entries.push(...pending.map(groupEntry)); this.agentContexts.set(memberId, entries);
    if (pending.length) this.delivery.set(memberId, pending.at(-1)!.position);
  }

  async chatSnapshot(workspaceId: string, after = 0, limit = 100): Promise<ChatSnapshot> {
    this.stored(workspaceId);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AppError('invalid_input', 'Invalid cursor or limit');
    const all = this.chatMessages.get(workspaceId) ?? [];
    if (after > all.length) throw new AppError('invalid_cursor', 'Cursor ahead', 409);
    const messages = all.slice(after, after + limit);
    return { workspaceId, position: all.length, mentionLimit: this.limits.get(workspaceId) ?? 32, messages: structuredClone(messages), more: after + messages.length < all.length, runs: [...this.chatRuns.values()].filter(item => this.members.get(item.run.agentId)?.member.workspaceId === workspaceId).map(item => structuredClone(item)) };
  }

  async configureChat(workspaceId: string, value: number) { this.stored(workspaceId); this.limits.set(workspaceId, value); }
  async stopChat(workspaceId: string) {
    this.stored(workspaceId);
    const runs = [...this.chatRuns.values()].filter(item => item.run.status === 'running' && this.members.get(item.run.agentId)?.member.workspaceId === workspaceId);
    for (const item of runs) this.exchanges.get(item.exchangeId)!.stopped = true;
    return runs.map(item => item.run);
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    return [...this.workspaces.values()].map(stored => stored.record).sort((a, b) => a.name.localeCompare(b.name) || a.workspaceId.localeCompare(b.workspaceId));
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    return this.workspaces.get(workspaceId)?.record ?? null;
  }

  async createWorkspace(record: WorkspaceRecord, key: string, lead: NewMember): Promise<void> {
    if (this.workspaces.has(record.workspaceId) || [...this.workspaces.values()].some(stored => stored.key === key)) throw new AppError('workspace_exists', 'A workspace with this ID or folder already exists', 409);
    this.workspaces.set(record.workspaceId, { record, key, seq: 0, blobs: new Map(), versions: [], files: new Map(), records: [] });
    try { await this.createMember(lead); }
    catch (error) {
      // Like the real store's transaction: a workspace is never stored without its lead.
      this.workspaces.delete(record.workspaceId);
      throw error;
    }
  }

  async loadContext(workspaceId: string): Promise<{ seq: number; files: IndexedFile[] }> {
    const stored = this.stored(workspaceId);
    return { seq: stored.seq, files: [...stored.files.values()].map(file => ({ ...file })) };
  }

  async commitContext(workspaceId: string, expectedSeq: number, commit: ContextCommit): Promise<void> {
    const stored = this.stored(workspaceId);
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error('injected commit failure');
    }
    if (stored.seq !== expectedSeq) throw new AppError('backend_error', 'The context base changed outside this process', 503);
    for (const blob of commit.blobs) if (!stored.blobs.has(blob.hash)) stored.blobs.set(blob.hash, blob.content);
    stored.versions.push(...structuredClone(commit.versions));
    for (const key of commit.removeKeys) stored.files.delete(key);
    for (const file of commit.files) stored.files.set(file.path.toLowerCase(), { ...file });
    stored.records.push(structuredClone(commit.record));
    stored.seq = commit.seq;
  }

  async listMembers(workspaceId: string): Promise<StoredMember[]> {
    return [...this.members.values()].filter(item => item.member.workspaceId === workspaceId).sort((a, b) => a.ordinal - b.ordinal).map(item => structuredClone(item.member));
  }

  async getMember(memberId: string): Promise<StoredMember | null> {
    const item = this.members.get(memberId);
    return item ? structuredClone(item.member) : null;
  }

  async createMember(input: NewMember): Promise<StoredMember> {
    this.stored(input.workspaceId);
    const others = [...this.members.values()].filter(item => item.member.workspaceId === input.workspaceId);
    if (input.lead && others.some(item => item.lead)) throw new AppError('lead_exists', 'The workspace already has a lead', 409);
    if (others.some(item => item.nameKey === input.nameKey)) throw new AppError('member_exists', 'Another member of this team has that name', 409);
    const member = { id: input.id, workspaceId: input.workspaceId, revision: 0, value: structuredClone(input.value) };
    this.members.set(input.id, { member, lead: input.lead, nameKey: input.nameKey, ordinal: ++this.ordinal });
    await this.syncChatMember(member.id);
    return structuredClone(member);
  }

  async updateMember(memberId: string, revision: number, nameKey: string | null, value: MemberRecord): Promise<StoredMember> {
    const item = this.members.get(memberId);
    if (!item) throw new AppError('not_found', 'Member not found', 404);
    if (item.member.revision !== revision) throw new AppError('config_conflict', 'Member revision changed', 409);
    if (nameKey !== null && [...this.members.values()].some(other => other !== item && other.member.workspaceId === item.member.workspaceId && other.nameKey === nameKey)) throw new AppError('member_exists', 'Another member of this team has that name', 409);
    item.nameKey = nameKey;
    item.member = { ...item.member, revision: revision + 1, value: structuredClone(value) };
    return structuredClone(item.member);
  }

  async blob(workspaceId: string, hash: string): Promise<string | null> {
    return this.stored(workspaceId).blobs.get(hash) ?? null;
  }

  async version(workspaceId: string, revision: string): Promise<StoredVersion | null> {
    return this.stored(workspaceId).versions.find(version => version.revision === revision) ?? null;
  }

  async history(workspaceId: string, fileId: string, before: number | null, limit: number): Promise<StoredVersion[]> {
    return this.stored(workspaceId).versions.filter(version => version.fileId === fileId && (before === null || version.seq < before)).sort((a, b) => b.seq - a.seq).slice(0, limit);
  }

  async lastFileId(workspaceId: string, pathKey: string): Promise<string | null> {
    const versions = this.stored(workspaceId).versions.filter(version => version.path.toLowerCase() === pathKey);
    versions.sort((a, b) => b.seq - a.seq || Number(a.action === 'delete') - Number(b.action === 'delete'));
    return versions[0]?.fileId ?? null;
  }

  async records(workspaceId: string, after: number, limit: number): Promise<ChangeRecord[]> {
    return this.stored(workspaceId).records.filter(record => record.seq > after).slice(0, limit);
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
