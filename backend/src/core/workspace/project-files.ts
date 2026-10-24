import { randomUUID } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeText, encodeText, maxFileBytes, missing, sha256 } from '../text.js';
import { AppError } from '../agent/data/model.js';

export type ProjectEntry = { path: string; type: 'file'; size: number; updatedAt: number } | { path: string; type: 'folder' };
export interface ProjectFile { path: string; revision: string; content: string; size: number; updatedAt: number }

export const maxProjectEntries = 2000;
export const maxProjectFindResults = 200;
const maxFindExamined = 50_000;
const maxDepth = 16;
const hiddenTop = new Set(['.git', '.rsi']);
const badCharacter = /[\\:\u0000-\u001f\u007f]/;

function validName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && name.length <= 255 && !badCharacter.test(name);
}

/** Segments of a project path. The empty path is the workspace folder where `root` allows it. */
export function projectPath(value: string, root = false): string[] {
  if (value === '' && root) return [];
  const segments = value.split('/');
  if (!segments.every(validName)) throw new AppError('invalid_path', 'A project path has segments of 1–255 characters, without ".", "..", "\\", ":", or control characters');
  if (hiddenTop.has(segments[0]!.toLowerCase())) throw new AppError('invalid_path', `${segments[0]} is not part of the project files`);
  return segments;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byPath = (a: { path: string }, b: { path: string }) => compare(a.path.toLowerCase(), b.path.toLowerCase()) || compare(a.path, b.path);
const updatedAt = (info: Stats) => Math.floor(info.mtimeMs);

/** The files of one workspace directory, outside `.git` and `.rsi/context`. Paths never pass through a link. */
export class ProjectFiles {
  constructor(private readonly root: string) {}

  /** Classifies a mapped implementation entry without interpreting content. */
  async kind(path: string): Promise<'file' | 'folder' | null> {
    const info = await this.locate(projectPath(path, true));
    return info === null ? null : info.isDirectory() ? 'folder' : info.isFile() ? 'file' : null;
  }

  async tree(path: string, depth: number): Promise<{ path: string; entries: ProjectEntry[]; truncated: boolean }> {
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > maxDepth) throw new AppError('invalid_input', `depth is 1–${maxDepth}`);
    const segments = projectPath(path, true);
    const target = await this.locate(segments);
    if (!target) throw new AppError('not_found', `${path} not found`, 404);
    if (!target.isDirectory()) throw new AppError('invalid_path', `${path} is not a folder`);
    const entries: ProjectEntry[] = [];
    let level = [segments];
    for (let current = 1; current <= depth && level.length; current++) {
      const next: string[][] = [];
      for (const folder of level) {
        for (const { entry, info } of await this.list(folder)) {
          const entryPath = [...folder, entry.name].join('/');
          if (info.isDirectory()) {
            entries.push({ path: entryPath, type: 'folder' });
            next.push([...folder, entry.name]);
          } else entries.push({ path: entryPath, type: 'file', size: info.size, updatedAt: updatedAt(info) });
          if (entries.length > maxProjectEntries) return { path, entries: entries.slice(0, maxProjectEntries).sort(byPath), truncated: true };
        }
      }
      level = next;
    }
    return { path, entries: entries.sort(byPath), truncated: false };
  }

  async read(path: string): Promise<ProjectFile> {
    const segments = projectPath(path);
    const info = await this.locate(segments);
    if (!info) throw new AppError('not_found', `${path} not found`, 404);
    if (!info.isFile()) throw new AppError('invalid_path', `${path} is not a file`);
    if (info.size > maxFileBytes) throw new AppError('unsupported_file', `${path} is larger than ${maxFileBytes} bytes`, 415);
    const bytes = await this.bytes(segments, path);
    const content = decodeText(bytes);
    if (content === null) throw new AppError('unsupported_file', `${path} is not UTF-8 text`, 415);
    return { path, revision: sha256(bytes), content, size: bytes.length, updatedAt: updatedAt(info) };
  }

  async save(path: string, content: string, baseRevision: string | null): Promise<{ path: string; revision: string; created: boolean }> {
    const segments = projectPath(path);
    const bytes = encodeText(content);
    const revision = sha256(bytes);
    const info = await this.locate(segments);
    const target = join(this.root, ...segments);
    if (info) {
      if (!info.isFile()) throw new AppError('invalid_path', `${path} is not a file`);
      if (baseRevision === null) throw new AppError('file_exists', `${path} already exists`, 409);
      if (info.size > maxFileBytes || sha256(await this.bytes(segments, path)) !== baseRevision) throw new AppError('stale_revision', `${path} changed since it was read`, 409);
      if (revision === baseRevision) return { path, revision, created: false };
    } else {
      if (baseRevision !== null) throw new AppError('stale_revision', `${path} no longer exists`, 409);
      await mkdir(join(this.root, ...segments.slice(0, -1)), { recursive: true });
    }
    const temp = join(this.root, ...segments.slice(0, -1), `.tmp-${randomUUID()}`);
    try {
      await writeFile(temp, bytes, { flag: 'wx' });
      if (info) await chmod(temp, info.mode & 0o7777);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return { path, revision, created: !info };
  }

  /** Breadth-first, so shallow matches come first. */
  async find(q: string): Promise<{ paths: string[]; truncated: boolean }> {
    if (q.length < 1 || q.length > 200) throw new AppError('invalid_input', 'q has 1–200 characters');
    await this.locate([]);
    const needle = q.toLowerCase();
    const paths: string[] = [];
    let examined = 0;
    let level: string[][] = [[]];
    while (level.length) {
      const next: string[][] = [];
      for (const folder of level) {
        for (const { entry, info } of await this.list(folder)) {
          if (++examined > maxFindExamined) return { paths, truncated: true };
          const segments = [...folder, entry.name];
          if (info.isDirectory()) next.push(segments);
          else if (segments.join('/').toLowerCase().includes(needle)) {
            if (paths.length === maxProjectFindResults) return { paths, truncated: true };
            paths.push(segments.join('/'));
          }
        }
      }
      level = next;
    }
    return { paths, truncated: false };
  }

  /** Status of the entry, or null when it is missing. Fails when a step is a link or a file. */
  private async locate(segments: string[]): Promise<Stats | null> {
    try {
      if (!(await stat(this.root)).isDirectory()) throw new Error('not a folder');
    } catch {
      throw new AppError('workspace_unavailable', `Workspace folder ${this.root} is missing or unreadable`, 503);
    }
    let info: Stats | null = null;
    for (const [index, segment] of segments.entries()) {
      try { info = await lstat(join(this.root, ...segments.slice(0, index), segment)); }
      catch (error) {
        if (missing(error)) return null;
        throw error;
      }
      const path = segments.slice(0, index + 1).join('/');
      if (info.isSymbolicLink()) throw new AppError('invalid_path', `${path} is a link`);
      if (index < segments.length - 1 && !info.isDirectory()) throw new AppError('invalid_path', `${path} is not a folder`);
    }
    return info ?? await lstat(this.root);
  }

  /** Visible files and folders of one folder, by name. */
  private async list(folder: string[]): Promise<{ entry: Dirent; info: Stats }[]> {
    let entries: Dirent[];
    try { entries = await readdir(join(this.root, ...folder), { withFileTypes: true }); }
    catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    const listed = [];
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      if (!validName(entry.name) || (!folder.length && hiddenTop.has(entry.name.toLowerCase()))) continue;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      try { listed.push({ entry, info: await lstat(join(this.root, ...folder, entry.name)) }); }
      catch (error) { if (!missing(error)) throw error; }
    }
    return listed;
  }

  private async bytes(segments: string[], path: string): Promise<Buffer> {
    try { return await readFile(join(this.root, ...segments)); }
    catch (error) {
      if (missing(error)) throw new AppError('not_found', `${path} not found`, 404);
      throw error;
    }
  }
}
