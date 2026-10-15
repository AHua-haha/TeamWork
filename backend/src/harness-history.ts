import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { AppError, identity } from './types.js';
import { missing, sha256 } from './text.js';

export interface HarnessPart {
  id: string;
  paths: string[];
  exclude: string[];
  commit: 'agent' | 'user';
  prompt: string;
}
export interface HarnessDefinition { id: string; parts: HarnessPart[]; prompt: string; tools: string[] }
export interface HistoryActor { type: 'agent' | 'user' | 'harness'; memberId: string; runId?: string }
export interface ScopeRevision {
  revision: string;
  tree: string;
  kind: 'baseline' | 'checkpoint' | 'restore' | 'commit';
  actor: HistoryActor;
  message: string;
  time: number;
}
export interface PartState { part: HarnessPart; checkpoint: string; committed: string; base: string }
interface Entry { path: string; mode: string; object: string }
export const coversPath = (scope: string, path: string): boolean => scope === '.' || path.toLowerCase() === scope.toLowerCase() || path.toLowerCase().startsWith(scope.toLowerCase() + '/');
const objectId = (value: string) => /^[a-f0-9]{40,64}$/.test(value);

function safePath(path: string): void {
  if (!path || isAbsolute(path) || path.includes('\\') || /[\u0000-\u001f\u007f:]/.test(path) || path.split('/').some(p => !p || p === '..' || p === '.' || p.toLowerCase() === '.git')) throw new AppError('invalid_path', 'Scope paths must be relative paths without links or Git metadata');
}
export function validateParts(parts: readonly HarnessPart[]): void {
  const ids = new Set<string>();
  for (const part of parts) {
    identity(part.id, 'part');
    if (ids.has(part.id) || !part.paths.length || !['agent', 'user'].includes(part.commit) || typeof part.prompt !== 'string') throw new AppError('invalid_config', 'Parts have unique IDs, nonempty paths and an agent/user commit policy');
    ids.add(part.id);
    for (const p of [...part.paths, ...part.exclude]) if (p !== '.') safePath(p);
    for (const other of parts) {
      if (other === part) continue;
      for (const a of part.paths) for (const b of other.paths) {
        const intersection = coversPath(a, b) ? b : coversPath(b, a) ? a : null;
        if (intersection !== null && !part.exclude.some(p => coversPath(p, intersection)) && !other.exclude.some(p => coversPath(p, intersection))) throw new AppError('invalid_config', `Parts ${part.id} and ${other.id} overlap`);
      }
    }
  }
}
export const partOwns = (part: HarnessPart, path: string) => part.paths.some(p => coversPath(p, path)) && !part.exclude.some(p => coversPath(p, path)) && !path.split('/').some(p => p.toLowerCase() === '.git');

/** One queue per key; failure never poisons the next operation. */
export class HarnessQueue {
  private readonly tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
    this.tails.set(key, result);
    void result.finally(() => { if (this.tails.get(key) === result) this.tails.delete(key); }).catch(() => undefined);
    return result;
  }
}

/** All Git processes explicitly select the private repository and never discover the user's .git. */
export class HarnessHistory {
  readonly repository: string;
  private readonly queue = new HarnessQueue();
  constructor(readonly storage: string, readonly source: string) { this.repository = join(storage, 'repository.git'); }

