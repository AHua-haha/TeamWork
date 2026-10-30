import { lstat, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { memberRoot } from '../../workspace/workspace-layout.js';
import { createHash } from 'node:crypto';
import type { RunSettings } from './config.js';
import type { DesignScope } from './assignment.js';
import {upgradeMemberManifest} from './member-config-migration.js';
import { AppError } from '../../agent/data/model.js';

/** Schema control belongs to the backend envelope, not the editable JSON. */
export const memberManifestVersion = 5;
export interface MemberConfigSource {
  formatVersion?: number;
  path: string; files: Record<string, string>; digest: string; submittedBy: string; submittedAt: number;

}
export interface ConfigFields { name: string; role: string; responsibility: string; settings: RunSettings; designScope: DesignScope }
export function sourceBundle(path: string, files: Record<string, string>, submittedBy: string): MemberConfigSource {
  const digest = createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  return { formatVersion: memberManifestVersion, path, files, digest, submittedBy, submittedAt: Date.now() };
}
export function generatedSource(fields: ConfigFields): MemberConfigSource {
  const { prompt, ...settings } = fields.settings;
  const manifest = { name: fields.name, role: fields.role, responsibility: fields.responsibility, settings, promptFiles: ['prompts/member.md'], designScope: fields.designScope };
  return sourceBundle(`${memberRoot}/${fields.name}/member.json`, { 'member.json': JSON.stringify(manifest, null, 2) + '\n', 'prompts/member.md': prompt }, 'user');
}
/** Convert active records only; discard retired Git/history metadata without reading Git. */
export function migrateMemberSource(source: MemberConfigSource): MemberConfigSource | null {
  const data = source as MemberConfigSource & {acceptedRevision?: unknown; previous?: unknown; legacyPaths?: unknown; legacyManifestHashes?: unknown};
  const {acceptedRevision, previous, legacyPaths, legacyManifestHashes, ...current} = data;
  const retired = ['acceptedRevision','previous','legacyPaths','legacyManifestHashes'].some(key => Object.hasOwn(source,key));
  if (source.formatVersion === memberManifestVersion) return retired ? current : null;
  const raw = source.files['member.json'];
  if (raw === undefined) throw new AppError('corrupt_data', 'Active member manifest cannot be read', 500);
  try {JSON.parse(raw);} catch {throw new AppError('corrupt_data', 'Active member manifest cannot be read', 500);}
  return {...current, ...sourceBundle(source.path, {...source.files, 'member.json': upgradeMemberManifest(raw)}, 'backend-migration')};
}

/** Relocate the complete bundle, including pending files. Never overwrite or recreate a deletion. */
export async function relocateMemberSource(root: string, source: MemberConfigSource, name: string): Promise<MemberConfigSource | null> {
  const path = `${memberRoot}/${name}/member.json`;
  if (source.path === path) return null;
  if (!/^\.rsi\/members\/[A-Za-z0-9_-]{1,64}\/member\.json$/.test(source.path)) throw new AppError('corrupt_data', 'Invalid active member directory', 500);
  const inspect = async (path: string) => {
    try { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError('config_conflict', `Member directory is not a regular directory: ${path}`, 409); return info; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  };
  for (const part of ['.rsi', memberRoot]) await inspect(join(root, part));
  const before = join(root, dirname(source.path)), after = join(root, dirname(path));
  const existing = await inspect(before), destination = await inspect(after);
  if (existing && destination && existing.ino !== destination.ino) throw new AppError('config_conflict', `Cannot relocate member ${name}: destination directory already exists`, 409);
  if (existing && (!destination || before !== after)) await rename(before, after);
  return {...source, path};
}
