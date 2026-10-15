import type { HarnessDefinition } from './harness-history.js';
import type { StoredMember } from './team.js';

const fileTools = ['ls', 'read', 'write', 'edit', 'commit_scope', 'scope_history', 'restore_scope'];
/** Fixed policies. Assignment files cannot replace these tools, prompts or commit permissions. */
export function purposeHarnesses(member: StoredMember): HarnessDefinition[] {
  const config = member.value.harness;
  const designPaths = member.value.lead ? ['.context/user'] : config.designScope.working.map(path => `.context/${path}`);
  return [
    {
      id: 'project',
      prompt: 'Manage design and implement the accepted design through this project harness. Use common file tools to edit pending design JSON (content and implementation). Discuss unresolved choices with the user. Design commits require explicit user approval; a checkpoint is not acceptance. Implement within explicitly assigned implementation paths. Use paths are read-only. Design mappings do not grant file access. Use commit_scope with a meaningful intent when a coherent implementation change is ready; implementation commits need no user approval.',
      tools: [...fileTools, 'final_response', ...(member.value.lead ? ['submit_member_config', 'retire_member', 'list_models'] : [])],
      parts: [
        ...(designPaths.length ? [{ id: 'design', paths: designPaths, exclude: config.designScope.dependencies.map(path => `.context/${path}`), commit: 'user' as const, prompt: 'Keep design and subdesign knowledge continuous across team changes. Explain pending changes in your final reply; ask the user to review and accept the exact revision.' }] : []),
        ...(member.value.lead ? [{ id: 'member-config', paths: ['.team/members'], exclude: [], commit: 'agent' as const, prompt: 'Edit JSON manifests and Markdown prompt files, then submit_member_config with the manifest path. Checkpoints and commits of draft configuration do not activate it. Base policy and command allowances cannot be changed through these files.' }] : []),
        ...(config.implementationScope.paths.length ? [{ id: 'implementation', paths: [...new Set(config.implementationScope.paths)], exclude: ['.context', '.team', ...config.implementationScope.usePaths], commit: 'agent' as const, prompt: 'Maintain useful implementation notes in your final report. Automatic run-end checkpoints preserve state and do not replace semantic commits.' }] : []),
      ],
    },
    {
      id: 'command',
      prompt: `Run only commands allowed by this command harness, using exact argv or exact executable matching without implicit shell interpretation. File scope and allowed commands are separate. Command effects are not filesystem-confined by file-tool scope in this prototype. Keep commands within the assignment. Richer command-boundary rules and agent configuration are deferred.\nAllowed commands: ${JSON.stringify(member.value.harness.allowedCommands)}`,
      tools: member.value.harness.allowedCommands.length ? ['run_command'] : [],
      parts: [],
    },
  ];
}

/** Inspection uses accepted configuration only and never opens a working tree. */
export function inspectHarnesses(member: StoredMember): HarnessDefinition[] {
  const definitions = purposeHarnesses(member), writable = definitions.some(d => d.parts.length);
  return definitions.map(d => ({ ...d, tools: d.tools.filter(name => writable || !['write', 'edit'].includes(name)) }));
}
