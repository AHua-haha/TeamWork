import { scanContextFiles, type DiskFile } from './context-scan.js';
import { randomUUID } from 'node:crypto';
import { watch, type Dirent, type FSWatcher } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { Changes } from '../../changes.js';
import type { WorkspaceBootstrap } from '../../workspace-bootstrap.js';
import type { NewMember } from '../../team/data/members.js';
import type { WorkspaceModels, StoredWorkspaceModels } from './models.js';
import { decodeText, encodeText, maxFileBytes, missing, sha256 } from '../../text.js';
import { AppError, identity } from '../../agent/data/model.js';

import { contextPath, validSegment, maxContextSegments as maxSegments } from './paths.js';
import { implementationContextFile } from '../workspace-layout.js';
export { contextPath, validSegment } from './paths.js';
export interface LeadAuthor { type: 'lead'; memberId: string; runId: string }
export type Author = { type: 'user' } | { type: 'external' } | LeadAuthor;
export type FileAction = 'create' | 'update' | 'move' | 'delete';
export interface ChangeFile { action: FileAction; path: string; fromPath: string | null; revision: string | null }
export interface ChangeRecord { seq: number; time: number; author: Author; reason: string | null; files: ChangeFile[] }

export interface WorkspaceRecord { workspaceId: string; name: string; directory: string; createdAt: number }

/** One stored file version. A delete has no revision, hash, or size. */
export interface StoredVersion {
  fileId: string;
  seq: number;
  revision: string | null;
  action: FileAction;
  path: string;
  fromPath: string | null;
  hash: string | null;
  size: number | null;
  time: number;
  author: Author;
  reason: string | null;
}

/** A current file. `fileId` follows the file across moves made through the API. */
export interface IndexedFile {
  path: string;
  fileId: string;
  revision: string;
  hash: string;
  size: number;
  mtimeMs: number;
  updatedAt: number;
  author: Author;
  reason: string | null;
}

/** One atomic storage write. File rows under `removeKeys` are deleted before `files` are inserted. */
export interface ContextCommit {
  seq: number;
  blobs: { hash: string; content: string; size: number }[];
  versions: StoredVersion[];
  removeKeys: string[];
  files: IndexedFile[];
  record: ChangeRecord;
}

export interface ContextStore {
  initialMemberFiles?(workspaceId:string):Promise<Record<string,string>>;
  getGitBaseline(workspaceId: string): Promise<import('../workspace-git.js').GitBaseline | null>;
  initializeGitBaseline(workspaceId: string, baseline: import('../workspace-git.js').GitBaseline): Promise<import('../workspace-git.js').GitBaseline>;
  listWorkspaces(): Promise<WorkspaceRecord[]>;
  getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null>;
  /** Stores the workspace and its team's lead together, or neither. Fails with 409 `workspace_exists` for a duplicate ID or directory key. */
  createWorkspace(workspace: WorkspaceRecord, directoryKey: string, lead: NewMember, models?: WorkspaceModels, bootstrap?: WorkspaceBootstrap): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  getWorkspaceModels(workspaceId: string): Promise<StoredWorkspaceModels | null>;
  saveWorkspaceModels(workspaceId: string, revision: number | null, value: WorkspaceModels, initializeLead: boolean): Promise<StoredWorkspaceModels>;
  loadContext(workspaceId: string): Promise<{ seq: number; files: IndexedFile[] }>;
  /** Applies the commit only while the stored sequence still equals `expectedSeq`. */
  commitContext(workspaceId: string, expectedSeq: number, commit: ContextCommit): Promise<void>;
  blob(workspaceId: string, hash: string): Promise<string | null>;
  version(workspaceId: string, revision: string): Promise<StoredVersion | null>;
  /** Versions of one file with `seq < before`, newest first. */
  history(workspaceId: string, fileId: string, before: number | null, limit: number): Promise<StoredVersion[]>;
  /** The file that most recently had a version at this path key. */
  lastFileId(workspaceId: string, pathKey: string): Promise<string | null>;
  records(workspaceId: string, after: number, limit: number): Promise<ChangeRecord[]>;
}

