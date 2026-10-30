import { mkdir, readFile, writeFile, access, readdir, stat } from 'node:fs/promises';
import type { DesignService, ResolvedDesign } from '../workspace/design.js';
import type { DesignScope } from './data/assignment.js';
import type { StoredMember } from './data/members.js';
import type { WorkspaceService } from '../workspace/workspace.js';
import { AppError } from '../agent/data/model.js';
import { OperationQueue, committedFiles, currentFiles, filesRevision, fileChanges } from '../workspace/workspace-git.js';
import {currentMemberFormat} from './data/member-config-migration.js';
import { migratedBaseline, projectNode, workspaceContext } from '../workspace/project-context.js';
import { workspacePrompt } from '../workspace/workspace-prompts.js';

export interface ResolvedAssignment {
  working: ResolvedDesign[]; dependencies: ResolvedDesign[];
}
/** Resolve design guidance and implementation mappings, never tool authority. */
export async function resolveAssignment(designs: DesignService, workspaceId: string, config: DesignScope): Promise<ResolvedAssignment> {
  const working = await designs.working(workspaceId, config.working);
  const dependencies = await Promise.all(config.dependencies.map(path => designs.read(workspaceId, path)));
  return {working, dependencies};
}

/** Team-owned project/configuration reads and review; no tool execution or permission policy. */
export class MemberWorkspace {
  private readonly operations = new OperationQueue();
  constructor(private readonly workspaces: WorkspaceService, readonly designs: DesignService, private readonly member: (id: string) => Promise<StoredMember | null>) {}
  private async active(id: string) {
    const member = await this.member(id);
    if (!member || member.value.retiredAt !== null) throw new AppError('not_found', 'This agent is not an active team member', 404);
    return member;
  }
  async root(id: string): Promise<string> { return (await this.workspaces.record((await this.active(id)).workspaceId)).directory; }
  async operation<T>(id: string, action: () => Promise<T>): Promise<T> { const member = await this.member(id); return this.operations.run(member?.workspaceId ?? id, action); }
  /** Ordinary filesystem convenience for configuration callers; tool execution uses native operations directly. */
  async files(id: string) {
    const root = await this.root(id);
    return {root, read: {access: async (path: string) => {await access(path);}, readFile},
      write: {mkdir: async (path: string) => {await mkdir(path, {recursive: true});}, writeFile: async (path: string, content: string) => {await writeFile(path, content, 'utf8');}},
      ls: {exists: async (path: string) => {try {await access(path); return true;} catch {return false;}}, stat, readdir}};
  }
  async controlFiles(id: string, origin: 'pending' | 'committed', prefix: string) {
    const member = await this.active(id), root = await this.root(id);
    if (prefix === '.rsi/context/design') { const layout = await workspaceContext(root); if (layout.kind === 'project') prefix = layout.root; }
    if (origin === 'pending') { const files = await currentFiles(root, prefix); return {files, revision: filesRevision(files)}; }
    const baseline = await this.workspaces.gitBaseline(member.workspaceId);
    const layout = await workspaceContext(root);
    const result = await committedFiles(root, prefix, prefix === '.rsi/members' ? baseline.members : await migratedBaseline(root,layout,baseline.design));
    return prefix === '.rsi/members' ? {...result, files: currentMemberFormat(result.files, member.value.configuration)} : result;
  }
  async changes(id: string) {
    const review = async (prefix: '.rsi/members' | '.rsi/context/design') => {
      const [before, after] = await Promise.all([this.controlFiles(id, 'committed', prefix), this.controlFiles(id, 'pending', prefix)]);
      return {base: before.revision, revision: after.revision, changes: await fileChanges(before.files, after.files)};
    };
    const [design, members] = await Promise.all([review('.rsi/context/design'), review('.rsi/members')]);
    return {design, members};
  }
  async guidance(id: string): Promise<string> {
    const member = await this.active(id), resolved = await resolveAssignment(this.designs, member.workspaceId, member.value.designScope);
    const layout = await workspaceContext(await this.root(id));
    if (layout.kind === 'project') {
      const manager = await this.workspaces.contextManager(member.workspaceId), snapshot = manager.snapshot()!;
      const sections = ['## Design assignments (work guidance, not access restrictions)',workspacePrompt('context-maintenance',{root:layout.root}),'## Working designs'];
      let bytes = 0;
      const append = (path:string,content:string) => {
        bytes += Buffer.byteLength(content);
        sections.push(`### ${path}\n${bytes <= 64*1024 ? content : 'Content not loaded into instructions; read this file with your tools.'}`);
      };
      for (const part of resolved.working) append(`${layout.root}/${part.path}`,part.content);
      sections.push('## Dependency consumer context');
      for (const part of resolved.dependencies) {
        const system = manager.design(projectNode(part.path),snapshot);
        if (system.metadata.summary) sections.push(system.metadata.summary);
        if (!system.documents.readme) {append(`${layout.root}/${part.path}`,part.content);continue;}
        const context = await manager.loadConsumerContext(system.projectPath,snapshot);
        append(context.readme.path,context.readme.content);
        for (const file of context.files) append(file.path,file.content);
      }
      return sections.join('\n\n');
    }
    const view = (parts: ResolvedDesign[]) => {
      let bytes = 0;
      return parts.map(part => {
        const heading = `### ${layout.root}/${layout.kind === 'legacy' ? 'design/' : ''}${part.path} (revision ${part.revision})\nImplementation: ${part.implementation.join(', ') || '(none)'}`;
        bytes += Buffer.byteLength(part.content);
        return heading + (bytes <= 64 * 1024 ? '\n' + part.content : '\nContent not loaded; read this design file with your tools.');
      }).join('\n\n') || '(none configured)';
    };
    return ['## Design assignments (work guidance, not access restrictions)', '## Accepted working designs', view(resolved.working), '## Dependency designs', view(resolved.dependencies)].join('\n\n');
  }
}
