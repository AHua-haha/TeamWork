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
      prompt: 'Maintain the project design and member configuration using common file tools. Working design files are editable pending changes; dependency designs are read-only. Only the lead may access .team/members. Keep design decisions, scope mappings and member responsibilities clear. Member JSON contains name, role, responsibility, settings, promptFiles and designScope only; JSON format versions, member identity associations and optimistic revisions are backend-owned. Markdown prompts supplement fixed rules. Design and member-config semantic commits require user review of exact bytes/base. File acceptance does not activate member settings; configuration change/activation handling is deferred. Use bash with metadata.git.scope set to design or member-config for ordinary Git status, diff, add, log, show, restore and commit commands. Never retarget Git metadata or claim user approval.',
      tools: [...files, 'bash', ...(member.value.lead ? ['list_models'] : [])],
      parts: [
        ...(designPaths.length ? [{ id: 'design', paths: designPaths, exclude: config.designScope.dependencies.map(path => `.context/${path}`), commit: 'user' as const, prompt: 'Preserve design knowledge independently of member identity. Explain pending changes and request user review; checkpoints do not accept design.' }] : []),
        ...(member.value.lead ? [{ id: 'member-config', paths: ['.team/members'], exclude: [], commit: 'user' as const, prompt: 'Maintain member JSON and referenced Markdown as pending files. User acceptance commits these files only. Member activation and retirement through file changes are deferred.' }] : []),
      ],
    },
    {
      id: 'implementation',
      prompt: 'Implement the accepted working designs. File authority is derived from their accepted implementation mappings. Dependency mappings are read-only and win overlaps. Pending design edits never expand authority. Use bash with metadata.git.scope=implementation for scoped Git commands; stage coherent changes and git commit with meaningful intent. Implementation commits are agent-authorized. Maintain useful implementation knowledge in files or final reports. Automatic checkpoints preserve work without changing your staging.',
      tools: [...files, 'bash'],
      parts: implementation.paths.length ? [{ id: 'implementation', paths: implementation.paths, exclude: ['.context', '.team', ...implementation.usePaths], commit: 'agent', prompt: 'Keep implementation history independent of protected management files.' }] : [],
    },
    {
      id: 'execute',
      prompt: `General Bash execution requires an existing command allowance. It runs with OS-enforced read/write scope, no network access, and protected management/Git metadata. Scoped Git always requires metadata.git.scope and is mediated by the harness, including calls inside scripts. No user approval can be supplied through metadata. Existing command allowances: ${JSON.stringify(config.allowedCommands)}. Richer execution configuration is deferred.`,
      tools: config.allowedCommands.length ? ['bash'] : [], parts: [],
    },
  ];
}
export function inspectHarnesses(member: StoredMember, implementation: ImplementationScope): HarnessDefinition[] {
  const definitions = purposeHarnesses(member, implementation), writable = definitions.some(d => d.parts.length);
  return definitions.map(d => ({ ...d, tools: d.tools.filter(name => writable || !['write', 'edit'].includes(name)) }));
}