export type ProblemCode = 'invalid_path' | 'duplicate_path' | 'not_text' | 'too_large' | 'not_file';
export interface Problem { path: string; code: ProblemCode; message: string }
export interface ContextOverview { workspaceId: string; seq: number; files: number; bytes: number; problems: Problem[] }
export type ContextTreeEntry = { path: string; type: 'file'; size: number; revision: string; updatedAt: number; author: Author } | { path: string; type: 'folder' };
export interface ContextFile { path: string; revision: string; current: boolean; content: string; size: number; updatedAt: number; author: Author; reason: string | null }
export interface ContextSave { path: string; revision: string; seq: number | null; created: boolean }
export interface DesignSave extends ContextSave { before: string | null; after: string; reason: string | null }
export interface ContextVersion { revision: string | null; seq: number; time: number; action: FileAction; path: string; fromPath: string | null; size: number | null; author: Author; reason: string | null }
export type ContextEvent = { version: 1; workspaceId: string } & ({ type: 'record'; record: ChangeRecord } | { type: 'sync'; seq: number });

export const maxTreeEntries = 2000;
export const maxFindResults = 200;
export const maxSearchMatches = 100;
export const maxReasonLength = 1000;
const userAuthor: Author = { type: 'user' };

const keyOf = (path: string) => path.toLowerCase();
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byPath = (a: { path: string }, b: { path: string }) => compare(keyOf(a.path), keyOf(b.path)) || compare(a.path, b.path);
const notFound = (path: string) => new AppError('not_found', `${path} not found`, 404);
const stale = (path: string) => new AppError('stale_revision', `${path} changed since it was read`, 409);

function writable(path: string): void {
  if (implementationContextFile(path)) throw new AppError('read_only', 'Implementation context is agent-maintained and read-only through this API', 403);
}

function checkReason(reason: string | null): void {
  if (reason !== null && reason.length > maxReasonLength) throw new AppError('invalid_input', `reason has at most ${maxReasonLength} characters`);
}

function checkQuery(q: string): void {
  if (q.length < 1 || q.length > 200) throw new AppError('invalid_input', 'q has 1–200 characters');
}

/** The versions, blobs, and file rows of one change record. */
class Batch {
  readonly versions: StoredVersion[] = [];
  readonly blobs: ContextCommit['blobs'] = [];
  readonly removeKeys = new Set<string>();
  readonly files: IndexedFile[] = [];
  private readonly entries: ChangeFile[] = [];

  constructor(readonly seq: number, private readonly author: Author, private readonly reason: string | null, private readonly time = Date.now()) {}

  write(fileId: string, action: 'create' | 'update' | 'move', path: string, fromPath: string | null, hash: string, size: number, mtimeMs: number, content?: string): IndexedFile {
    const revision = randomUUID();
    this.versions.push({ fileId, seq: this.seq, revision, action, path, fromPath, hash, size, time: this.time, author: this.author, reason: this.reason });
    if (content !== undefined) this.blobs.push({ hash, content, size });
    const file: IndexedFile = { path, fileId, revision, hash, size, mtimeMs, updatedAt: this.time, author: this.author, reason: this.reason };
    this.files.push(file);
    this.removeKeys.add(keyOf(path));
    if (fromPath) this.removeKeys.add(keyOf(fromPath));
    this.entries.push({ action, path, fromPath, revision });
    return file;
  }

  remove(file: IndexedFile): void {
    this.versions.push({ fileId: file.fileId, seq: this.seq, revision: null, action: 'delete', path: file.path, fromPath: null, hash: null, size: null, time: this.time, author: this.author, reason: this.reason });
    this.removeKeys.add(keyOf(file.path));
    this.entries.push({ action: 'delete', path: file.path, fromPath: null, revision: null });
  }

  get empty(): boolean {
    return this.entries.length === 0;
  }

  commit(): ContextCommit {
    const record: ChangeRecord = { seq: this.seq, time: this.time, author: this.author, reason: this.reason, files: [...this.entries].sort(byPath) };
    return { seq: this.seq, blobs: this.blobs, versions: this.versions, removeKeys: [...this.removeKeys], files: this.files, record };
  }
}

/** Disk steps of one operation, with the steps that undo them if storing the record fails. */
class DiskChange {
  private readonly undos: (() => Promise<unknown>)[] = [];
  private readonly trash: string[] = [];
  private readonly emptied = new Set<string>();
  private readonly created = new Set<string>();

  constructor(private readonly roots: string[]) {}

