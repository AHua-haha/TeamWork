import { harnessPrompt } from './harness-prompts.js';
import type { HarnessDefinition } from './harness-history.js';
import type { StoredMember } from './team.js';

export interface ImplementationScope { paths: string[]; usePaths: string[] }
const files = ['ls', 'read', 'write', 'edit'];
/** Fixed purpose policy; an assignment supplies design references, never permissions or tool definitions. */
export function purposeHarnesses(member: StoredMember, implementation: ImplementationScope = { paths: [], usePaths: [] }): HarnessDefinition[] {
  const config = member.value.harness;
  const designPaths = member.value.lead ? ['.context/user'] : config.designScope.working.map(path => `.context/${path}`);
  return [
    {
      id: 'management',
      prompt: harnessPrompt('management'),
      tools: [...files, 'bash', ...(member.value.lead ? ['list_models', 'validate_member_config'] : [])],
      parts: [
        ...(designPaths.length ? [{ id: 'design', paths: designPaths, exclude: config.designScope.dependencies.map(path => `.context/${path}`), commit: 'user' as const, prompt: harnessPrompt('management-design') }] : []),
        ...(member.value.lead ? [{ id: 'member-config', paths: ['.team/members'], exclude: [], commit: 'user' as const, prompt: harnessPrompt('management-members') }] : []),
      ],
    },
    {
      id: 'implementation',
      prompt: harnessPrompt('implementation'),
      tools: [...files, 'bash'],
      parts: implementation.paths.length ? [{ id: 'implementation', paths: implementation.paths, exclude: ['.context', '.team', ...implementation.usePaths], commit: 'agent', prompt: harnessPrompt('implementation-scope') }] : [],
    },
    {
      id: 'execute',
      prompt: harnessPrompt('execute', { allowedCommands: JSON.stringify(config.allowedCommands) }),
      tools: config.allowedCommands.length ? ['bash'] : [], parts: [],
    },
  ];
}
export function inspectHarnesses(member: StoredMember, implementation: ImplementationScope): HarnessDefinition[] {
  const definitions = purposeHarnesses(member, implementation), writable = definitions.some(d => d.parts.length);
  return definitions.map(d => ({ ...d, tools: d.tools.filter(name => writable || !['write', 'edit'].includes(name)) }));
}
