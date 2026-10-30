import { lstat, mkdir, mkdtemp, open, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppError } from '../errors.js';
import { missing, sha256 } from '../text.js';
import { managedRoot } from './workspace-layout.js';
import { workspaceContext } from './project-context.js';

export interface WorkspaceInitialization {
  directory: string;
  cleanupPaths: string[];
  cleanupRevision: string | null;
}

async function info(path: string) {
  try { return await lstat(path); }
  catch (error) { if (missing(error)) return undefined; throw error; }
}

/** A reserved path must have its exact spelling and cannot redirect through a link. */
async function reserved(directory: string, name: string): Promise<void> {
  const names = (await readdir(directory)).filter(value => value.toLowerCase() === name.toLowerCase());
  if (names.some(value => value !== name)) throw new AppError('file_exists', `${name} has a conflicting spelling`, 409);
  const entry = await info(join(directory, name));
  if (entry && (!entry.isDirectory() || entry.isSymbolicLink()))
    throw new AppError('file_exists', `${join(directory, name)} must be a real directory`, 409);
}

/** Read-only review, including nested state changes without following symbolic links. */
export async function inspectManagedState(directory: string): Promise<WorkspaceInitialization> {
  await reserved(directory, managedRoot);
  const root = join(directory, managedRoot);
  if (!await info(root)) return {directory, cleanupPaths: [], cleanupRevision: null};
  await reserved(root, 'context');
  const context = await workspaceContext(directory);
  const contextName = context.root.slice(managedRoot.length + 1);
  await reserved(root, contextName);
  const records: unknown[] = [];
  const visit = async (path: string): Promise<boolean> => {
    const entry = await lstat(join(root, path), {bigint: true});
    records.push([path, String(entry.dev), String(entry.ino), String(entry.mode), String(entry.size), String(entry.mtimeNs), String(entry.ctimeNs)]);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return true;
    let nonempty = false;
    for (const child of (await readdir(join(root, path))).sort()) if (await visit(`${path}/${child}`)) nonempty = true;
    return nonempty;
  };
  const cleanupPaths: string[] = [];
  for (const name of (await readdir(root)).sort()) {
    if (name === contextName) continue;
    if (await visit(name)) cleanupPaths.push(`${managedRoot}/${name}`);
  }
  const rootInfo = await lstat(root);
  return {directory, cleanupPaths, cleanupRevision: cleanupPaths.length ? sha256(JSON.stringify([directory, rootInfo.dev, rootInfo.ino, records])) : null};
}

/** Only this attempt's additions are removed on rollback; prior metadata is staged by rename. */
export class PreparedWorkspaceFiles {
  private readonly files: string[] = [];
  private readonly directories: string[] = [];
  private readonly staged: string[] = [];
  private backup?: string;
  private constructor(readonly directory: string) {}

  static async begin(directory: string, cleanupRevision?: string): Promise<PreparedWorkspaceFiles> {
    const review = await inspectManagedState(directory);
    if (review.cleanupPaths.length && review.cleanupRevision !== cleanupRevision)
      throw new AppError('cleanup_required', 'Review and confirm cleanup of non-context .rsi state before initializing this workspace', 409);
    const prepared = new PreparedWorkspaceFiles(directory);
    try {
      await prepared.mkdir(managedRoot);
      const contextName = (await workspaceContext(directory)).root.slice(managedRoot.length + 1);
      const names = (await readdir(join(directory, managedRoot))).filter(name => name !== contextName);
      if (names.length) {
        prepared.backup = await mkdtemp(join(directory, managedRoot, '.initialization-'));
        for (const name of names) {
          await rename(join(directory, managedRoot, name), join(prepared.backup, name));
          prepared.staged.push(name);
        }
      }
      return prepared;
    } catch (error) { await prepared.rollback(); throw error; }
  }

  async mkdir(path: string): Promise<void> {
    let parent = this.directory;
    for (const name of path.split('/')) {
      await reserved(parent, name);
      const target = join(parent, name);
      if (!await info(target)) { await mkdir(target); this.directories.push(target); }
      parent = target;
    }
  }

  async exists(path: string, kind: 'file' | 'directory'): Promise<boolean> {
    // Inspect each ancestor before accessing the next component.
    let parent = this.directory;
    const segments = path.split('/');
    for (const name of segments.slice(0, -1)) {
      await reserved(parent, name);
      parent = join(parent, name);
      if (!await info(parent)) return false;
    }
    const name = segments.at(-1)!;
    if ((await readdir(parent)).some(value => value !== name && value.toLowerCase() === name.toLowerCase()))
      throw new AppError('file_exists', `${path} has a conflicting spelling`, 409);
    const entry = await info(join(parent, name));
    if (entry && (entry.isSymbolicLink() || !(kind === 'file' ? entry.isFile() : entry.isDirectory())))
      throw new AppError('file_exists', `${path} must be a regular ${kind}`, 409);
    return !!entry;
  }

  async create(path: string, content: string): Promise<void> {
    if (await this.exists(path, 'file')) return;
    await this.mkdir(dirname(path));
    const file = join(this.directory, path);
    const handle = await open(file, 'wx');
    this.files.push(file);
    try { await handle.writeFile(content); }
    finally { await handle.close(); }
  }

  async finish(): Promise<void> {
    if (this.backup) await rm(this.backup, {recursive: true, force: true});
  }

  async rollback(): Promise<void> {
    for (const file of [...this.files].reverse()) await rm(file, {force: true});
    for (const directory of [...this.directories].reverse()) {
      try { await rmdir(directory); }
      catch (error) { if (!missing(error) && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error; }
    }
    if (this.backup) {
      for (const name of this.staged) await rename(join(this.backup, name), join(this.directory, managedRoot, name));
      await rm(this.backup, {recursive: true, force: true});
    }
  }
}
