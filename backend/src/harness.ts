import { harnessPrompt } from './harness-prompts.js';
import { implementationContextPart, purposeHarnesses } from './harness-bases.js';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { DesignService, resolveDesign, type ResolvedDesign } from './design.js';
import { commandAllowed, type HarnessConfig } from './harness-config.js';
import { executeBash, parseBashInput, type CommandResult } from './harness-command.js';
import { harnessBashTool, harnessFileTools } from './harness-tools.js';
import { HarnessHistory, HarnessQueue, harnessStorage, partOwns, validateParts, type HarnessDefinition, type HarnessPart, type HistoryActor } from './harness-history.js';
import { ProjectFiles } from './project-files.js';
import { MemberFiles, type FileAccess } from './member-files.js';
import type { RuntimeTool } from './runtime.js';
import type { StoredMember } from './team.js';
import { AppError } from './types.js';
import type { WorkspaceService } from './workspace.js';
import { contextRoot, implementationContextPath, contextPaths, contextLocation } from './workspace-layout.js';
import { decodeText } from './text.js';

export const viewBudget = 64 * 1024;
export interface ResolvedHarness { working: ResolvedDesign[]; dependencies: ResolvedDesign[]; readable: string[]; writable: string[]; readonly: string[] }
const covers = (scope: string, path: string) => scope === '.' || path.toLowerCase() === scope.toLowerCase() || path.toLowerCase().startsWith(scope.toLowerCase() + '/');
const ancestor = (path: string, scope: string) => !path || scope === '.' || scope.toLowerCase().startsWith(path.toLowerCase() + '/');

export async function resolveHarness(designs: DesignService, workspaceId: string, config: HarnessConfig): Promise<ResolvedHarness> {
  const working = await Promise.all(config.designScope.working.map(path => designs.read(workspaceId, path)));
  const dependencies = await Promise.all(config.designScope.dependencies.map(path => designs.read(workspaceId, path)));
  for (const design of [...working, ...dependencies]) implementationContextPath(design.path);
  const writable = [...new Set(working.flatMap(d => d.implementation))], readonly = [...new Set(dependencies.flatMap(d => d.implementation))];
  return { working, dependencies, readable: [...new Set([...writable, ...readonly])], writable, readonly };
}

/** Purpose assignments define authority; read-only use paths take precedence over writes. */
export function harnessAccess(member: StoredMember, resolved: ResolvedHarness): FileAccess {
  const designPaths = (designs: ResolvedDesign[]) => designs.flatMap(d => [d.path,...contextPaths(d.path,'design')].map(p=>`${contextRoot}/${p}`));
  const workingDesign=designPaths(resolved.working), dependencyDesign=designPaths(resolved.dependencies);
  const workingContext=resolved.working.flatMap(d=>contextPaths(d.path,'impl').map(p=>`${contextRoot}/${p}`));
  const dependencyContext=resolved.dependencies.flatMap(d=>contextPaths(d.path,'impl').map(p=>`${contextRoot}/${p}`));
  const readable=[...workingDesign,...dependencyDesign,...workingContext,...dependencyContext];
  return { deny(path, mode) {
    const key = path.toLowerCase(), write=mode==='write'||mode==='mkdir';
    const allowed=(scopes:string[])=>scopes.some(p=>covers(p,path)||(mode==='mkdir'&&ancestor(path,p)));
    if (key === '.rsi' && mode === 'see') return null;
    if (key === '.rsi/members' || key.startsWith('.rsi/members/')) return member.value.lead ? null : 'Member configuration is outside your scope';
    if(key===contextRoot)return (mode==='see'||mode==='mkdir')&&(member.value.lead||resolved.working.length>0||(!write&&resolved.dependencies.length>0)) ? null : 'Context root is not a file';
    if(key.startsWith(contextRoot+'/')){
      const location=contextLocation(key.slice(contextRoot.length+1));
      if(!location)return 'Not a system context path';
      if(location.kind==='node'){
        return (mode==='see'||mode==='mkdir')&&(member.value.lead||readable.some(p=>ancestor(path,p))) ? null : 'This system is outside your scope';
      }
      if(location.kind==='impl'){
        if(write&&dependencyContext.some(p=>covers(p,path)))return 'Dependency implementation context is read-only';
        return allowed(write?workingContext:[...workingContext,...dependencyContext]) ? null : 'This implementation context is outside your working/dependency systems';
      }
      if(write&&dependencyDesign.some(p=>covers(p,path)))return 'Dependency design is read-only';
      return member.value.lead||allowed(write?workingDesign:[...workingDesign,...dependencyDesign]) ? null : 'This design is outside your working/dependency systems';
    }
    if (key === '.rsi' || key.startsWith('.rsi/')) return 'Private workspace state is outside your scope';
    if (!path && mode === 'see') return null;
    if (mode === 'write' || mode === 'mkdir') {
      if (resolved.readonly.some(scope => covers(scope, path))) return 'Dependency implementation is read-only';
      return resolved.writable.some(scope => covers(scope, path) || (mode === 'mkdir' && ancestor(path, scope))) ? null : 'This implementation is outside your configured implementation scope';
    }
    if (resolved.readable.some(scope => covers(scope, path) || (mode === 'see' && ancestor(path, scope)))) return null;
    return 'This implementation is outside your design scope';
  } };
}

