import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeRecord, ContextCommit, ContextStore, IndexedFile, StoredVersion, WorkspaceRecord } from '../src/context-base.js';
import { AppError } from '../src/types.js';

interface Stored { record: WorkspaceRecord; key: string; seq: number; blobs: Map<string, string>; versions: StoredVersion[]; files: Map<string, IndexedFile>; records: ChangeRecord[] }

/** The MySQL store's context semantics in memory. `failNextCommit` makes the next commit fail before it applies. */
export class MemoryStore implements ContextStore {
  readonly workspaces = new Map<string, Stored>();
  failNextCommit = false;

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    return [...this.workspaces.values()].map(stored => stored.record).sort((a, b) => a.name.localeCompare(b.name) || a.workspaceId.localeCompare(b.workspaceId));
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    return this.workspaces.get(workspaceId)?.record ?? null;
  }

  async createWorkspace(record: WorkspaceRecord, key: string): Promise<void> {
    if (this.workspaces.has(record.workspaceId) || [...this.workspaces.values()].some(stored => stored.key === key)) throw new AppError('workspace_exists', 'A workspace with this ID or folder already exists', 409);
    this.workspaces.set(record.workspaceId, { record, key, seq: 0, blobs: new Map(), versions: [], files: new Map(), records: [] });
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
