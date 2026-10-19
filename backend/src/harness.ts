import { harnessPrompt } from './harness-prompts.js';
import { implementationContextPart, purposeHarnesses } from './harness-bases.js';
import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DesignService, resolveDesign, type ResolvedDesign } from './design.js';
import type { HarnessConfig } from './harness-config.js';
import { executeBash, parseBashInput, resetMemberShell, type CommandResult } from './harness-command.js';
import { harnessBashTool, harnessFileTools } from './harness-tools.js';
import { HarnessHistory, HarnessQueue, harnessStorage, partOwns, validateParts, type HarnessDefinition, type HarnessPart, type HistoryActor } from './harness-history.js';
import { ProjectFiles } from './project-files.js';
import { MemberFiles, type FileAccess } from './member-files.js';
import type { RuntimeTool } from './runtime.js';
import type { StoredMember } from './team.js';
import { AppError } from './types.js';
import type { WorkspaceService } from './workspace.js';
import { contextRoot, designRoot, implementationContextPath, contextPaths, contextLocation, designContextPaths } from './workspace-layout.js';
import { decodeText } from './text.js';
import { webTools } from './web-tools.js';

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

export interface PermissionScope { designContext: string[]; implementationContext: string[]; implementation: string[] }
export interface HarnessPermissions { working: PermissionScope; dependencies: PermissionScope }
/** Resolve the three resource components independently in working and dependency scope. */
export function harnessPermissions(member: StoredMember, resolved: ResolvedHarness): HarnessPermissions {
  const physical = (paths: string[]) => paths.map(path => `${contextRoot}/${path}`);
  const scope = (designs: ResolvedDesign[], implementation: string[]): PermissionScope => ({
    designContext: designs.flatMap(d => physical(designContextPaths(d.path))),
    implementationContext: designs.flatMap(d => physical(contextPaths(d.path,'impl'))),
    implementation,
  });
  const working = scope(resolved.working,resolved.writable), dependencies = scope(resolved.dependencies,resolved.readonly);
  if(member.value.lead) working.designContext = [designRoot];
  return {working,dependencies};
}