  async write(target: string, bytes: Buffer, replace: boolean): Promise<void> {
    const folder = dirname(target);
    this.created.add(folder);
    await mkdir(folder, { recursive: true });
    const temp = join(folder, `.tmp-${randomUUID()}`);
    this.undos.push(() => rm(temp, { force: true }));
    await writeFile(temp, bytes, { flag: 'wx' });
    if (replace) await this.remove(target);
    await rename(temp, target);
    this.undos.push(() => rm(target, { force: true }));
  }

  async remove(path: string): Promise<void> {
    const trash = join(dirname(path), `.trash-${randomUUID()}`);
    await rename(path, trash);
    this.undos.push(() => rename(trash, path));
    this.trash.push(trash);
    this.emptied.add(dirname(path));
  }

  async move(from: string, to: string): Promise<void> {
    this.created.add(dirname(to));
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    this.undos.push(() => rename(to, from));
    this.emptied.add(dirname(from));
  }

  /** After the record is stored. Never throws: the files on disk are already correct. */
  async finish(): Promise<void> {
    for (const path of this.trash) await rm(path, { force: true }).catch(() => undefined);
    await this.prune(this.emptied);
  }

  async undo(): Promise<void> {
    for (const step of this.undos.reverse()) await step().catch(() => undefined);
    await this.prune(this.created);
  }

  /** Folders exist only while they hold files. */
  private async prune(folders: Set<string>): Promise<void> {
    for (const folder of folders) {
      for (let current = folder; this.roots.some(root => current.startsWith(root + sep)); current = dirname(current)) {
        try { await rmdir(current); } catch { break; }
      }
    }
  }
}


/**
 * One workspace's context base. Current files are the files under `.rsi/context/` on disk, and the store
 * holds every version and change record. Operations run one at a time; each first records the
 * changes made outside the application.
 */
export class ContextBase {
  readonly workspaceId: string;
  private readonly root: string;
  private readonly contextDir: string;
  private readonly roots: string[];
  private readonly files = new Map<string, IndexedFile>();
  private readonly notify = new Changes();
  private problems: Problem[] = [];
  private notText = new Map<string, { size: number; mtimeMs: number }>();
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private watcher?: FSWatcher;
  private watchedIno?: number;
  private timer?: ReturnType<typeof setTimeout>;

  private constructor(private readonly store: ContextStore, workspace: WorkspaceRecord) {
    this.workspaceId = workspace.workspaceId;
    this.root = workspace.directory;
    this.contextDir = join(workspace.directory, '.rsi/context');
    this.roots = [this.contextDir];
  }

  /** Loads the index and records the changes made while the backend was not watching. */
  static async open(store: ContextStore, workspace: WorkspaceRecord): Promise<ContextBase> {
    const base = new ContextBase(store, workspace);
    const loaded = await store.loadContext(workspace.workspaceId);
    base.seq = loaded.seq;
    for (const file of loaded.files) base.files.set(keyOf(file.path), file);
    try { await base.exclusive(() => base.reconcile()); }
    catch (error) {
      await base.close();
      throw error;
    }
    return base;
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
    this.notify.publish();
    await this.queue;
  }

  overview(): Promise<ContextOverview> {
    return this.current(() => {
      const files = [...this.files.values()];
      return { workspaceId: this.workspaceId, seq: this.seq, files: files.length, bytes: files.reduce((sum,file)=>sum+file.size,0), problems: this.problems };
    });
  }

