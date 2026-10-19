import { sha256 } from './text.js';
import { contextRoot, designRoot, implementationContextPath, contextPaths, nodeReference } from './workspace-layout.js';
import { harnessPrompt } from './harness-prompts.js';
import type { HarnessDefinition, HarnessPart } from './harness-history.js';
import type { StoredMember } from './team.js';

export interface ImplementationScope { paths: string[]; usePaths: string[] }
const reads = ['ls', 'read', 'grep', 'find'];
const files = [...reads, 'write', 'edit'];
/** One system context scope covers both document forms and survives representation changes. */
export function implementationContextPart(design: string): HarnessPart {
  const path = `${contextRoot}/${implementationContextPath(design)}`;
  return { id: `impl-context-${sha256(design.toLowerCase()).slice(0, 16)}`, paths: contextPaths(design,'impl').map(p=>`${contextRoot}/${p}`), exclude: [], context: 'impl', commit: 'agent', prompt: harnessPrompt('implementation-context', { design, context: path }) };
}
/** Fixed purpose policy; an assignment supplies design references, never permissions or tool definitions. */
export function purposeHarnesses(member: StoredMember, implementation: ImplementationScope = { paths: [], usePaths: [] }, scope = member.value.harness.designScope): HarnessDefinition[] {
  const designPaths = member.value.lead ? [designRoot] : [];
  return [
    {
      id: 'management',
      prompt: harnessPrompt('management'),
      tools: member.value.lead ? [...files, 'bash', 'list_models', 'validate_member_config'] : reads,
      parts: [
        ...(designPaths.length ? [{ id: 'design', paths: designPaths, exclude: [], context: 'design' as const, commit: 'user' as const, prompt: harnessPrompt('management-design') }] : []),
        ...(member.value.lead ? [{ id: 'member-config', paths: ['.rsi/members'], exclude: [], commit: 'user' as const, prompt: harnessPrompt('management-members') }] : []),
      ],
    },
    {
      id: 'implementation',
      prompt: harnessPrompt('implementation'),
      tools: [...files, 'bash'],
      parts: [
        ...(implementation.paths.length ? [{ id: 'implementation', paths: implementation.paths, exclude: ['.rsi', ...implementation.usePaths], commit: 'agent' as const, prompt: harnessPrompt('implementation-scope') }] : []),
        ...scope.working.map(implementationContextPart),
      ],
    },
    {
      id: 'execute',
      prompt: harnessPrompt('execute'),
      tools: ['bash', 'web_search', 'web_fetch'], parts: [],
    },
  ];
}
export function inspectHarnesses(member: StoredMember, implementation: ImplementationScope): HarnessDefinition[] {
  // Invalid references stay visible in member issues/source, never as derived context authority.
  const valid=(paths:string[])=>paths.flatMap(path=>{try{return [nodeReference(path)];}catch{return [];}});
  const scope={working:valid(member.value.harness.designScope.working),dependencies:valid(member.value.harness.designScope.dependencies)};
  const definitions = purposeHarnesses(member, implementation, scope), writable = definitions.some(d => d.parts.length);
  return definitions.map(d => ({ ...d, tools: d.tools.filter(name => writable || !['write', 'edit'].includes(name)) }));
}