/** A working design can be read-only; dependency implementation wins overlapping source mappings. */
export function harnessAccess(member: StoredMember, resolved: ResolvedHarness): FileAccess {
  const {working,dependencies}=harnessPermissions(member,resolved);
  const designs=[...working.designContext,...dependencies.designContext];
  const contexts=[...working.implementationContext,...dependencies.implementationContext];
  const readable=[...designs,...contexts];
  return { deny(path, mode) {
    const key=path.toLowerCase(), write=mode==='write'||mode==='mkdir';
    const within=(scopes:string[])=>scopes.some(p=>covers(p,path));
    const visible=(scopes:string[])=>within(scopes)||(mode==='see'&&scopes.some(p=>ancestor(path,p)));
    const creatable=(scopes:string[])=>within(scopes)||(mode==='mkdir'&&scopes.some(p=>ancestor(path,p)));
    if(key==='.rsi'&&mode==='see')return null;
    if(key==='.rsi/members'||key.startsWith('.rsi/members/'))return member.value.lead ? null : 'Member configuration is outside your scope';
    if(key===contextRoot)return (mode==='see'||mode==='mkdir')&&readable.length ? null : 'Context root is not a file';
    if(key.startsWith(contextRoot+'/')){
      const location=contextLocation(key.slice(contextRoot.length+1));
      if(!location)return 'Not a system context path';
      if(location.area==='design'){
        if(write)return member.value.lead ? null : 'Design context is read-only; follow it and report changes to the lead';
        return visible(designs) ? null : 'This design is outside your working/dependency scope';
      }
      if(write){
        if(within(dependencies.implementationContext))return 'Dependency implementation context is read-only';
        return creatable(working.implementationContext) ? null : 'This implementation context is outside your working designs';
      }
      return visible(contexts) ? null : 'This implementation context is outside your working/dependency scope';
    }
    if(key==='.rsi'||key.startsWith('.rsi/'))return 'Private workspace state is outside your scope';
    if(!path&&mode==='see')return null;
    if(write){
      if(within(dependencies.implementation))return 'Dependency implementation is read-only';
      return creatable(working.implementation) ? null : 'This implementation is outside your configured implementation scope';
    }
    return visible([...working.implementation,...dependencies.implementation]) ? null : 'This implementation is outside your design scope';
  }};
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
  private readonly shellMembers = new Map<string, string>();
  constructor(private readonly workspaces: WorkspaceService, readonly designs: DesignService, private readonly member: (id: string) => Promise<StoredMember | null>, private readonly web: RuntimeTool[] = webTools()) {}
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
    catch { throw new AppError('workspace_unavailable', 'The shared workspace directory is missing or unreadable', 503); }
    let opening = this.histories.get(member.workspaceId);
    if (!opening) {
      const history = new HarnessHistory(harnessStorage(source), source);
      opening = history.open().then(() => history);
      this.histories.set(member.workspaceId, opening);
      void opening.catch(() => { if (this.histories.get(member.workspaceId) === opening) this.histories.delete(member.workspaceId); });
    }
    const history = await opening;
    const root = source;
    const definitions = purposeHarnesses(member, { paths: resolved.writable, usePaths: resolved.readonly }, { working: resolved.working.map(d=>d.path), dependencies: resolved.dependencies.map(d=>d.path) });
    const parts = definitions.flatMap(d => d.parts);
    validateParts(parts);
    for (const part of parts) await history.ensure(id, part, root);
    return { root, history, definitions, parts };
  }
  /** Serializes tools and user review/restore against shared workspace files. */
  async operation<T>(id: string, action: () => Promise<T>): Promise<T> {
    const member = await this.member(id);
    return this.operations.run(member?.workspaceId ?? id, action);
  }
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
  /** Invocation authorization; Pi still performs its own default filesystem operations. */
  async fileInvocation(id: string, name: string, input: string): Promise<{ root: string; path: string }> {
    const member = await this.active(id);
    const root = await realpath((await this.workspaces.record(member.workspaceId)).directory);
    let path = input.replace(/^@/, '').replace(/[\u00a0\u2007\u202f]/g, ' ');
    if (path === '~' || path.startsWith('~/')) path = homedir() + path.slice(1);
    const absolute = resolve(root, path), local = relative(root, absolute);
    if (isAbsolute(local) || local === '..' || local.startsWith('../')) throw new AppError('access_denied', 'File tool paths must be inside the workspace', 403);
    let ancestor = absolute;
    for (;;) {
      try {
        const actual = await realpath(ancestor), r = relative(root, actual);
        if (isAbsolute(r) || r === '..' || r.startsWith('../')) throw new AppError('access_denied', 'File tool path resolves outside the workspace', 403);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent;
      }
    }
    if (name === 'write' || name === 'edit') {
      let cursor = root;
      for (const segment of local.split('/').filter(Boolean)) {
        cursor = join(cursor, segment);
        try { if ((await lstat(cursor)).isSymbolicLink()) throw new AppError('access_denied', 'Write/edit targets cannot traverse symbolic links', 403); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
      }
      const resolved = await resolveHarness(this.designs, member.workspaceId, member.value.harness);
      const denial = harnessAccess(member, resolved).deny(local, 'write');
      if (denial !== null) throw new AppError('access_denied', denial, 403);
      const env = await this.environment(id);
      if (!env.parts.some(part => partOwns(part, local))) throw new AppError('access_denied', 'Target is outside your writable harness parts', 403);
    }
    return { root, path: absolute };
  }
  async closeShells(ids = [...this.shellMembers.keys()]) {
    await Promise.all(ids.map(async id => { await resetMemberShell(id, this.shellMembers.get(id)); this.shellMembers.delete(id); }));
  }
  async bash(id: string, input: unknown, signal: AbortSignal, runId?: string): Promise<CommandResult> {
    const member = await this.active(id), request = parseBashInput(input);
    const env = await this.environment(id);
    const part = request.metadata?.git ? this.part(env, request.metadata.git.scope) : null;
    this.shellMembers.set(id, env.root);
    return executeBash({ memberId: id, root: env.root, request, signal,
      git: part ? (args, cwd) => env.history.scopedGit(id, part, env.root, args, cwd, { type: 'agent', memberId: id, ...(runId ? { runId } : {}) }) : undefined });
  }
  private part(env: HarnessEnvironment, id: string): HarnessPart {
    const part = env.parts.find(p => p.id === id);
    if (!part) throw new AppError('not_found', 'No writable harness part with that ID', 404);
    return part;
  }
  async review(id: string, partId: string) {
    return this.operation(id, async () => {
      const env = await this.environment(id), part = this.part(env, partId);
      const snapshot = await env.history.checkpoint(id, part, env.root, { type: 'harness', memberId: id }, 'Review pending files');
      const state = await env.history.ensure(id, part, env.root);
      return { memberId: id, partId, revision: snapshot.revision, base: state.committed, changes: await env.history.compareSnapshots(state.committed, snapshot.revision) };
    });
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
      if (partId === 'implementation') throw new AppError('invalid_input', 'Implementation semantic commits use project Git through bash; this endpoint accepts protected/context scopes only');
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
    const available = [...harnessFileTools(this, env.parts.length > 0), harnessBashTool(this), ...this.web, ...teamTools];
    const selected = new Set(env.definitions.flatMap(d => d.tools));
    const tools = available.filter(tool => selected.has(tool.definition.name));
    const parts = [
      '## Your harness',
      harnessPrompt('common', { workspace: env.root }),
      `## Resolved permissions\n${JSON.stringify(harnessPermissions(member,resolved),null,2)}`,
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
      const heading = `### .rsi/context/design/${part.path} (revision ${part.revision})\nImplementation: ${part.implementation.join(', ') || '(none)'}`;
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