export interface HarnessEnvironment {
  root: string;
  history: HarnessHistory;
  definitions: HarnessDefinition[];
  parts: HarnessPart[];
}
/** Member integration: purpose bundles, scoped history and current authority, independent of the model loop. */
export class HarnessService {
  private readonly histories = new Map<string, Promise<HarnessHistory>>();
  private readonly operations = new HarnessQueue();
  constructor(private readonly workspaces: WorkspaceService, readonly designs: DesignService, private readonly member: (id: string) => Promise<StoredMember | null>) {}
  private async active(id: string): Promise<StoredMember> {
    const member = await this.member(id);
    if (!member || member.value.retiredAt !== null) throw new AppError('not_found', 'This agent is not an active team member', 404);
    return member;
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
      const history = new HarnessHistory(harnessStorage(source), source);
      opening = history.open().then(() => history);
      this.histories.set(member.workspaceId, opening);
      void opening.catch(() => { if (this.histories.get(member.workspaceId) === opening) this.histories.delete(member.workspaceId); });
    }
    const history = await opening;
    const root = await history.worktree(id);
    const definitions = purposeHarnesses(member, { paths: resolved.writable, usePaths: resolved.readonly }, { working: resolved.working.map(d=>d.path), dependencies: resolved.dependencies.map(d=>d.path) });
    const parts = definitions.flatMap(d => d.parts);
    validateParts(parts);
    for (const part of parts) await history.ensure(id, part, root);
    // A dependency is an independent read-only view. Hydrate it once when first assigned,
    // without granting its paths to a writable part or refreshing another agent's edits.
    const dependencies: HarnessPart[] = [
      ...resolved.dependencies.map(p => ({ id: `dep-${p.revision.slice(0, 32)}`, paths: [p.path,...contextPaths(p.path,'design')].map(path=>`${contextRoot}/${path}`), exclude: [], context: 'design' as const, commit: 'user' as const, prompt: '' })),
      ...(resolved.readonly.length ? [{ id: 'dependency-implementation', paths: [...new Set(resolved.readonly)], exclude: ['.rsi'], commit: 'user' as const, prompt: '' }] : []),
    ];
    for (const design of resolved.dependencies) {
      const part = implementationContextPart(design.path);
      dependencies.push({ ...part, id: `dep-${part.id}` });
    }
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
        const isPart = env.parts.some(part => partOwns(part, path) || (mode === 'mkdir' && part.paths.some(p => ancestor(path, p) || (part.context === 'design' && covers(p,path)))));
        if (!isPart) return 'This path is outside your writable harness parts';
      }
      return null;
    } });
  }
  async bash(id: string, input: unknown, signal: AbortSignal, runId?: string): Promise<CommandResult> {
    const member = await this.active(id), request = parseBashInput(input);
    const env = await this.environment(id);
    const resolved = await resolveHarness(this.designs, member.workspaceId, member.value.harness);
    const part = request.metadata?.git ? this.part(env, request.metadata.git.scope) : null;
    if (!part && !commandAllowed(member.value.harness.allowedCommands, ['bash', '-c', request.command])) throw new AppError('command_denied', 'General Bash requires an allowed ["bash", "-c", command] rule; scoped Git uses metadata.git.scope', 403);
    let designRead=[...resolved.working,...resolved.dependencies].flatMap(d=>[d.path,...contextPaths(d.path,'design')].map(p=>`${contextRoot}/${p}`));
    if(member.value.lead){
      const listing=await new ProjectFiles(join(env.root,contextRoot)).tree('',16);
      if(listing.truncated)throw new AppError('input_too_large','Context listing is too large for a safe Bash read scope',413);
      designRead=[...designRead,'.rsi/members',...listing.entries.filter(e=>e.type==='file'&&['design','metadata'].includes(contextLocation(e.path)?.kind??'')).map(e=>`${contextRoot}/${e.path}`)];
    }
    const readable=[...resolved.readable,...designRead,...[...resolved.working,...resolved.dependencies].flatMap(d=>contextPaths(d.path,'impl').map(p=>`${contextRoot}/${p}`))];
    // Management Git Bash is read-only except for operations mediated by Git.
    // General execution may write implementation only; it cannot edit management files.
    const writable = part ? [] : resolved.writable;
    return executeBash({ root: env.root, command: request.command, readable, writable, readonly: resolved.readonly, signal,
      git: part ? (args, cwd) => env.history.scopedGit(id, part, env.root, args, cwd, { type: 'agent', memberId: id, ...(runId ? { runId } : {}) }) : undefined });
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
        // Validate the immutable reviewed tree, never mutable worktree bytes.
        const paths=(await env.history.paths(checkpoint)).filter(path=>path.startsWith(contextRoot+'/'));
        const files=new Map<string,string>();
        for(const path of paths){const bytes=await env.history.readSnapshotBytes(checkpoint,path),content=bytes&&decodeText(bytes);if(content===null||content===undefined)throw new AppError('invalid_design','Design documents must be UTF-8 text');if(content!==null)files.set(path.slice(contextRoot.length+1).toLowerCase(),content);}
        const nodes=new Set<string>();
        for(const path of files.keys()){
          const location=contextLocation(path);
          if(location&&location.kind!=='node')nodes.add(location.node);
        }
        for(const node of nodes)resolveDesign(node,files);
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
    const available = [...harnessFileTools(this, env.parts.length > 0), harnessBashTool(this), ...teamTools];
    const selected = new Set(env.definitions.flatMap(d => d.tools));
    const tools = available.filter(tool => selected.has(tool.definition.name));
    const parts = [
      '## Your harness',
      harnessPrompt('common', { worktree: env.root }),
      ...env.definitions.map(d => `## ${d.id} harness\n${d.prompt}\n${d.parts.map(p => `Part ${p.id}: ${p.paths.join(', ')}; excludes ${p.exclude.join(', ') || '(none)'}; commit policy: ${p.commit}. ${p.prompt}`).join('\n')}`),
      '## Accepted working designs', await this.designView(resolved.working),
      '## Dependency designs', await this.designView(resolved.dependencies),
      '## Implementation files', await this.implementationView(env.root, resolved.readable, member),
    ];
    return { tools, context: parts.join('\n\n') };
  }
  private async designView(parts: ResolvedDesign[]): Promise<string> {
    let used = 0;
    return parts.map(part => {
      const size = Buffer.byteLength(part.content);
      const heading = `### .rsi/context/${part.path} (revision ${part.revision})\nImplementation: ${part.implementation.join(', ') || '(none)'}`;
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
      if (path.toLowerCase() === '.rsi' || path.toLowerCase().startsWith('.rsi/') || access.deny(path, 'read') !== null) continue;
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
