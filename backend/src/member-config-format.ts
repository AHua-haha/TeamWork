import { createHash } from 'node:crypto';
import type { RunSettings } from './config.js';
import type { HarnessConfig } from './harness-config.js';
import { AppError } from './types.js';

export const memberManifestVersion = 2;
export const projectAssignment = (harness: HarnessConfig) => ({ designScope: harness.designScope, implementationScope: harness.implementationScope });

/** Exact accepted source bytes; member fields are a projection of this bundle. */
export interface MemberConfigSource {
  path: string;
  files: Record<string, string>;
  digest: string;
  submittedBy: string;
  submittedAt: number;
}
export interface ConfigFields {
  name: string; role: string; responsibility: string; settings: RunSettings; harness: HarnessConfig;
}
export function sourceBundle(path: string, files: Record<string, string>, submittedBy: string): MemberConfigSource {
  const digest = createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  return { path, files, digest, submittedBy, submittedAt: Date.now() };
}
/** User/bootstrap changes use the same file format as an agent's submission. */
export function generatedSource(fields: ConfigFields, memberId: string, revision: number | null): MemberConfigSource {
  const { prompt, ...settings } = fields.settings;
  const manifest = {
    version: memberManifestVersion, memberId, revision, name: fields.name, role: fields.role, responsibility: fields.responsibility,
    settings, promptFiles: ['prompts/member.md'],
    harnesses: { project: projectAssignment(fields.harness) },
  };
  return sourceBundle(`.team/members/${memberId}/member.json`, {
    'member.json': JSON.stringify(manifest, null, 2) + '\n', 'prompts/member.md': prompt,
  }, 'user');
}

/** Startup-only format conversion; active submission accepts the current format exclusively. */
export function migrateMemberSource(source: MemberConfigSource, memberId: string, revision: number): MemberConfigSource | null {
  let manifest;
  try { manifest = JSON.parse(source.files['member.json']!); }
  catch { throw new AppError('corrupt_data', 'Accepted member manifest cannot be read', 500); }
  if (manifest?.version === memberManifestVersion) return null;
  if (manifest?.version !== 1 || !manifest.harnesses?.design || !manifest.harnesses?.implementation) throw new AppError('corrupt_data', 'Accepted member manifest has an unsupported format', 500);
  const converted = {
    ...manifest, version: memberManifestVersion, memberId, revision,
    harnesses: { project: { designScope: manifest.harnesses.design, implementationScope: manifest.harnesses.implementation } },
  };
  return sourceBundle(source.path, { ...source.files, 'member.json': JSON.stringify(converted, null, 2) + '\n' }, 'harness');
}
