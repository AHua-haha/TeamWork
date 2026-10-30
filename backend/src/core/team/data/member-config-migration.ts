import {lstat, readFile, writeFile, readdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {AppError} from '../../agent/data/model.js';
import {decodeText} from '../../text.js';
import {emptyDesignScope, parseDesignScope, type DesignScope} from './assignment.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Read only at the historical storage boundary; current member inputs never accept Harness fields. */
export function restoredDesignScope(data: Record<string, unknown>): DesignScope {
  const harness = object(data.harness) ? data.harness : undefined;
  return parseDesignScope(data.designScope ?? harness?.designScope ?? emptyDesignScope());
}
/** Preserve every meaningful pending field; remove only retired configuration keys. */
export function upgradeMemberManifest(text: string): string {
  let data: unknown;
  try {data = JSON.parse(text);} catch {return text;}
  if (!object(data) || !['execute', 'harness', 'harnesses'].some(key => Object.hasOwn(data, key))) return text;
  const {execute: _execute, harness, harnesses, ...current} = data;
  const old = object(harnesses) ? harnesses : {}, project = object(old.project) ? old.project : {};
  const scope = data.designScope ?? (object(harness) ? harness.designScope : undefined) ?? project.designScope ?? old.design;
  if (scope !== undefined) current.designScope = scope;
  return JSON.stringify(current, null, 2) + '\n';
}
/** Startup-only, never recreate missing files, follow links or repair malformed user edits. */
export async function upgradeMemberManifestFile(root: string, path: string): Promise<void> {
  if (!/^\.rsi\/members\/[^/]+\/member\.json$/.test(path)) throw new AppError('config_conflict', 'Invalid member manifest path', 409);
  const target = join(root, path);
  let info;
  try {info = await lstat(target);} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error;}
  if (!info.isFile() || info.isSymbolicLink()) throw new AppError('config_conflict', 'Member manifest must be a regular file during migration', 409);
  for (const part of ['.rsi','.rsi/members',dirname(path)]) {
    const parent = await lstat(join(root,part));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new AppError('config_conflict','Member migration refuses directory symlinks',409);
  }
  const previous = decodeText(await readFile(target));
  if (previous === null) return;
  const next = upgradeMemberManifest(previous);
  if (next !== previous) await writeFile(target, next, 'utf8');
}
/** Normalize existing draft bundles during a format upgrade, including not-yet-active members. */
export async function upgradeMemberDirectory(root: string): Promise<void> {
  for (const part of ['.rsi','.rsi/members']) {
    let info;
    try {info = await lstat(join(root,part));} catch(error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error;}
    if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError('config_conflict','Member migration refuses directory symlinks',409);
  }
  for (const entry of await readdir(join(root,'.rsi/members'),{withFileTypes:true})) {
    if (entry.isDirectory()) await upgradeMemberManifestFile(root, `.rsi/members/${entry.name}/member.json`);
  }
}
