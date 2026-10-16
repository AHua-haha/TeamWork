import { createHash } from 'node:crypto';
import type { RunSettings } from './config.js';
import type { HarnessConfig } from './harness-config.js';
import { AppError } from './types.js';

/** Schema control belongs to the backend envelope, not the editable JSON. */
export const memberManifestVersion = 4;
export interface MemberConfigSource {
  formatVersion?: number;
  acceptedRevision?: string;
  path: string; files: Record<string, string>; digest: string; submittedBy: string; submittedAt: number;
  previous?: MemberConfigSource;
}
export interface ConfigFields { name: string; role: string; responsibility: string; settings: RunSettings; harness: HarnessConfig }
export function sourceBundle(path: string, files: Record<string, string>, submittedBy: string): MemberConfigSource {
  const digest = createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  return { formatVersion: memberManifestVersion, path, files, digest, submittedBy, submittedAt: Date.now() };
}
export function generatedSource(fields: ConfigFields, memberId: string): MemberConfigSource {
  const { prompt, ...settings } = fields.settings;
  const manifest = { name: fields.name, role: fields.role, responsibility: fields.responsibility, settings, promptFiles: ['prompts/member.md'], designScope: fields.harness.designScope, execute: { allowedCommands: fields.harness.allowedCommands } };
  return sourceBundle(`.team/members/${memberId}/member.json`, { 'member.json': JSON.stringify(manifest, null, 2) + '\n', 'prompts/member.md': prompt }, 'user');
}
/** Startup-only conversion preserves the exact previous source and every prompt byte. */
export function migrateMemberSource(source: MemberConfigSource, allowedCommands: HarnessConfig['allowedCommands'] = []): MemberConfigSource | null {
  if (source.formatVersion === memberManifestVersion) return null;
  let old: { name?: unknown; role?: unknown; responsibility?: unknown; settings?: unknown; promptFiles?: unknown; designScope?: unknown; execute?: unknown; harnesses?: { project?: { designScope?: unknown }; design?: unknown } };
  try { old = JSON.parse(source.files['member.json']!); }
  catch { throw new AppError('corrupt_data', 'Accepted member manifest cannot be read', 500); }
  const designScope = old.designScope ?? old.harnesses?.project?.designScope ?? old.harnesses?.design;
  if (!designScope) throw new AppError('corrupt_data', 'Accepted member manifest has no design assignment', 500);
  const manifest = { name: old.name, role: old.role, responsibility: old.responsibility, settings: old.settings, promptFiles: old.promptFiles, designScope, execute: old.execute ?? { allowedCommands } };
  return { ...sourceBundle(source.path, { ...source.files, 'member.json': JSON.stringify(manifest, null, 2) + '\n' }, 'harness'), previous: source };
}
