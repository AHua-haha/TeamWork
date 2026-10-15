import { purposeHarnesses } from './harness-bases.js';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { DesignService, designPart, type ResolvedDesign } from './design.js';
import { commandAllowed, commandArgv, type HarnessConfig } from './harness-config.js';
import { executeCommand, type CommandResult } from './harness-command.js';
import { harnessCommandTool, harnessFileTools, harnessHistoryTools } from './harness-tools.js';
import { HarnessHistory, HarnessQueue, harnessStorage, partOwns, validateParts, type HarnessDefinition, type HarnessPart, type HistoryActor } from './harness-history.js';
import { ProjectFiles } from './project-files.js';
import { MemberFiles, type FileAccess } from './member-files.js';
import type { RuntimeTool } from './runtime.js';
import type { StoredMember } from './team.js';
import { AppError } from './types.js';
import type { WorkspaceService } from './workspace.js';
import { missing } from './text.js';

export const viewBudget = 64 * 1024;
export interface ResolvedHarness { working: ResolvedDesign[]; dependencies: ResolvedDesign[]; readable: string[]; writable: string[]; readonly: string[] }
const covers = (scope: string, path: string) => scope === '.' || path.toLowerCase() === scope.toLowerCase() || path.toLowerCase().startsWith(scope.toLowerCase() + '/');
const ancestor = (path: string, scope: string) => !path || scope === '.' || scope.toLowerCase().startsWith(path.toLowerCase() + '/');

export async function resolveHarness(designs: DesignService, workspaceId: string, config: HarnessConfig): Promise<ResolvedHarness> {
  const working = await Promise.all(config.designScope.working.map(path => designs.read(workspaceId, path)));
  const dependencies = await Promise.all(config.designScope.dependencies.map(path => designs.read(workspaceId, path)));
  return { working, dependencies, readable: [...config.implementationScope.paths, ...config.implementationScope.usePaths], writable: config.implementationScope.paths, readonly: config.implementationScope.usePaths };
}

/** Purpose assignments define authority; read-only use paths take precedence over writes. */
export function harnessAccess(member: StoredMember, resolved: ResolvedHarness): FileAccess {
  const designFiles = [...resolved.working, ...resolved.dependencies].map(part => `.context/${part.path}`);
  return { deny(path, mode) {
    const key = path.toLowerCase();
    if (key === '.team' || key.startsWith('.team/')) return member.value.lead ? null : 'Member configuration is outside your scope';
    if (key === '.context' || key.startsWith('.context/')) {
      if (mode === 'write' || mode === 'mkdir') {
        const working = resolved.working.map(part => `.context/${part.path}`);
        if (resolved.dependencies.some(p => key === `.context/${p.path}`.toLowerCase())) return 'Dependency design is read-only';
        return member.value.lead && (key === '.context/user' || key.startsWith('.context/user/')) || working.some(file => key === file.toLowerCase() || (mode === 'mkdir' && ancestor(path, file))) ? null : 'Dependency design and agent context are read-only';
      }
      if (member.value.lead || designFiles.some(file => key === file.toLowerCase() || (mode === 'see' && ancestor(path, file)))) return null;
      return 'This context is outside your design scope';
    }
    if (!path && mode === 'see') return null;
    if (mode === 'write' || mode === 'mkdir') {
      if (resolved.readonly.some(scope => covers(scope, path))) return 'Dependency implementation is read-only';
      return resolved.writable.some(scope => covers(scope, path) || (mode === 'mkdir' && ancestor(path, scope))) ? null : 'This implementation is outside your configured implementation scope';
    }
    if (member.value.lead || resolved.readable.some(scope => covers(scope, path) || (mode === 'see' && ancestor(path, scope)))) return null;
    return 'This implementation is outside your design scope';
  } };
}

export interface HarnessEnvironment {
  root: string;
  history: HarnessHistory;
  definitions: HarnessDefinition[];
  parts: HarnessPart[];
}
export interface HarnessOptions {
  storage?: (workspaceDirectory: string) => string;
}

