import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeRecord, ContextCommit, ContextStore, IndexedFile, StoredVersion, WorkspaceRecord } from '../src/context-base.js';
import type { MemberRecord, NewMember, StoredMember, TeamStore } from '../src/team.js';
import { AppError } from '../src/types.js';

interface Stored { record: WorkspaceRecord; key: string; seq: number; blobs: Map<string, string>; versions: StoredVersion[]; files: Map<string, IndexedFile>; records: ChangeRecord[] }

/** The MySQL store's context semantics in memory. `failNextCommit` makes the next commit fail before it applies. */
export class MemoryStore implements ContextStore, TeamStore {
  readonly workspaces = new Map<string, Stored>();
  readonly members = new Map<string, { member: StoredMember; lead: boolean; nameKey: string | null; ordinal: number }>();
  private ordinal = 0;
  failNextCommit = false;

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