  async tree(path: string, depth: number): Promise<{ seq: number; path: string; entries: ContextTreeEntry[]; truncated: boolean }> {
    if (path) contextPath(path);
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > maxSegments) throw new AppError('invalid_input', `depth is 1–${maxSegments}`);
    return this.current(() => {
      const folderKey = keyOf(path);
      const prefix = folderKey ? `${folderKey}/` : '';
      const files = [...this.files.values()].filter(file => keyOf(file.path).startsWith(prefix));
      if (folderKey && !files.length) {
        if (this.files.has(folderKey)) throw new AppError('invalid_path', `${path} is a file`);
        throw notFound(path);
      }
      const base = folderKey ? files[0]!.path.slice(0, folderKey.length) : folderKey;
      const entries = new Map<string, ContextTreeEntry>();
      for (const file of files) {
        const rest = file.path.slice(prefix.length).split('/');
        for (let index = 0; index < Math.min(rest.length, depth); index++) {
          const entryPath = (base ? `${base}/` : '') + rest.slice(0, index + 1).join('/');
          if (index === rest.length - 1) entries.set(keyOf(entryPath), { path: entryPath, type: 'file', size: file.size, revision: file.revision, updatedAt: file.updatedAt, author: file.author });
          else if (!entries.has(keyOf(entryPath))) entries.set(keyOf(entryPath), { path: entryPath, type: 'folder' });
        }
      }
      const sorted = [...entries.values()].sort(byPath);
      return { seq: this.seq, path: base, entries: sorted.slice(0, maxTreeEntries), truncated: sorted.length > maxTreeEntries };
    });
  }

  async read(target: { path: string } | { revision: string }): Promise<ContextFile> {
    if ('revision' in target) {
      this.assertOpen();
      const version = await this.store.version(this.workspaceId, target.revision);
      if (!version?.revision || version.hash === null) throw new AppError('not_found', 'Revision not found', 404);
      const content = await this.blob(version.hash);
      const current = this.files.get(keyOf(version.path))?.revision === version.revision;
      return { path: version.path, revision: version.revision, current, content, size: version.size ?? Buffer.byteLength(content), updatedAt: version.time, author: version.author, reason: version.reason };
    }
    contextPath(target.path);
    return this.current(async () => {
      const file = this.files.get(keyOf(target.path));
      if (!file) throw notFound(target.path);
      return { path: file.path, revision: file.revision, current: true, content: await this.blob(file.hash), size: file.size, updatedAt: file.updatedAt, author: file.author, reason: file.reason };
    });
  }

  async save(path: string, content: string, baseRevision: string | null, reason: string | null): Promise<ContextSave> {
    const { path: savedPath, revision, seq, created } = await this.saveFile(path, content, baseRevision, reason, userAuthor);
    return { path: savedPath, revision, seq, created };
  }

  /** The trusted lead service saves discussed design changes and receives the exact before/after result. */
  async saveDesign(path: string, content: string, baseRevision: string | null, reason: string, author: LeadAuthor): Promise<DesignSave> {
    identity(author.memberId, 'memberId');
    identity(author.runId, 'runId');
    if (author.type !== 'lead' || !reason.trim()) throw new AppError('invalid_input', 'A lead design change requires its author and a reason');
    return this.saveFile(path, content, baseRevision, reason, author);
  }

  private async saveFile(path: string, content: string, baseRevision: string | null, reason: string | null, author: Author): Promise<DesignSave> {
    contextPath(path);
    writable(path);
    checkReason(reason);
    const bytes = encodeText(content);
    const hash = sha256(bytes);
    return this.current(async () => {
      const existing = this.files.get(keyOf(path));
      if (existing) {
        if (baseRevision === null) throw new AppError('file_exists', `${existing.path} already exists`, 409);
        if (baseRevision !== existing.revision) throw stale(existing.path);
      } else if (baseRevision !== null) throw new AppError('stale_revision', `${path} no longer exists`, 409);
      const before = existing ? await this.blob(existing.hash) : null;
      if (existing?.hash === hash) return { path: existing.path, revision: existing.revision, seq: null, created: false, before, after: content, reason };
      const target = existing ? existing.path : await this.resolveNew(path);
      const disk = new DiskChange(this.roots);
      try {
        await disk.write(this.disk(target), bytes, !!existing);
        const { mtimeMs } = await stat(this.disk(target));
        const batch = new Batch(this.seq + 1, author, reason);
        const file = batch.write(existing?.fileId ?? randomUUID(), existing ? 'update' : 'create', target, null, hash, bytes.length, mtimeMs, content);
        await this.commit(batch);
        await disk.finish();
        return { path: target, revision: file.revision, seq: batch.seq, created: !existing, before, after: content, reason };
      } catch (error) {
        await disk.undo();
        throw error;
      }
    });
  }

  async move(from: string, to: string, baseRevision: string | undefined, reason: string | null): Promise<{ seq: number; moved: { from: string; to: string; revision: string }[] }> {
    contextPath(from);
    contextPath(to);
    writable(from);
    writable(to);
    checkReason(reason);
    const fromKey = keyOf(from);
    const toKey = keyOf(to);
    if (toKey.startsWith(`${fromKey}/`)) throw new AppError('invalid_input', 'A folder cannot move into itself');
    return this.current(async () => {
      const file = this.files.get(fromKey);
      const members = file ? [file] : this.under(fromKey);
      if (!members.length) throw notFound(from);
      for (const member of members) { writable(member.path); writable(to + member.path.slice(from.length)); }
      this.checkBase(file, baseRevision);
      const source = file ? file.path : members[0]!.path.slice(0, fromKey.length);
      let target: string;
      if (fromKey === toKey) {
        target = source.includes('/') ? `${source.slice(0, source.lastIndexOf('/'))}/${to.slice(to.lastIndexOf('/') + 1)}` : to;
        if (target === source) throw new AppError('invalid_input', `${source} already has that name; rename a folder to change its letter case`);
      } else target = await this.resolveNew(to);
      const disk = new DiskChange(this.roots);
      try {
        await disk.move(this.disk(source), this.disk(target));
        const batch = new Batch(this.seq + 1, userAuthor, reason);
        const moved = [];
        for (const member of members) {
          const path = target + member.path.slice(source.length);
          const { mtimeMs } = await stat(this.disk(path));
          const next = batch.write(member.fileId, 'move', path, member.path, member.hash, member.size, mtimeMs);
          moved.push({ from: member.path, to: path, revision: next.revision });
        }
        await this.commit(batch);
        await disk.finish();
        return { seq: batch.seq, moved };
      } catch (error) {
        await disk.undo();
        throw error;
      }
    });
  }

  async delete(path: string, baseRevision: string | undefined, reason: string | null): Promise<{ seq: number; deleted: string[] }> {
    contextPath(path);
    writable(path);
    checkReason(reason);
    return this.current(async () => {
      const file = this.files.get(keyOf(path));
      const members = file ? [file] : this.under(keyOf(path));
      if (!members.length) throw notFound(path);
      for (const member of members) writable(member.path);
      this.checkBase(file, baseRevision);
      const disk = new DiskChange(this.roots);
      try {
        for (const member of members) await disk.remove(this.disk(member.path));
        const batch = new Batch(this.seq + 1, userAuthor, reason);
        for (const member of members) batch.remove(member);
        await this.commit(batch);
        await disk.finish();
        return { seq: batch.seq, deleted: members.map(member => member.path) };
      } catch (error) {
        await disk.undo();
        throw error;
      }
    });
  }

  async history(path: string, before: number | null, limit: number): Promise<{ versions: ContextVersion[]; next: number | null }> {
    contextPath(path);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new AppError('invalid_input', 'limit is 1–200');
    return this.current(async () => {
      const key = keyOf(path);
      const fileId = this.files.get(key)?.fileId ?? await this.store.lastFileId(this.workspaceId, key);
      if (!fileId) throw notFound(path);
      const rows = await this.store.history(this.workspaceId, fileId, before, limit + 1);
      const versions = rows.slice(0, limit).map(({ revision, seq, time, action, path, fromPath, size, author, reason }) => ({ revision, seq, time, action, path, fromPath, size, author, reason }));
      return { versions, next: rows.length > limit ? versions.at(-1)!.seq : null };
    });
  }

  async find(q: string): Promise<{ paths: string[]; truncated: boolean }> {
    checkQuery(q);
    return this.current(() => {
      const needle = q.toLowerCase();
      const paths = [...this.files.values()].filter(file => keyOf(file.path).includes(needle)).sort(byPath).map(file => file.path);
      return { paths: paths.slice(0, maxFindResults), truncated: paths.length > maxFindResults };
    });
  }

  async search(q: string, path: string): Promise<{ matches: { path: string; line: number; text: string }[]; truncated: boolean }> {
    checkQuery(q);
    if (path) contextPath(path);
    return this.current(async () => {
      const scope = keyOf(path);
      const needle = q.toLowerCase();
      const files = [...this.files.values()].filter(file => !scope || keyOf(file.path) === scope || keyOf(file.path).startsWith(`${scope}/`)).sort(byPath);
      const matches: { path: string; line: number; text: string }[] = [];
      for (const file of files) {
        const content = await readFile(this.disk(file.path)).then(decodeText, () => null);
        if (content === null) continue;
        const lines = content.split(/\r\n|\r|\n/);
        for (const [index, line] of lines.entries()) {
          if (!line.toLowerCase().includes(needle)) continue;
          if (matches.length === maxSearchMatches) return { matches, truncated: true };
          matches.push({ path: file.path, line: index + 1, text: line.slice(0, 500) });
        }
      }
      return { matches, truncated: false };
    });
  }

  async changes(after: number, limit: number): Promise<{ records: ChangeRecord[]; seq: number; more: boolean }> {
    this.assertOpen();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AppError('invalid_input', 'limit is 1–500');
    const seq = this.seq;
    if (after > seq) throw new AppError('invalid_cursor', 'after is beyond the latest change', 409);
    const records = (await this.store.records(this.workspaceId, after, limit)).filter(record => record.seq <= seq);
    return { records, seq, more: (records.at(-1)?.seq ?? after) < seq };
  }

  /** Every record after `after`, then `sync`, then each later record as it is stored. */
  async *follow(after: number, signal: AbortSignal): AsyncGenerator<ContextEvent> {
    this.assertOpen();
    if (after > this.seq) throw new AppError('invalid_cursor', 'after is beyond the latest change', 409);
    let cursor = after;
    let synced = false;
    while (!signal.aborted) {
      this.assertOpen();
      const version = this.notify.version;
      const target = this.seq;
      while (cursor < target) {
        const records = await this.store.records(this.workspaceId, cursor, Math.min(500, target - cursor));
        if (!records.length) throw new AppError('corrupt_data', 'Change records are missing', 500);
        for (const record of records) {
          if (record.seq !== cursor + 1) throw new AppError('corrupt_data', 'Change records are missing', 500);
          cursor = record.seq;
          yield { version: 1, workspaceId: this.workspaceId, type: 'record', record };
        }
      }
      if (!synced) {
        synced = true;
        yield { version: 1, workspaceId: this.workspaceId, type: 'sync', seq: cursor };
      }
      await this.notify.wait(version, signal);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new AppError('workspace_unavailable', 'Workspace is closed', 503);
  }

  private exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(() => {
      this.assertOpen();
      return operation();
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Runs after the files on disk are recorded. */
  private current<T>(operation: () => Promise<T> | T): Promise<T> {
    return this.exclusive(async () => {
      await this.reconcile();
      return operation();
    });
  }

  private checkBase(file: IndexedFile | undefined, baseRevision: string | undefined): void {
    if (baseRevision === undefined) return;
    if (!file) throw new AppError('invalid_input', 'baseRevision applies only to a file');
    if (baseRevision !== file.revision) throw stale(file.path);
  }

  private under(folderKey: string): IndexedFile[] {
    return [...this.files.values()].filter(file => keyOf(file.path).startsWith(`${folderKey}/`)).sort(byPath);
  }

  private disk(path: string): string {
    return join(this.contextDir, ...path.split('/'));
  }

  private async blob(hash: string): Promise<string> {
    const content = await this.store.blob(this.workspaceId, hash);
    if (content === null) throw new AppError('corrupt_data', 'Stored content is missing', 500);
    return content;
  }

  private async commit(batch: Batch): Promise<void> {
    await this.store.commitContext(this.workspaceId, this.seq, batch.commit());
    for (const key of batch.removeKeys) this.files.delete(key);
    for (const file of batch.files) this.files.set(keyOf(file.path), file);
    this.seq = batch.seq;
    this.notify.publish();
  }

  /** The spelling for a new path: existing folders keep their spelling on disk, and nothing may exist at the target. */
  private async resolveNew(path: string): Promise<string> {
    const rest = path.split('/');
    const resolved: string[] = [];
    let folder = this.contextDir;
    for (const [index, segment] of rest.entries()) {
      let entries: Dirent[] = [];
      try { entries = await readdir(folder, { withFileTypes: true }); }
      catch (error) { if (!missing(error)) throw error; }
      const matches = entries.filter(entry => entry.name.toLowerCase() === segment.toLowerCase());
      const shown = [...resolved, matches[0]?.name ?? segment].join('/');
      if (index === rest.length - 1) {
        if (matches.length) throw new AppError('file_exists', `${shown} already exists`, 409);
        resolved.push(segment);
        break;
      }
      if (!matches.length) {
        resolved.push(...rest.slice(index));
        break;
      }
      const match = matches[0]!;
      if (matches.length > 1 || !match.isDirectory() || !validSegment(match.name)) throw new AppError('file_exists', `${shown} is not a folder that can hold files`, 409);
      resolved.push(match.name);
      folder = join(folder, match.name);
    }
    return resolved.join('/');
  }

  /** Records every difference between the files on disk and the index as one `external` change. */
  private async reconcile(): Promise<void> {
    const unavailable = (detail: string) => new AppError('workspace_unavailable', `Workspace folder ${this.root} ${detail}`, 503);
    try {
      if (!(await stat(this.root)).isDirectory()) throw unavailable('is not a folder');
    } catch (error) {
      throw error instanceof AppError ? error : unavailable('is missing or unreadable');
    }
    let ino: number;
    try {
      for (const root of [join(this.root, '.rsi'), this.contextDir]) {
        try {
          const info = await lstat(root);
          if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('not a real folder');
        } catch (error) { if (!missing(error)) throw error; await mkdir(root); }
      }
      const info = await lstat(this.contextDir);
      ino = info.ino;
    } catch {
      throw unavailable('has no usable .rsi/context folder');
    }
    this.watch(ino);

    const scan = await scanContextFiles(this.contextDir);
    const problems = scan.problems;
    const notText = new Map<string, { size: number; mtimeMs: number }>();
    const served = new Set<string>();
    const changed: { file: DiskFile; content: string; hash: string; size: number }[] = [];
    for (const file of scan.files) {
      const indexed = this.files.get(file.key);
      if (indexed && indexed.path === file.path && indexed.size === file.size && indexed.mtimeMs === file.mtimeMs) {
        served.add(file.key);
        continue;
      }
      const known = this.notText.get(file.path);
      if (known && known.size === file.size && known.mtimeMs === file.mtimeMs) {
        notText.set(file.path, known);
        problems.push({ path: file.path, code: 'not_text', message: 'Not UTF-8 text' });
        continue;
      }
      let bytes: Buffer;
      try { bytes = await readFile(this.disk(file.path)); }
      catch (error) {
        if (missing(error)) continue;
        throw error;
      }
      if (bytes.length > maxFileBytes) {
        problems.push({ path: file.path, code: 'too_large', message: `Larger than ${maxFileBytes} bytes` });
        continue;
      }
      const content = decodeText(bytes);
      if (content === null) {
        notText.set(file.path, { size: file.size, mtimeMs: file.mtimeMs });
        problems.push({ path: file.path, code: 'not_text', message: 'Not UTF-8 text' });
        continue;
      }
      served.add(file.key);
      const hash = sha256(bytes);
      if (indexed && indexed.path === file.path && indexed.hash === hash) {
        indexed.mtimeMs = file.mtimeMs;
        continue;
      }
      changed.push({ file, content, hash, size: bytes.length });
    }
    this.notText = notText;
    this.problems = problems.sort(byPath);

    const batch = new Batch(this.seq + 1, { type: 'external' }, null);
    for (const [key, file] of this.files) if (!served.has(key)) batch.remove(file);
    for (const { file, content, hash, size } of changed) {
      const indexed = this.files.get(file.key);
      if (indexed && indexed.path === file.path) batch.write(indexed.fileId, 'update', file.path, null, hash, size, file.mtimeMs, content);
      else {
        // An outside move, including a change of letter case, is a delete and a create.
        if (indexed) batch.remove(indexed);
        batch.write(randomUUID(), 'create', file.path, null, hash, size, file.mtimeMs, content);
      }
    }
    if (!batch.empty) await this.commit(batch);
  }

  private watch(ino: number): void {
    if (this.closed || (this.watcher && this.watchedIno === ino)) return;
    this.watcher?.close();
    this.watcher = undefined;
    try {
      const watcher = watch(this.contextDir, { recursive: true, persistent: false }, () => this.schedule());
      watcher.on('error', () => {
        watcher.close();
        if (this.watcher === watcher) this.watcher = undefined;
      });
      this.watcher = watcher;
      this.watchedIno = ino;
    } catch {
      // Without a watcher, every operation still records outside changes before it runs.
    }
  }

  private schedule(): void {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.exclusive(() => this.reconcile()).catch(() => undefined); }, 150);
    this.timer.unref();
  }
}