  private async git(args: string[], input?: Buffer | string, index?: string): Promise<Buffer> {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Harness', GIT_AUTHOR_EMAIL: 'harness@localhost', GIT_COMMITTER_NAME: 'Harness', GIT_COMMITTER_EMAIL: 'harness@localhost', ...(index ? { GIT_INDEX_FILE: index } : {}) });
    return new Promise((resolveResult, reject) => {
      const child = execFile('git', ['--git-dir', this.repository, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { env, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, timeout: 60_000 }, (error, stdout, stderr) => {
        if (error) reject(new AppError('harness_git_error', `Harness Git failed: ${stderr.toString().trim() || error.message}`, 503));
        else resolveResult(stdout);
      });
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(input);
    });
  }
  private async text(args: string[], input?: Buffer | string, index?: string) { return (await this.git(args, input, index)).toString('utf8').trim(); }
  private async ref(name: string): Promise<string | null> {
    // for-each-ref returns an empty result for an absent reference, without hiding Git failures.
    const value = await this.text(['for-each-ref', '--format=%(objectname)', name]);
    if (!value) return null;
    if (!objectId(value)) throw new AppError('corrupt_data', 'Invalid scoped reference', 500);
    return value;
  }
  private key(part: HarnessPart) { return sha256(JSON.stringify({ paths: [...part.paths].sort(), exclude: [...part.exclude].sort() })); }
  private refs(memberId: string, part: HarnessPart) {
    identity(memberId, 'memberId');
    const key = this.key(part);
    const area = `refs/harness/areas/${memberId}/${part.id}/${key}`;
    return { checkpoint: `${area}/checkpoint`, base: `${area}/base`, committed: `refs/harness/scopes/${key}/committed` };
  }
  private async update(ref: string, next: string, previous: string | null) {
    await this.text(['update-ref', ref, next, previous ?? '0'.repeat(40)]);
  }

  async open(): Promise<void> {
    await this.queue.run('repository', async () => {
      await mkdir(this.storage, { recursive: true });
      try { await lstat(join(this.repository, 'HEAD')); }
      catch (error) {
        if (!missing(error)) throw error;
        await this.text(['init', '--bare', this.repository]);
      }
      if (await this.ref('refs/harness/workspace')) return;
      const actor: HistoryActor = { type: 'harness', memberId: 'workspace' };
      const seed: HarnessPart = { id: 'seed', paths: ['.'], exclude: [], commit: 'user', prompt: '' };
      const tree = await this.snapshot(this.source, seed, true);
      const initial = await this.record(tree, null, 'baseline', actor, 'Initial workspace files');
      await this.update('refs/harness/workspace', initial, null);
    });
  }

  async worktree(memberId: string): Promise<string> {
    identity(memberId, 'memberId');
    await this.open();
    return this.queue.run(`worktree:${memberId}`, async () => {
      const directory = join(this.storage, 'worktrees', memberId);
      try { await lstat(join(directory, '.git')); return directory; }
      catch (error) { if (!missing(error)) throw error; }
      await mkdir(dirname(directory), { recursive: true });
      await this.text(['worktree', 'add', '--detach', directory, 'refs/harness/workspace']);
      return directory;
    });
  }

  /** Only scope-owned regular files are included; symlinks in managed state are refused. */
  private async files(root: string, part: HarnessPart, seed = false): Promise<{ path: string; mode: string; bytes: Buffer }[]> {
    const result = new Map<string, { path: string; mode: string; bytes: Buffer }>();
    let total = 0;
    let allowed: Set<string> | undefined;
    if (seed) {
      const index = join(this.storage, `index-${randomUUID()}`);
      try {
        const list = await this.git(['--work-tree', root, 'ls-files', '--others', '--exclude-standard', '-z'], undefined, index);
        allowed = new Set<string>();
        for (const path of list.toString('utf8').split('\0').filter(Boolean)) {
          const segments = path.split('/');
          for (let n = 1; n <= segments.length; n++) allowed.add(segments.slice(0, n).join('/'));
        }
      } finally { await rm(index, { force: true }); }
    }
    const visit = async (path: string): Promise<void> => {
      if (path && path !== '.') safePath(path);
      if (part.exclude.some(p => coversPath(p, path)) || path.split('/').some(p => p.toLowerCase() === '.git')) return;
      const absolute = join(root, path === '.' ? '' : path);
      let info;
      try { info = await lstat(absolute); }
      catch (error) { if (missing(error)) return; throw error; }
      if (info.isSymbolicLink()) {
        if (seed) return;
        throw new AppError('invalid_path', `${path} is a link`);
      }
      if (info.isDirectory()) {
        for (const name of (await readdir(absolute)).sort()) {
          if (name.toLowerCase() === '.git') continue;
          const child = path === '.' ? name : `${path}/${name}`;
          if (seed && allowed && !child.startsWith('.context/') && child !== '.context' && !allowed.has(child)) continue;
          await visit(child);
        }
      } else if (info.isFile() && partOwns(part, path)) {
        if (info.size > 64 * 1024 * 1024 || (total += info.size) > 256 * 1024 * 1024 || result.size >= 20_000) throw new AppError('input_too_large', 'Harness snapshot exceeds 20,000 files, 64 MiB per file or 256 MiB total', 413);
        result.set(path, { path, mode: info.mode & 0o111 ? '100755' : '100644', bytes: await readFile(absolute) });
      }
    };
    for (const path of part.paths) {
      // Check every ancestor, including a missing final target, before recursing.
      if (path !== '.') for (let n = 1; n < path.split('/').length; n++) {
        const ancestor = path.split('/').slice(0, n).join('/');
        try { if ((await lstat(join(root, ancestor))).isSymbolicLink()) throw new AppError('invalid_path', `${ancestor} is a link`); }
        catch (error) { if (!missing(error)) throw error; }
      }
      await visit(path);
    }
    return [...result.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
  private async snapshot(root: string, part: HarnessPart, seed = false): Promise<string> {
    const files = await this.files(root, part, seed);
    const entries: Entry[] = [];
    for (const file of files) entries.push({ path: file.path, mode: file.mode, object: await this.text(['hash-object', '-w', '--stdin'], file.bytes) });
    return this.tree(entries);
  }
  private async tree(files: Entry[]): Promise<string> {
    const index = join(this.storage, `index-${randomUUID()}`);
    try {
      await this.text(['read-tree', '--empty'], undefined, index);
      const entries = files.map(file => `${file.mode} ${file.object}\t${file.path}\0`);
      if (entries.length) await this.git(['update-index', '-z', '--index-info'], entries.join(''), index);
      return await this.text(['write-tree'], undefined, index);
    } finally { await rm(index, { force: true }); }
  }
  private async record(tree: string, parent: string | null, kind: ScopeRevision['kind'], actor: HistoryActor, message: string): Promise<string> {
    return this.text(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], JSON.stringify({ kind, actor, message, time: Date.now() }) + '\n');
  }
  async revision(revision: string): Promise<ScopeRevision> {
    if (!objectId(revision)) throw new AppError('invalid_input', 'A revision is a full Git object ID');
    const tree = await this.text(['rev-parse', `${revision}^{tree}`]);
    let metadata;
    try { metadata = JSON.parse(await this.text(['show', '-s', '--format=%B', revision])); }
    catch { throw new AppError('invalid_revision', 'Revision is not a harness checkpoint', 409); }
    return { revision, tree, ...metadata };
  }
  private async entries(revision: string): Promise<Entry[]> {
    if (!objectId(revision)) throw new AppError('invalid_input', 'Invalid snapshot revision');
    const raw = await this.git(['ls-tree', '-rz', revision]);
    return raw.toString('utf8').split('\0').filter(Boolean).map(line => {
      const [header, ...rest] = line.split('\t');
      const [mode, type, object] = header!.split(' ');
      const path = rest.join('\t');
      safePath(path);
      if (type !== 'blob' || !['100644', '100755'].includes(mode!)) throw new AppError('invalid_revision', 'Snapshot contains an unsupported entry', 409);
      return { path, mode: mode!, object: object! };
    });
  }
  private async materialize(root: string, part: HarnessPart, revision: string): Promise<void> {
    const target = await this.entries(revision);
    if (target.some(entry => !partOwns(part, entry.path))) throw new AppError('invalid_revision', 'Revision belongs to a different scope', 409);
    const current = await this.files(root, part);
    const keep = new Set(target.map(e => e.path));
    const owned = new Set(current.map(e => e.path));
    const removeDirectories = new Set<string>();
    const inspectDirectory = async (path: string): Promise<void> => {
      for (const name of await readdir(join(root, path))) {
        const child = `${path}/${name}`;
        const info = await lstat(join(root, child));
        if (info.isDirectory()) await inspectDirectory(child);
        else if (!info.isFile() || !owned.has(child)) throw new AppError('invalid_path', 'Restore would replace an entry outside its managed files');
      }
      removeDirectories.add(path);
    };
    // Validate all target ancestors before the first mutation.
    for (const entry of target) {
      const segments = entry.path.split('/');
      for (let n = 1; n < segments.length; n++) {
        const ancestor = segments.slice(0, n).join('/');
        try {
          const info = await lstat(join(root, ancestor));
          if (!info.isDirectory() && !(info.isFile() && owned.has(ancestor) && !keep.has(ancestor))) throw new AppError('invalid_path', 'Restore target has a non-directory ancestor');
          if (info.isFile()) break;
        }
        catch (error) { if (!missing(error)) throw error; }
      }
      try {
        const info = await lstat(join(root, entry.path));
        if (info.isSymbolicLink()) throw new AppError('invalid_path', 'Restore target is a link');
        if (info.isDirectory()) await inspectDirectory(entry.path);
      }
      catch (error) { if (!missing(error)) throw error; }
    }
    for (const file of current) if (!keep.has(file.path)) await rm(join(root, file.path));
    for (const directory of [...removeDirectories].sort((a, b) => b.split('/').length - a.split('/').length)) await rmdir(join(root, directory));
    for (const entry of target) {
      const absolute = join(root, entry.path);
      await mkdir(dirname(absolute), { recursive: true });
      const temp = join(dirname(absolute), `.tmp-${randomUUID()}`);
      try {
        await writeFile(temp, await this.git(['cat-file', 'blob', entry.object]), { flag: 'wx' });
        await chmod(temp, entry.mode === '100755' ? 0o755 : 0o644);
        await rename(temp, absolute);
      } finally { await rm(temp, { force: true }); }
    }
  }

  async ensure(memberId: string, part: HarnessPart, root: string): Promise<PartState> {
    const refs = this.refs(memberId, part);
    return this.queue.run(`scope:${this.key(part)}`, async () => {
      let committed = await this.ref(refs.committed);
      if (!committed) {
        const tree = await this.snapshot(this.source, part);
        committed = await this.record(tree, null, 'baseline', { type: 'harness', memberId }, 'Initial accepted files');
        await this.update(refs.committed, committed, null);
      }
      let checkpoint = await this.ref(refs.checkpoint);
      if (!checkpoint) {
        await this.materialize(root, part, committed);
        await this.text(['update-ref', '--stdin'], `start\ncreate ${refs.base} ${committed}\ncreate ${refs.checkpoint} ${committed}\nprepare\ncommit\n`);
        checkpoint = committed;
      }
      const base = await this.ref(refs.base);
      if (!base) throw new AppError('corrupt_data', 'Scope is missing its committed base', 500);
      return { part, checkpoint, committed, base };
    });
  }

  /** One-time policy migration: narrow exclusions without resetting existing pending files. */
  async migrateExclusions(memberId: string, previous: HarnessPart, next: HarnessPart, root: string): Promise<void> {
    if (this.key(previous) === this.key(next)) return;
    if (JSON.stringify([...previous.paths].sort()) !== JSON.stringify([...next.paths].sort()) || previous.exclude.some(path => !next.exclude.includes(path))) throw new AppError('invalid_config', 'Boundary migration can only add exclusions');
    const old = this.refs(memberId, previous), refs = this.refs(memberId, next);
    await this.queue.run(`scope:${this.key(next)}`, async () => {
      if (!(await this.ref(old.checkpoint)) || await this.ref(refs.checkpoint)) return;
      const actor: HistoryActor = { type: 'harness', memberId };
      const project = async (revision: string) => this.tree((await this.entries(revision)).filter(entry => partOwns(next, entry.path)));
      const oldCommitted = (await this.ref(old.committed))!;
      let committed = await this.ref(refs.committed);
      if (!committed) {
        committed = await this.record(await project(oldCommitted), null, 'baseline', actor, `Boundary migration from accepted ${oldCommitted}`);
        await this.update(refs.committed, committed, null);
      }
      const oldBase = (await this.ref(old.base))!;
      const baseTree = await project(oldBase);
      const base = baseTree === (await this.revision(committed)).tree ? committed : await this.record(baseTree, null, 'baseline', actor, `Boundary migration from stale base ${oldBase}`);
      const checkpoint = await this.record(await this.snapshot(root, next), base, 'checkpoint', actor, 'Preserve pending files while narrowing control-file exclusions');
      await this.text(['update-ref', '--stdin'], `start\ncreate ${refs.base} ${base}\ncreate ${refs.checkpoint} ${checkpoint}\nprepare\ncommit\n`);
    });
  }

  async checkpoint(memberId: string, part: HarnessPart, root: string, actor: HistoryActor, message: string, kind: 'checkpoint' | 'restore' = 'checkpoint'): Promise<ScopeRevision> {
    const state = await this.ensure(memberId, part, root);
    const tree = await this.snapshot(root, part);
    const previous = await this.revision(state.checkpoint);
    const recordRun = async (revision: string) => {
      if (actor.type === 'harness' && actor.runId) {
        identity(actor.runId, 'runId');
        const ref = `refs/harness/runs/${memberId}/${actor.runId}/${part.id}/${this.key(part)}`;
        await this.update(ref, revision, await this.ref(ref));
      }
    };
    if (tree === previous.tree && kind === 'checkpoint') { await recordRun(previous.revision); return previous; }
    const revision = await this.record(tree, state.checkpoint, kind, actor, message);
    await this.update(this.refs(memberId, part).checkpoint, revision, state.checkpoint);
    await recordRun(revision);
    return this.revision(revision);
  }

  async commit(memberId: string, part: HarnessPart, root: string, revision: string, expectedCommitted: string, message: string, actor: HistoryActor): Promise<ScopeRevision> {
    if (actor.type !== 'user' && (part.commit !== 'agent' || actor.type !== 'agent')) throw new AppError('approval_required', 'This part requires user approval to commit', 403);
    if (!message.trim() || message.length > 1000) throw new AppError('invalid_input', 'A commit needs an intent of 1–1,000 characters');
    const state = await this.ensure(memberId, part, root);
    return this.queue.run(`scope:${this.key(part)}`, async () => {
      const refs = this.refs(memberId, part);
      const current = await this.ref(refs.checkpoint);
      const committed = await this.ref(refs.committed);
      const base = await this.ref(refs.base);
      if (revision !== current || committed !== expectedCommitted || base !== committed) throw new AppError('stale_revision', 'The reviewed revision or committed base changed; review again', 409);
      const selected = await this.revision(revision);
      if (await this.snapshot(root, part) !== selected.tree) throw new AppError('stale_revision', 'Working files changed after the selected checkpoint', 409);
      const next = await this.record(selected.tree, state.committed, 'commit', actor, message);
      const commands = [`start`, `update ${refs.committed} ${next} ${committed}`, `update ${refs.base} ${next} ${base}`, `prepare`, `commit`, ''].join('\n');
      await this.text(['update-ref', '--stdin'], commands);
      return this.revision(next);
    });
  }
  async restore(memberId: string, part: HarnessPart, root: string, revision: string, actor: HistoryActor): Promise<ScopeRevision> {
    const state = await this.ensure(memberId, part, root);
    const chain = await this.text(['rev-list', state.checkpoint, state.committed]);
    if (!chain.split('\n').includes(revision)) throw new AppError('invalid_revision', 'Restore revision is outside this part history', 409);
    await this.checkpoint(memberId, part, root, actor, 'Before restore');
    const before = await this.snapshot(root, part);
    try {
      await this.materialize(root, part, revision);
      const restored = await this.checkpoint(memberId, part, root, actor, `Restore ${revision}`, 'restore');
      if (revision === state.committed && state.base !== state.committed) await this.update(this.refs(memberId, part).base, state.committed, state.base);
      return restored;
    } catch (error) {
      const rollback = await this.record(before, null, 'checkpoint', actor, 'Restore rollback');
      await this.materialize(root, part, rollback);
      throw error;
    }
  }
  async history(memberId: string, part: HarnessPart, root: string, limit = 100): Promise<ScopeRevision[]> {
    const state = await this.ensure(memberId, part, root);
    const ids = await this.text(['rev-list', `--max-count=${limit}`, state.checkpoint, state.committed]);
    return Promise.all(ids.split('\n').filter(Boolean).map(id => this.revision(id)));
  }
  async paths(revision: string): Promise<string[]> { return (await this.entries(revision)).map(entry => entry.path); }
  async readSnapshot(revision: string, path: string): Promise<string | null> {
    safePath(path);
    const entry = (await this.entries(revision)).find(entry => entry.path === path);
    return entry ? (await this.git(['cat-file', 'blob', entry.object])).toString('utf8') : null;
  }
  async diff(memberId: string, part: HarnessPart, root: string): Promise<{ state: PartState; revision: string; diff: string }> {
    const checkpoint = await this.checkpoint(memberId, part, root, { type: 'harness', memberId }, 'Review snapshot');
    const state = await this.ensure(memberId, part, root);
    return { state, revision: checkpoint.revision, diff: await this.text(['diff', '--no-ext-diff', '--no-textconv', '--binary', state.committed, checkpoint.revision, '--']) };
  }
}

export function harnessStorage(source: string): string {
  return resolve(dirname(source), '.rsi-harness', sha256(source));
}
