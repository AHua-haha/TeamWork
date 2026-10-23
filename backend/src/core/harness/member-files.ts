import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { EditOperations, LsOperations, ReadOperations, WriteOperations } from '@earendil-works/pi-coding-agent';
import { contextPath } from '../workspace/context-path.js';
import { decodeText, encodeText, maxFileBytes, missing } from '../text.js';
import { AppError } from '../agent/types.js';

export type FileMode = 'see' | 'read' | 'write' | 'mkdir';
/** The rule for one agent: why it may not do `mode` on a workspace-relative path, or null when it may. */
export interface FileAccess { deny(path: string, mode: FileMode): string | null }

const badCharacter = /[\\:\u0000-\u001f\u007f]/;

/**
 * The workspace folder as one agent may use it, in the form Pi's file tools take: operations that
 * check the agent's access, keep paths inside the folder, never pass through a link, and hide `.git`.
 * Files under `.rsi/context/` keep the context base's name rules, so every file written there is one it serves.
 */
export class MemberFiles {
  readonly read: ReadOperations;
  readonly write: WriteOperations;
  readonly edit: EditOperations;
  readonly ls: LsOperations;

  constructor(readonly root: string, private readonly access: FileAccess) {
    this.read = {
      access: async absolute => { await this.existing(absolute, 'read'); },
      readFile: async absolute => {
        const { segments, info } = await this.existing(absolute, 'read');
        if (info.size > maxFileBytes) throw new AppError('unsupported_file', `${segments.join('/')} is larger than ${maxFileBytes} bytes`, 415);
        const bytes = await readFile(join(this.root, ...segments));
        if (decodeText(bytes) === null) throw new AppError('unsupported_file', `${segments.join('/')} is not UTF-8 text`, 415);
        return bytes;
      },
    };
    this.write = {
      mkdir: async directory => {
        const segments = this.resolve(directory, 'see');
        this.names(segments);
        const existing = await this.walk(segments);
        if (existing) {
          if (!existing.isDirectory()) throw new AppError('invalid_path', 'The parent path is not a directory');
          return;
        }
        this.resolve(directory, 'write', true);
        await mkdir(join(this.root, ...segments), { recursive: true });
      },
      writeFile: (absolute, content) => this.save(absolute, content),
    };
    this.edit = {
      access: async absolute => {
        await this.existing(absolute, 'read');
        this.resolve(absolute, 'write');
      },
      readFile: this.read.readFile,
      writeFile: (absolute, content) => this.save(absolute, content),
    };
    this.ls = {
      exists: async absolute => {
        try { return (await this.walk(this.resolve(absolute, 'see'))) !== null; }
        catch (error) {
          if (error instanceof AppError) return false;
          throw error;
        }
      },
      stat: async absolute => {
        const info = await this.walk(this.resolve(absolute, 'see'));
        if (!info) throw new AppError('not_found', `${absolute} not found`, 404);
        return { isDirectory: () => info.isDirectory() };
      },
      readdir: async absolute => {
        const segments = this.resolve(absolute, 'see');
        const info = await this.walk(segments);
        if (!info?.isDirectory()) throw new AppError('invalid_path', `${absolute} is not a folder`);
        const names: string[] = [];
        for (const name of (await readdir(join(this.root, ...segments))).sort()) {
          if (name.length > 255 || badCharacter.test(name) || this.hidden([...segments, name]) || this.access.deny([...segments, name].join('/'), 'see') !== null) continue;
          try { const entry = await lstat(join(this.root, ...segments, name)); if (entry.isFile() || entry.isDirectory()) names.push(name); }
          catch (error) { if (!missing(error)) throw error; }
        }
        return names;
      },
    };
  }

