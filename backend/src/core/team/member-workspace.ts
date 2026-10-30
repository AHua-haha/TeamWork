import { mkdir, readFile, writeFile, access, readdir, stat } from 'node:fs/promises';
import type { DesignService, ResolvedDesign } from '../workspace/design.js';
import type { DesignScope } from './data/assignment.js';
import type { StoredMember } from './data/members.js';
import type { WorkspaceService } from '../workspace/workspace.js';
import { AppError } from '../agent/data/model.js';
import {OperationQueue} from '../operation-queue.js';
import {currentFiles} from './member-files.js';

export interface ResolvedAssignment {
  working: ResolvedDesign[]; dependencies: ResolvedDesign[];
}
/** Resolve design guidance and implementation mappings, never tool authority. */
export async function resolveAssignment(designs: DesignService, workspaceId: string, config: DesignScope): Promise<ResolvedAssignment> {
  const working = await designs.working(workspaceId, config.working);
  const dependencies = await Promise.all(config.dependencies.map(path => designs.read(workspaceId, path)));
  return {working, dependencies};
}

/** Team-owned project/configuration reads; no tool execution or permission policy. */
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
  async configurationFiles(id: string) {
    return currentFiles(await this.root(id), '.rsi/members');
  }
}
