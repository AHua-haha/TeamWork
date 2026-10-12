import { lstat } from 'node:fs/promises';
import { DesignService, type ResolvedDesign } from './design.js';
import { commandAllowed, commandArgv, type HarnessConfig } from './harness-config.js';
import { executeCommand, type CommandResult } from './harness-command.js';
import { harnessCommandTool, harnessFileTools } from './harness-tools.js';
import { MemberFiles, type FileAccess } from './member-files.js';
import type { RuntimeTool } from './runtime.js';
import type { StoredMember } from './team.js';
import { AppError } from './types.js';
import type { WorkspaceService } from './workspace.js';

export const viewBudget = 64 * 1024;
export interface ResolvedHarness { working: ResolvedDesign[]; dependencies: ResolvedDesign[]; readable: string[]; writable: string[]; readonly: string[] }
const covers = (scope: string, path: string) => scope === '.' || path.toLowerCase() === scope.toLowerCase() || path.toLowerCase().startsWith(scope.toLowerCase() + '/');
const ancestor = (path: string, scope: string) => !path || scope === '.' || scope.toLowerCase().startsWith(path.toLowerCase() + '/');

export async function resolveHarness(designs: DesignService, workspaceId: string, config: HarnessConfig): Promise<ResolvedHarness> {
  const working = await Promise.all(config.designScope.working.map(path => designs.read(workspaceId, path)));
  const dependencies = await Promise.all(config.designScope.dependencies.map(path => designs.read(workspaceId, path)));
  return { working, dependencies, readable: [...working, ...dependencies].flatMap(part => part.implementation), writable: working.flatMap(part => part.implementation), readonly: dependencies.flatMap(part => part.implementation) };
}

/** File permissions follow current design references. Dependencies take precedence over working writes. */
export function harnessAccess(member: StoredMember, resolved: ResolvedHarness): FileAccess {
  const designFiles = [...resolved.working, ...resolved.dependencies].map(part => `.context/${part.path}`);
  return { deny(path, mode) {
    const key = path.toLowerCase();
    if (key === '.context' || key.startsWith('.context/')) {
      if (mode === 'write' || mode === 'mkdir') return 'Design and harness context are read-only through file tools';
      if (member.value.lead || designFiles.some(file => key === file.toLowerCase() || (mode === 'see' && ancestor(path, file)))) return null;
      return 'This context is outside your design scope';
    }
    if (!path && mode === 'see') return null;
    if (mode === 'write' || mode === 'mkdir') {
      if (resolved.readonly.some(scope => covers(scope, path))) return 'Dependency implementation is read-only';
      return resolved.writable.some(scope => covers(scope, path) || (mode === 'mkdir' && ancestor(path, scope))) ? null : 'This implementation is outside your working design';
    }
    if (member.value.lead || resolved.readable.some(scope => covers(scope, path) || (mode === 'see' && ancestor(path, scope)))) return null;
    return 'This implementation is outside your design scope';
  } };
}

/** One tool supplier and context view for every workspace member. */
export class HarnessService {
  constructor(private readonly workspaces: WorkspaceService, readonly designs: DesignService, private readonly member: (id: string) => Promise<StoredMember | null>) {}
  private async active(id: string): Promise<StoredMember> {
    const member = await this.member(id);
    if (!member || member.value.retiredAt !== null) throw new AppError('not_found', 'This agent is not an active team member', 404);
    return member;
  }
  async files(id: string): Promise<MemberFiles> {
    const member = await this.active(id);
    const resolved = await resolveHarness(this.designs, member.workspaceId, member.value.harness);
    return new MemberFiles((await this.workspaces.record(member.workspaceId)).directory, harnessAccess(member, resolved));
  }
  async command(id: string, input: unknown, signal: AbortSignal): Promise<CommandResult> {
    const member = await this.active(id);
    const argv = commandArgv(input);
    if (!commandAllowed(member.value.harness.allowedCommands, argv)) throw new AppError('command_denied', 'This whole command or executable is not allowed by your harness', 403);
    const directory = (await this.workspaces.record(member.workspaceId)).directory;
    if (!(await lstat(directory)).isDirectory()) throw new AppError('workspace_unavailable', 'The workspace is not a real directory', 503);
    return executeCommand(directory, argv, signal);
  }
  async prepare(id: string, teamTools: RuntimeTool[]): Promise<{ tools: RuntimeTool[]; context: string }> {
    const member = await this.active(id);
    const resolved = await resolveHarness(this.designs, member.workspaceId, member.value.harness);
    const tools = [
      ...harnessFileTools(this, resolved.writable.length > 0),
      ...(member.value.harness.allowedCommands.length ? [harnessCommandTool(this)] : []),
      ...teamTools,
    ];
    const parts = [
      '## Your harness',
      'Read and follow working designs; edit only their mapped implementation through file tools. Dependency designs and their implementation are read-only. Return proposed design changes to the lead.',
      'File scope and allowed commands are separate. Command effects are not filesystem-confined by the file-tool scope in this prototype; keep your work within the assignment.',
      '## Working designs',
      await this.designView(resolved.working),
      '## Dependency designs',
      await this.designView(resolved.dependencies),
      `## Allowed commands\n${JSON.stringify(member.value.harness.allowedCommands)}`,
      '## Implementation files',
      await this.implementationView(member.workspaceId, resolved.readable),
    ];
    if (member.value.lead) {
      const base = await this.workspaces.context(member.workspaceId);
      const listing = await base.tree('', 16);
      let used = 0;
      const files: string[] = [];
      for (const entry of listing.entries) if (entry.type === 'file') {
        if (used + entry.size > viewBudget) { files.push(`Not loaded: .context/${entry.path}`); continue; }
        const file = await base.read({ path: entry.path });
        used += file.size;
        files.push(`### .context/${file.path} (revision ${file.revision})\n${file.content}`);
      }
      parts.push('## Workspace context for the lead', files.join('\n\n') || 'There are no context files yet.');
      if (listing.truncated) parts.push('Context listing truncated at 2,000 entries; use ls and read to inspect further.');
      parts.push('The lead may read the entire workspace to help the user design it. Generic file tools never change user design. Use dedicated design tools for discussed design changes.');
    }
    return { tools, context: parts.join('\n\n') };
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
  private async implementationView(workspaceId: string, scopes: string[]): Promise<string> {
    const files = await this.workspaces.files(workspaceId);
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
    let used = 0;
    for (const path of [...candidates].sort()) {
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
