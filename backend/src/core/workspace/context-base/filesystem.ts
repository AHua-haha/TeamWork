import {constants} from 'node:fs';
import {lstat, open, readdir, realpath} from 'node:fs/promises';
import {join, posix} from 'node:path';
import {AppError} from '../../errors.js';
import type {ContextDiagnostic, ProjectContextNode} from '../data/context-index.js';

export const defaultContextExclusions = ['.git', '.rsi', '.run', '.claude', '.playwright-cli', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.venv', 'venv', '__pycache__'];
export const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export function relativeProjectPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.startsWith('/') || /[\\:\u0000-\u001f\u007f]/.test(value))
    throw new AppError('invalid_path', 'Context paths are relative to the project root');
  const path = value.replace(/\/+$/, '');
  if (path.split('/').some(part => !part || part === '..')) throw new AppError('invalid_path', 'Context paths cannot escape the project root');
  return posix.normalize(path);
}

/** Filesystem reads only. No watcher, SQL, write, command or external retrieval capability. */
export class ContextFilesystem {
  constructor(readonly root: string, readonly exclusions: ReadonlySet<string>) {}

  async verifyRoot(): Promise<void> {
    if (!(await lstat(this.root)).isDirectory() || await realpath(this.root) !== this.root)
      throw new AppError('workspace_unavailable', 'Context manager requires the canonical project directory', 503);
  }

  async info(path: string) {
    const relative = relativeProjectPath(path);
    let target = this.root;
    if (relative === '.') return lstat(target);
    for (const part of relative.split('/')) {
      target = join(target, part);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new AppError('invalid_path', `Context path is a symbolic link: ${relative}`);
      if (target !== join(this.root, relative) && !info.isDirectory()) throw new AppError('invalid_path', `Context ancestor is not a directory: ${relative}`);
    }
    return lstat(target);
  }

  async entries(path: string) {
    if (!(await this.info(path)).isDirectory()) throw new AppError('invalid_path', `${path} is not a directory`);
    return (await readdir(join(this.root, path), {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name));
  }

  async tree(maxEntries: number, diagnostics: ContextDiagnostic[]): Promise<{tree: ProjectContextNode; nodes: Map<string, ProjectContextNode>}> {
    const tree: ProjectContextNode = {projectPath: '.', kind: 'directory', children: []};
    const nodes = new Map<string, ProjectContextNode>([['.', tree]]), pending = [tree];
    while (pending.length) {
      const parent = pending.pop()!;
      for (const entry of await this.entries(parent.projectPath)) {
        if (this.exclusions.has(entry.name)) continue;
        const path = parent.projectPath === '.' ? entry.name : `${parent.projectPath}/${entry.name}`;
        if (!entry.isDirectory() && !entry.isFile()) {
          diagnostics.push({path, code: 'unsupported_entry', message: 'Non-regular project entry was not traversed', severity: 'warning'}); continue;
        }
        if (nodes.size >= maxEntries) throw new AppError('context_limit', `Project tree exceeds ${maxEntries} entries`);
        const node: ProjectContextNode = {projectPath: path, kind: entry.isDirectory() ? 'directory' : 'file', ...(entry.isDirectory() ? {children: []} : {})};
        parent.children!.push(node); nodes.set(path, node);
        if (node.kind === 'directory') pending.push(node);
      }
    }
    return {tree, nodes};
  }

  async header(path: string, maxBytes: number): Promise<string | null> {
    if (!(await this.info(path)).isFile()) throw new AppError('invalid_path', `${path} is not a regular file`);
    const file = await open(join(this.root,path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const chunks: Buffer[] = []; let size = 0;
      while (size <= maxBytes) {
        const buffer = Buffer.alloc(Math.min(1024, maxBytes + 1 - size));
        const {bytesRead} = await file.read(buffer,0,buffer.length,size);
        if (!bytesRead) break;
        chunks.push(buffer.subarray(0,bytesRead)); size += bytesRead;
        const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'');
        if (text.length >= 5 && !text.startsWith('---\n') && !text.startsWith('---\r\n')) return null;
        const first = text.indexOf('\n');
        if (first >= 0 && text.slice(0,first).replace(/\r$/,'') !== '---') return null;
        if (first >= 0) {
          const end = /(?:^|\n)---\r?(?:\n|$)/g; end.lastIndex = first + 1;
          const match = end.exec(text);
          // A boundary at the end of an intermediate read may still be an incomplete line.
          if (match && (match[0].endsWith('\n') || bytesRead < buffer.length)) return text.slice(first+1,match.index);
        }
      }
      const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'');
      if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return null;
      const first = text.indexOf('\n'), end = /(?:^|\n)---\r?(?:\n|$)/g;
      end.lastIndex = first + 1;
      const match = end.exec(text);
      if (size <= maxBytes && match) return text.slice(first+1,match.index);
      throw new AppError('invalid_metadata', `README metadata is unterminated or exceeds ${maxBytes} bytes`);
    } finally {await file.close();}
  }

  async text(path: string, maxBytes: number): Promise<string> {
    const info = await this.info(path);
    if (!info.isFile()) throw new AppError('invalid_path', `${path} is not a regular file`);
    const file = await open(join(this.root,path),constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (info.size > maxBytes) throw new AppError('context_limit', `${path} exceeds the consumer-context size limit`);
      const buffer = Buffer.alloc(Math.min(info.size + 1, maxBytes + 1));
      let length = 0;
      while (length < buffer.length) {
        const result = await file.read(buffer,length,buffer.length-length,length);
        if (!result.bytesRead) break; length += result.bytesRead;
      }
      const after = await file.stat();
      if (length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ino !== info.ino)
        throw new AppError('context_changed', `${path} changed while being read; refresh and retry`,409);
      try {return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length));}
      catch {throw new AppError('unsupported_file', `${path} is not UTF-8 text`,415);}
    } finally {await file.close();}
  }
}
