import { createHash } from 'node:crypto';
import type { RunSettings } from './config.js';
import type { HarnessConfig } from './harness-config.js';

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
    version: 1, memberId, revision, name: fields.name, role: fields.role, responsibility: fields.responsibility,
    settings, promptFiles: ['prompts/member.md'],
    harnesses: { design: fields.harness.designScope, implementation: fields.harness.implementationScope },
  };
  return sourceBundle(`.team/members/${memberId}/member.json`, {
    'member.json': JSON.stringify(manifest, null, 2) + '\n', 'prompts/member.md': prompt,
  }, 'user');
}