  /** The segments of an absolute path inside the workspace folder, once the agent's access for `mode` is checked. */
  private resolve(absolute: string, mode: FileMode, folder = false): string[] {
    const path = relative(this.root, absolute);
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) throw new AppError('invalid_path', `${absolute} is outside the workspace folder; use paths inside it`);
    const segments = path === '' ? [] : path.split(sep);
    if (segments.some(segment => segment.length > 255 || badCharacter.test(segment))) throw new AppError('invalid_path', `${path} has a name that is not allowed`);
    if (this.hidden(segments)) throw new AppError('not_found', `${path} not found`, 404);
    if(segments[0]?.toLowerCase()==='.rsi' && (segments[0]!=='.rsi'||(segments[1]&&segments[1]!==segments[1].toLowerCase())))throw new AppError('invalid_path','Use the canonical .rsi/context and .rsi/members roots');
    if(segments[0]==='.rsi'&&segments[1]==='context'&&segments[2]&&segments[2]!==segments[2].toLowerCase())throw new AppError('invalid_path','Use the canonical design and implement purpose roots');
    const label = segments.join('/');
    if (segments.length && this.access.deny(label, 'see') !== null) throw new AppError('not_found', `${label} not found`, 404);
    if (mode !== 'see') {
      const reason = this.access.deny(label, folder ? 'mkdir' : mode);
      if (reason !== null) throw new AppError('access_denied', reason, 403);
    }
    return segments;
  }

  private hidden(segments: string[]): boolean {
    return segments.some(segment => segment.toLowerCase() === '.git') || (segments[0]?.toLowerCase() === '.rsi' && !['context', 'members', undefined].includes(segments[1]?.toLowerCase()));
  }

  /** Names under `.rsi/context/` follow the context base's rules. */
  private names(segments: string[]): void {
    if (segments[0] !== '.rsi' || segments[1] !== 'context') return;
    if (segments.length > 2) contextPath(segments.slice(2).join('/'));
  }

  /** The status of the entry, or null when it is missing. Fails when a step is a link, or a file before the last step. */
  private async walk(segments: string[]): Promise<Stats | null> {
    let info = await lstat(this.root).catch(error => {
      if (missing(error)) throw new AppError('workspace_unavailable', `Workspace folder ${this.root} is missing or unreadable`, 503);
      throw error;
    });
    if (!info.isDirectory()) throw new AppError('workspace_unavailable', `Workspace folder ${this.root} is not a real directory`, 503);
    for (const [index, segment] of segments.entries()) {
      try { info = await lstat(join(this.root, ...segments.slice(0, index + 1))); }
      catch (error) {
        if (missing(error)) return null;
        throw error;
      }
      const path = segments.slice(0, index + 1).join('/');
      if (info.isSymbolicLink()) throw new AppError('invalid_path', `${path} is a link`);
      if (index < segments.length - 1 && !info.isDirectory()) throw new AppError('invalid_path', `${path} is not a folder`);
      void segment;
    }
    return info;
  }

  private async existing(absolute: string, mode: FileMode): Promise<{ segments: string[]; info: Stats }> {
    const segments = this.resolve(absolute, mode);
    const info = await this.walk(segments);
    if (!info) throw new AppError('not_found', `${segments.join('/')} not found`, 404);
    if (!info.isFile()) throw new AppError('invalid_path', `${segments.join('/')} is not a file`);
    return { segments, info };
  }

  /** Replaces the file in one step, or creates it in an existing folder, keeping permissions. */
  private async save(absolute: string, content: string): Promise<void> {
    const segments = this.resolve(absolute, 'write');
    if (!segments.length) throw new AppError('invalid_path', 'The workspace folder is not a file');
    this.names(segments);
    const bytes = encodeText(content);
    const parent = await this.walk(segments.slice(0, -1));
    if (!parent?.isDirectory()) throw new AppError('not_found', `The folder of ${segments.join('/')} does not exist`, 404);
    const info = await this.walk(segments);
    if (info && !info.isFile()) throw new AppError('invalid_path', `${segments.join('/')} is not a file`);
    const temp = join(this.root, ...segments.slice(0, -1), `.tmp-${randomUUID()}`);
    try {
      await writeFile(temp, bytes, { flag: 'wx' });
      if (info) await chmod(temp, info.mode & 0o7777);
      await rename(temp, join(this.root, ...segments));
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
}
