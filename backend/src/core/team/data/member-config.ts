import { lstat, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { memberRoot } from '../../workspace/workspace-layout.js';
import { createHash } from 'node:crypto';
import type { RunSettings } from './config.js';
import type { MemberAssignment } from './assignment.js';
import { AppError } from '../../agent/data/model.js';

/** Schema control belongs to the backend envelope, not the editable JSON. */
export const memberManifestVersion = 4;
export interface MemberConfigSource {
  formatVersion?: number;
  acceptedRevision?: string;
  path: string; files: Record<string, string>; digest: string; submittedBy: string; submittedAt: number;
  previous?: MemberConfigSource;
  /** Backend-only aliases for reading commits made before directory relocation. */
  legacyPaths?: string[];
}
export interface ConfigFields { name: string; role: string; responsibility: string; settings: RunSettings; harness: MemberAssignment }
export function sourceBundle(path: string, files: Record<string, string>, submittedBy: string): MemberConfigSource {
  const digest = createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  return { formatVersion: memberManifestVersion, path, files, digest, submittedBy, submittedAt: Date.now() };
}
export function generatedSource(fields: ConfigFields): MemberConfigSource {
  const { prompt, ...settings } = fields.settings;
  const manifest = { name: fields.name, role: fields.role, responsibility: fields.responsibility, settings, promptFiles: ['prompts/member.md'], designScope: fields.harness.designScope, execute: { allowedCommands: fields.harness.allowedCommands } };
  return sourceBundle(`${memberRoot}/${fields.name}/member.json`, { 'member.json': JSON.stringify(manifest, null, 2) + '\n', 'prompts/member.md': prompt }, 'user');
}
/** Startup-only conversion preserves the exact previous source and every prompt byte. */
export function migrateMemberSource(source: MemberConfigSource, allowedCommands: MemberAssignment['allowedCommands'] = []): MemberConfigSource | null {
  if (source.formatVersion === memberManifestVersion) return null;
  let old: { name?: unknown; role?: unknown; responsibility?: unknown; settings?: unknown; promptFiles?: unknown; designScope?: unknown; execute?: unknown; harnesses?: { project?: { designScope?: unknown }; design?: unknown } };
  try { old = JSON.parse(source.files['member.json']!); }
  catch { throw new AppError('corrupt_data', 'Accepted member manifest cannot be read', 500); }
  const designScope = old.designScope ?? old.harnesses?.project?.designScope ?? old.harnesses?.design;
  if (!designScope) throw new AppError('corrupt_data', 'Accepted member manifest has no design assignment', 500);
  const manifest = { name: old.name, role: old.role, responsibility: old.responsibility, settings: old.settings, promptFiles: old.promptFiles, designScope, execute: old.execute ?? { allowedCommands } };
  return { ...sourceBundle(source.path, { ...source.files, 'member.json': JSON.stringify(manifest, null, 2) + '\n' }, 'harness'), previous: source, ...(source.legacyPaths ? {legacyPaths: source.legacyPaths} : {}) };
}

/** Relocate the complete bundle, including pending files. Never overwrite or recreate a deletion. */
export async function relocateMemberSource(root: string, source: MemberConfigSource, name: string): Promise<MemberConfigSource | null> {
  const path = `${memberRoot}/${name}/member.json`;
  if (source.path === path) return null;
  if (!/^\.rsi\/members\/[A-Za-z0-9_-]{1,64}\/member\.json$/.test(source.path)) throw new AppError('corrupt_data', 'Invalid accepted member directory', 500);
  const inspect = async (path: string) => {
    try { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError('config_conflict', `Member directory is not a regular directory: ${path}`, 409); return info; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  };
  for (const part of ['.rsi', memberRoot]) await inspect(join(root, part));
  const before = join(root, dirname(source.path)), after = join(root, dirname(path));
  const existing = await inspect(before), destination = await inspect(after);
  if (existing && destination && existing.ino !== destination.ino) throw new AppError('config_conflict', `Cannot relocate member ${name}: destination directory already exists`, 409);
  if (existing && (!destination || before !== after)) await rename(before, after);
  return {...source, path, legacyPaths: [...new Set([...(source.legacyPaths ?? []), source.path])]};
}

/** Old Git commits can still use pre-migration paths; accepted identity stays unchanged. */
export function currentMemberPaths(files: Record<string, string>, sources: readonly MemberConfigSource[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    let target = path;
    for (const source of sources) {
      const alias = source.legacyPaths?.find(old => path.startsWith(dirname(old) + '/'));
      if (alias) { target = dirname(source.path) + path.slice(dirname(alias).length); break; }
    }
    if (Object.hasOwn(output, target)) throw new AppError('config_conflict', `Both legacy and current member files exist: ${target}`, 409);
    output[target] = content;
  }
  return output;
}