/** Member integration: purpose bundles, scoped history and current authority, independent of the model loop. */
export class HarnessService {
  private readonly histories = new Map<string, Promise<HarnessHistory>>();
  private readonly operations = new HarnessQueue();
  constructor(private readonly workspaces: WorkspaceService, readonly designs: DesignService, private readonly member: (id: string) => Promise<StoredMember | null>, private readonly options: HarnessOptions = {}) {}
  private async active(id: string): Promise<StoredMember> {
    const member = await this.member(id);
    if (!member || member.value.retiredAt !== null) throw new AppError('not_found', 'This agent is not an active team member', 404);
    return member;
  }
  /** Startup conversion is separate from the runtime's fixed-base assignment flow. */
  async migrateLegacy(member: StoredMember, config: HarnessConfig): Promise<void> {
    const source = (await this.workspaces.record(member.workspaceId)).directory;
    const storage = (this.options.storage ?? harnessStorage)(source);
    try { await lstat(join(storage, 'repository.git', 'HEAD')); }
    catch (error) { if (missing(error)) return; throw error; }
    const history = new HarnessHistory(storage, source);
    await history.open();
    const root = await history.worktree(member.id);
    if (config.implementationScope.paths.length) {
      const previous: HarnessPart = { id: 'implementation', paths: [...new Set(config.implementationScope.paths)], exclude: ['.context', ...config.implementationScope.usePaths], commit: 'agent', prompt: '' };
      await history.migrateExclusions(member.id, previous, { ...previous, exclude: ['.context', '.team', ...config.implementationScope.usePaths] }, root);
    }
    if (member.value.lead && config.designScope.dependencies.length) {
      const previous: HarnessPart = { id: 'design', paths: ['.context/user'], exclude: [], commit: 'user', prompt: '' };
      await history.migrateExclusions(member.id, previous, { ...previous, exclude: config.designScope.dependencies.map(path => `.context/${path}`) }, root);
    }
  }
  async environment(id: string): Promise<HarnessEnvironment> {
    const member = await this.active(id);
    return this.openEnvironment(member);
  }
  private async openEnvironment(member: StoredMember): Promise<HarnessEnvironment> {
    const id = member.id;
    const resolved = await resolveHarness(this.designs, member.workspaceId, member.value.harness);
    const source = (await this.workspaces.record(member.workspaceId)).directory;
    try { if (!(await lstat(source)).isDirectory()) throw new Error('not a directory'); }
    catch { throw new AppError('workspace_unavailable', 'The original workspace directory is missing or unreadable', 503); }
    let opening = this.histories.get(member.workspaceId);
    if (!opening) {
      const history = new HarnessHistory((this.options.storage ?? harnessStorage)(source), source);
      opening = history.open().then(() => history);
      this.histories.set(member.workspaceId, opening);
      void opening.catch(() => { if (this.histories.get(member.workspaceId) === opening) this.histories.delete(member.workspaceId); });
    }
    const history = await opening;
    const root = await history.worktree(id);
    const definitions = purposeHarnesses(member, resolved);
    const parts = definitions.flatMap(d => d.parts);
    validateParts(parts);
    for (const part of parts) await history.ensure(id, part, root);
    // A dependency is an independent read-only view. Hydrate it once when first assigned,
    // without granting its paths to a writable part or refreshing another agent's edits.
    const dependencies: HarnessPart[] = [
      ...resolved.dependencies.map(p => ({ id: `dep-${p.revision.slice(0, 32)}`, paths: [`.context/${p.path}`], exclude: [], commit: 'user' as const, prompt: '' })),
      ...(resolved.readonly.length ? [{ id: 'dependency-implementation', paths: [...new Set(resolved.readonly)], exclude: ['.context', '.team'], commit: 'user' as const, prompt: '' }] : []),
    ];
    for (const part of dependencies) await history.ensure(id, part, root);
    return { root, history, definitions, parts };
  }
  /** Serializes tools and user review/restore against the same member's working files. */
  operation<T>(id: string, action: () => Promise<T>): Promise<T> { return this.operations.run(id, action); }
  async files(id: string): Promise<MemberFiles> {
    const member = await this.active(id);
    const resolved = await resolveHarness(this.designs, member.workspaceId, member.value.harness);
    const env = await this.environment(id);
    const base = harnessAccess(member, resolved);
    return new MemberFiles(env.root, { deny(path, mode) {
      const denial = base.deny(path, mode);
      if (denial !== null) return denial;
      if (mode === 'write' || mode === 'mkdir') {
        const isPart = env.parts.some(part => partOwns(part, path) || (mode === 'mkdir' && part.paths.some(p => ancestor(path, p))));
        if (!isPart) return 'This path is outside your writable harness parts';
      }
      return null;
    } });
  }
  async command(id: string, input: unknown, signal: AbortSignal): Promise<CommandResult> {
    const member = await this.active(id);
    const argv = commandArgv(input);
    if (!commandAllowed(member.value.harness.allowedCommands, argv)) throw new AppError('command_denied', 'This whole command or executable is not allowed by your harness', 403);
    const directory = (await this.environment(id)).root;
    if (!(await lstat(directory)).isDirectory()) throw new AppError('workspace_unavailable', 'The workspace is not a real directory', 503);
    return executeCommand(directory, argv, signal);
  }
  private part(env: HarnessEnvironment, id: string): HarnessPart {
    const part = env.parts.find(p => p.id === id);
    if (!part) throw new AppError('not_found', 'No writable harness part with that ID', 404);
    return part;
  }
  async inspect(id: string) {
    return this.operation(id, async () => {
      const env = await this.environment(id);
      const parts = [];
      for (const part of env.parts) parts.push(await env.history.diff(id, part, env.root));
      return { memberId: id, directory: env.root, parts };
    });
  }
  async commit(id: string, partId: string, message: string, actor: HistoryActor, revision?: string, base?: string) {
    return this.operation(id, async () => {
      const env = await this.environment(id);
      const part = this.part(env, partId);
      if (actor.memberId !== id || (actor.type !== 'agent' && actor.type !== 'user')) throw new AppError('access_denied', 'Invalid commit actor', 403);
      if (part.commit === 'user' && actor.type !== 'user') throw new AppError('approval_required', 'Design commit requires user approval; leave it pending for review', 403);
      if (actor.type === 'user' && (!revision || !base)) throw new AppError('invalid_input', 'User acceptance names the exact reviewed revision and committed base');
      const checkpoint = revision ?? (await env.history.checkpoint(id, part, env.root, actor, 'Commit snapshot')).revision;
      const state = await env.history.ensure(id, part, env.root);
      if (partId === 'design') {
        // Validate structured design files at acceptance, while allowing intermediate raw file edits.
        const files = new MemberFiles(env.root, { deny: () => null });
        const paths = await env.history.paths(checkpoint);
        const assigned = new Set((await this.active(id)).value.harness.designScope.working.map(path => `.context/${path}`));
        for (const path of paths.filter(path => path.endsWith('.json') || assigned.has(path))) {
          const bytes = await files.read.readFile(join(env.root, path));
          let value;
          try { value = JSON.parse(Buffer.from(bytes).toString('utf8')); }
          catch { throw new AppError('invalid_design', `${path} is not a design JSON record`); }
          designPart(value);
        }
      }
      return env.history.commit(id, part, env.root, checkpoint, base ?? state.committed, message, actor);
    });
  }
  async checkpoint(id: string, runId: string) {
    return this.operation(id, async () => {
      const member = await this.member(id);
      if (!member) return [];
      // Retirement revokes further actions, but must not discard the ending run's edits.
      const env = await this.openEnvironment(member);
      const revisions = [];
      for (const part of env.parts) revisions.push(await env.history.checkpoint(id, part, env.root, { type: 'harness', memberId: id, runId }, `End of run ${runId}`));
      return revisions;
    });
  }
  async restore(id: string, partId: string, revision: string, actor: HistoryActor) {
    return this.operation(id, async () => {
      const env = await this.environment(id);
      return env.history.restore(id, this.part(env, partId), env.root, revision, actor);
    });
  }
  async history(id: string, partId: string) {
    return this.operation(id, async () => {
      const env = await this.environment(id);
      return env.history.history(id, this.part(env, partId), env.root);
    });
  }
  async prepare(id: string, teamTools: RuntimeTool[]): Promise<{ tools: RuntimeTool[]; context: string }> {
    const member = await this.active(id);
    const resolved = await resolveHarness(this.designs, member.workspaceId, member.value.harness);
    const env = await this.operation(id, () => this.environment(id));
    const available = [...harnessFileTools(this, env.parts.length > 0), ...harnessHistoryTools(this), ...(member.value.harness.allowedCommands.length ? [harnessCommandTool(this)] : [])];
    const selected = new Set(env.definitions.flatMap(d => d.tools));
    const tools = [...available.filter(tool => selected.has(tool.definition.name)), ...teamTools];
    const parts = [
      '## Your harness',
      `Your private worktree is ${env.root}. Use paths relative to it. Other members have separate working files.`,
      ...env.definitions.map(d => `## ${d.id} harness\n${d.prompt}\n${d.parts.map(p => `Part ${p.id}: ${p.paths.join(', ')}; excludes ${p.exclude.join(', ') || '(none)'}; commit policy: ${p.commit}. ${p.prompt}`).join('\n')}`),
      'The harness automatically checkpoints each finished run. Use commit_scope for meaningful commits only. A design commit requires user approval of the exact revision. Checkpoints never imply approval. Accepted snapshots are retained in harness history; they are not automatically merged into the original workspace or other worktrees.',
      'File scope and allowed commands are separate. Command effects are not filesystem-confined by file-tool scope in this prototype. Keep commands within the assignment.',
      '## Accepted working designs', await this.acceptedDesignView(id, env, resolved.working),
      '## Dependency designs', await this.designView(resolved.dependencies),
      `## Allowed commands\n${JSON.stringify(member.value.harness.allowedCommands)}`,
      '## Implementation files', await this.implementationView(env.root, resolved.readable, member),
    ];
    return { tools, context: parts.join('\n\n') };
  }
  private async acceptedDesignView(id: string, env: HarnessEnvironment, designs: ResolvedDesign[]): Promise<string> {
    const accepted: ResolvedDesign[] = [];
    for (const design of designs) {
      const path = `.context/${design.path}`;
      const part = env.parts.find(part => partOwns(part, path));
      if (!part) { accepted.push(design); continue; }
      const state = await env.history.ensure(id, part, env.root);
      const raw = await env.history.readSnapshot(state.committed, path);
      if (raw === null) continue;
      accepted.push({ ...design, ...designPart(JSON.parse(raw)), revision: state.committed });
    }
    return this.designView(accepted);
  }
  private async designView(parts: ResolvedDesign[]): Promise<string> {
    let used = 0;
    return parts.map(part => {
      const size = Buffer.byteLength(part.content);
      const heading = `### .context/${part.path} (revision ${part.revision})\nImplementation: ${part.implementation.join(', ') || '(none)'}`;
      if (used + size > viewBudget) return heading + '\nContent not loaded; read this design file with your tools.';
      used += size;
      return heading + '\n' + part.content;
    }).join('\n\n') || '(none configured)';
  }
  private async implementationView(root: string, scopes: string[], member: StoredMember): Promise<string> {
    const files = new ProjectFiles(root);
    const candidates = new Set<string>(), notes: string[] = [];
    for (const scope of new Set(scopes)) {
      const path = scope === '.' ? '' : scope;
      const kind = await files.kind(path);
      if (kind === null) { notes.push(`Implementation not created yet: ${scope}`); continue; }
      if (kind === 'file') candidates.add(path);
      else {
        const listing = await files.tree(path, 16);
        for (const entry of listing.entries) if (entry.type === 'file') candidates.add(entry.path);
        if (listing.truncated) notes.push(`Listing truncated: ${scope}; use ls to inspect further.`);
      }
    }
    const access = harnessAccess(member, await resolveHarness(this.designs, member.workspaceId, member.value.harness));
    let used = 0;
    for (const path of [...candidates].sort()) {
      if (path.toLowerCase() === '.team' || path.toLowerCase().startsWith('.team/') || access.deny(path, 'read') !== null) continue;
      try {
        const file = await files.read(path);
        if (used + file.size > viewBudget) { notes.push(`Not loaded: ${path}`); continue; }
        used += file.size;
        notes.push(`### ${path}\n${file.content}`);
      } catch (error) {
        if (!(error instanceof AppError) || !['unsupported_file', 'not_found'].includes(error.code)) throw error;
        notes.push(`Cannot load ${path}: ${error.message}`);
      }
    }
    return notes.join('\n\n') || '(none mapped)';
  }
}
