import type { ResolvedHarness, PermissionScope, HarnessPermissions, HarnessEnvironment } from './data/model.js';
export type { ResolvedHarness, PermissionScope, HarnessPermissions, HarnessEnvironment } from './data/model.js';
import { harnessPrompt } from './harness-prompts.js';
import { purposeHarnesses } from './data/bases.js';
import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DesignService, type ResolvedDesign } from '../workspace/design.js';
import type { HarnessConfig } from './data/config.js';
import { executeBash, parseBashInput, resetMemberShell, type CommandResult } from './harness-command.js';
import { harnessBashTool, harnessFileTools } from './harness-tools.js';
import { resourceOwns, type HarnessDefinition } from './data/resources.js';
import { OperationQueue, committedFiles, currentFiles, filesRevision, fileChanges } from '../workspace/workspace-git.js';
import { GitCommitControl } from './git-approval.js';
import { ApprovalRequests } from './data/approvals.js';
import { MemberFiles, type FileAccess } from './member-files.js';
import type { RuntimeTool } from '../agent/contracts.js';
import type { StoredMember } from '../team/data/members.js';
import { AppError } from '../agent/data/model.js';
import type { WorkspaceService } from '../workspace/workspace.js';
import { contextRoot, designRoot, implementationContextPath, contextPaths, contextLocation, designContextPaths } from '../workspace/workspace-layout.js';
import { webTools } from './web-tools.js';

export const viewBudget = 64 * 1024;
const covers = (scope: string, path: string) => scope === '.' || path.toLowerCase() === scope.toLowerCase() || path.toLowerCase().startsWith(scope.toLowerCase() + '/');
const ancestor = (path: string, scope: string) => !path || scope === '.' || scope.toLowerCase().startsWith(path.toLowerCase() + '/');

export async function resolveHarness(designs: DesignService, workspaceId: string, config: HarnessConfig): Promise<ResolvedHarness> {
  const working = await designs.working(workspaceId, config.designScope.working);
  const dependencies = await Promise.all(config.designScope.dependencies.map(path => designs.read(workspaceId, path)));
  for (const design of [...working, ...dependencies]) implementationContextPath(design.path);
  const writable = [...new Set(working.flatMap(d => d.implementation))], readonly = [...new Set(dependencies.flatMap(d => d.implementation))];
  return { working, dependencies, readable: [...new Set([...writable, ...readonly])], writable, readonly };
}

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

