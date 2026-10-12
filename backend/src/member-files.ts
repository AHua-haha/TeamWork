import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { EditOperations, LsOperations, ReadOperations, WriteOperations } from '@earendil-works/pi-coding-agent';
import { validSegment } from './context-base.js';
import type { StoredMember } from './team.js';
import { decodeText, encodeText, maxFileBytes, missing } from './text.js';
import { AppError } from './types.js';

export type FileMode = 'see' | 'read' | 'write';
/** The rule for one agent: why it may not do `mode` on a workspace-relative path, or null when it may. */
export interface FileAccess { deny(path: string, mode: FileMode): string | null }

const badCharacter = /[\\:\u0000-\u001f\u007f]/;

/** What a team member may see, read, and write in the workspace folder. */
export function memberAccess(member: StoredMember): FileAccess {
  const { lead, scope } = member.value;
  const entries = scope.map(path => path.toLowerCase());
  return {
    deny(path, mode) {
      const segments = path.split('/');
      if (segments[0] !== '.context' || segments.length === 1) return null;
      if (segments[1] === 'user') return mode === 'write' ? 'User context changes only through the user' : null;
      if (segments.length === 2) return mode === 'write' ? '.context/agent is a folder' : null;
      if (lead) return null;
      const key = ['agent', ...segments.slice(2)].join('/').toLowerCase();
      if (entries.some(entry => entry === 'agent' || key === entry || key.startsWith(`${entry}/`))) return null;
      if (mode === 'see' && entries.some(entry => entry.startsWith(`${key}/`))) return null;
      return `${path} is outside your scope (${scope.length ? scope.map(entry => `.context/${entry}`).join(', ') : 'empty'})`;
    },
  };
}

/**
 * The workspace folder as one agent may use it, in the form Pi's file tools take: operations that
 * check the agent's access, keep paths inside the folder, never pass through a link, and hide `.git`.
 * Files under `.context/` keep the context base's name rules, so every file written there is one it serves.
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
        const segments = this.resolve(directory, 'write', true);
        this.names(segments);
        await this.walk(segments);
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
    if (segments[0]?.toLowerCase() === '.context' && (segments[0] !== '.context' || (segments.length > 1 && segments[1] !== 'agent' && segments[1] !== 'user'))) {
      throw new AppError('invalid_path', '.context holds only user/ and agent/');
    }
    const label = segments.join('/');
    if (segments.length && this.access.deny(label, 'see') !== null) throw new AppError('not_found', `${label} not found`, 404);
    if (mode !== 'see') {
      // A folder is writable when a file inside it would be.
      const reason = this.access.deny(folder ? [...segments, '_'].join('/') : label, mode);
      if (reason !== null) throw new AppError('access_denied', reason, 403);
    }
    return segments;
  }

  private hidden(segments: string[]): boolean {
    return segments[0]?.toLowerCase() === '.git';
  }

  /** Names under `.context/agent/` and `.context/user/` follow the context base's rules. */
  private names(segments: string[]): void {
    if (segments[0] !== '.context') return;
    for (const segment of segments.slice(2)) {
      if (!validSegment(segment)) throw new AppError('invalid_path', `Invalid name "${segment}" in .context: use 1–128 letters, digits, spaces, "-", "_", or "."; a name cannot start with "." or a space or end with "." or a space`);
    }
  }

  /** The status of the entry, or null when it is missing. Fails when a step is a link, or a file before the last step. */
  private async walk(segments: string[]): Promise<Stats | null> {
    let info = await lstat(this.root).catch(error => {
      if (missing(error)) throw new AppError('workspace_unavailable', `Workspace folder ${this.root} is missing or unreadable`, 503);
      throw error;
    });
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
