import { contextRoot, designRoot, memberContextPath, contextPaths, nodeReference } from '../workspace/workspace-layout.js';
import { harnessPrompt } from '../harness/harness-prompts.js';
import type { HarnessDefinition, HarnessResource } from '../harness/harness-resources.js';
import type { StoredMember } from '../team/team.js';

export interface ImplementationScope { paths: string[]; usePaths: string[] }
const reads = ['ls', 'read', 'grep', 'find'];
const files = [...reads, 'write', 'edit'];
/** One system context scope covers both document forms and survives representation changes. */
export function implementationContextResource(design: string): HarnessResource {
  const path = memberContextPath(design);
  return { id: `implementation-context:${design}`, paths: contextPaths(design,'impl').map(p=>`${contextRoot}/${p}`), exclude: [], context: 'impl', commit: 'agent', prompt: harnessPrompt('implementation-context', { design, context: path }) };
}
/** Fixed purpose policy; an assignment supplies design references, never permissions or tool definitions. */
export function purposeHarnesses(member: StoredMember, implementation: ImplementationScope = { paths: [], usePaths: [] }, scope = member.value.harness.designScope): HarnessDefinition[] {
  const designPaths = member.value.lead ? [designRoot] : [];
  return [
    {
      id: 'management',
      prompt: harnessPrompt('management'),
      tools: member.value.lead ? [...files, 'bash', 'list_models', 'validate_member_config'] : reads,
      resources: [
        ...(designPaths.length ? [{ id: 'design', paths: designPaths, exclude: [], context: 'design' as const, commit: 'user' as const, prompt: harnessPrompt('management-design') }] : []),
        ...(member.value.lead ? [{ id: 'member-config', paths: ['.rsi/members'], exclude: [], commit: 'user' as const, prompt: harnessPrompt('management-members') }] : []),
      ],
    },
    {
      id: 'implementation',
      prompt: harnessPrompt('implementation'),
      tools: [...files, 'bash'],
      resources: [
        ...(implementation.paths.length ? [{ id: 'implementation', paths: implementation.paths, exclude: ['.rsi', ...implementation.usePaths], commit: 'agent' as const, prompt: harnessPrompt('implementation-scope') }] : []),
        ...scope.working.map(implementationContextResource),
      ],
    },
    {
      id: 'execute',
      prompt: harnessPrompt('execute'),
      tools: ['bash', 'web_search', 'web_fetch'], resources: [],
    },
  ];
}
export function inspectHarnesses(member: StoredMember, implementation: ImplementationScope): HarnessDefinition[] {
  // Invalid references stay visible in member issues/source, never as derived context authority.
  const valid=(paths:string[])=>paths.flatMap(path=>{try{return [nodeReference(path)];}catch{return [];}});
  const scope={working:valid(member.value.harness.designScope.working),dependencies:valid(member.value.harness.designScope.dependencies)};
  const definitions = purposeHarnesses(member, implementation, scope), writable = definitions.some(d => d.resources.length);
  return definitions.map(d => ({ ...d, tools: d.tools.filter(name => writable || !['write', 'edit'].includes(name)) }));
}