/** Purpose bundles, current file authority and explicit commit permission. No Git history ownership. */
export class HarnessService {
  readonly approvals = new ApprovalRequests();
  private readonly gitControl = new GitCommitControl(this.approvals);
  private readonly operations = new OperationQueue();
  private readonly shellMembers = new Map<string,string>();
  constructor(private readonly workspaces:WorkspaceService,readonly designs:DesignService,private readonly member:(id:string)=>Promise<StoredMember|null>,private readonly web:RuntimeTool[]=webTools(),readonly permissionsEnabled=true){}
  private async active(id:string){const member=await this.member(id);if(!member||member.value.retiredAt!==null)throw new AppError('not_found','This agent is not an active team member',404);return member;}
  async environment(id:string):Promise<HarnessEnvironment>{
    const member=await this.active(id),resolved=await resolveHarness(this.designs,member.workspaceId,member.value.harness);
    const root=(await this.workspaces.record(member.workspaceId)).directory;
    return {root,definitions:purposeHarnesses(member,{paths:resolved.writable,usePaths:resolved.readonly},{working:resolved.working.map(d=>d.path),dependencies:resolved.dependencies.map(d=>d.path)})};
  }
  async operation<T>(id:string,action:()=>Promise<T>):Promise<T>{const member=await this.member(id);return this.operations.run(member?.workspaceId??id,action);}
  async files(id:string):Promise<MemberFiles>{const member=await this.active(id),resolved=await resolveHarness(this.designs,member.workspaceId,member.value.harness);return new MemberFiles((await this.workspaces.record(member.workspaceId)).directory,harnessAccess(member,resolved));}
  /** Invocation authorization; Pi still performs its own default filesystem operations. */
  async fileInvocation(id: string, name: string, input: string): Promise<{ root: string; path: string }> {
    const member = await this.active(id);
    const root = await realpath((await this.workspaces.record(member.workspaceId)).directory);
    let path = input.replace(/^@/, '').replace(/[\u00a0\u2007\u202f]/g, ' ');
    if (path === '~' || path.startsWith('~/')) path = homedir() + path.slice(1);
    const absolute = resolve(root, path), local = relative(root, absolute);
    if (!this.permissionsEnabled) return { root, path: absolute };
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
      if (!env.definitions.some(d => d.resources.some(resource => resourceOwns(resource, local)))) throw new AppError('access_denied', 'Target is outside your writable harness resources', 403);
    }
    return { root, path: absolute };
  }
  async closeShells(ids=[...this.shellMembers.keys()]){await Promise.all(ids.map(async id=>{await resetMemberShell(id,this.shellMembers.get(id));this.shellMembers.delete(id);}));}
  async bash(id:string,input:unknown,signal:AbortSignal,runId?:string):Promise<CommandResult>{
    const member=await this.active(id),request=parseBashInput(input),root=(await this.workspaces.record(member.workspaceId)).directory;
    this.shellMembers.set(id,root);
    return executeBash({memberId:id,root,request,signal,permissionsEnabled:this.permissionsEnabled,git:async(args,cwd,env,onWait,brokerSignal,execute)=>{
      const catalog=await this.designs.list(member.workspaceId);
      if(catalog.truncated)throw new AppError('command_denied','Design catalog is truncated; cannot classify commit paths');
      return this.gitControl.execute({root,workspaceId:member.workspaceId,memberId:id,runId,command:request.command,args,cwd,env,implementation:[...new Set(catalog.designs.flatMap(d=>d.implementation))],signal:AbortSignal.any([signal,brokerSignal]),onWait,execute});
    }});
  }
  async controlFiles(id:string,origin:'pending'|'committed',prefix:'.rsi/members'|'.rsi/context/design'){
    const member=await this.active(id),root=(await this.workspaces.record(member.workspaceId)).directory;
    if(origin==='pending'){const files=await currentFiles(root,prefix);return {files,revision:filesRevision(files)};}
    const baseline=await this.workspaces.gitBaseline(member.workspaceId);
    return committedFiles(root,prefix,prefix==='.rsi/members'?baseline.members:baseline.design);
  }
  async changes(id:string){
    const member=await this.active(id);if(!member.value.lead)throw new AppError('access_denied','Only the lead manages design/member files',403);
    const review=async(prefix:'.rsi/members'|'.rsi/context/design')=>{const [before,after]=await Promise.all([this.controlFiles(id,'committed',prefix),this.controlFiles(id,'pending',prefix)]);return {base:before.revision,revision:after.revision,changes:await fileChanges(before.files,after.files)};};
    const [design,members]=await Promise.all([review('.rsi/context/design'),review('.rsi/members')]);return {design,members};
  }
  async prepare(id: string, teamTools: RuntimeTool[]): Promise<{ tools: RuntimeTool[]; context: string }> {
    const member = await this.active(id);
    const resolved = await resolveHarness(this.designs, member.workspaceId, member.value.harness);
    const env = await this.operation(id, () => this.environment(id));
    const available = [...harnessFileTools(this, !this.permissionsEnabled || env.definitions.some(d => d.resources.length > 0)), harnessBashTool(this), ...this.web, ...teamTools];
    const selected = new Set(env.definitions.flatMap(d => d.tools));
    const tools = available.filter(tool => !this.permissionsEnabled || selected.has(tool.definition.name));
    const parts = [
      '## Your harness',
      harnessPrompt(this.permissionsEnabled ? 'common' : 'permissions-disabled', { workspace: env.root }),
      '## Design-edit responsibility', harnessPrompt('design-responsibility'),
      `## ${this.permissionsEnabled ? 'Resolved permissions' : 'Design assignments (guidance only)'}\n${JSON.stringify(harnessPermissions(member,resolved),null,2)}`,
      ...(this.permissionsEnabled ? env.definitions : []).map(d => `## ${d.id} harness\n${d.prompt}\n${d.resources.map(p => `Resource ${p.id}: ${p.paths.join(', ')}; excludes ${p.exclude.join(', ') || '(none)'}; commit policy: ${p.commit}. ${p.prompt}`).join('\n')}`),
      '## Accepted working designs', await this.designView(resolved.working),
      '## Dependency designs', await this.designView(resolved.dependencies),
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
}
