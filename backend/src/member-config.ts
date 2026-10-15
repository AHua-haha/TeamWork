import { dirname, join } from 'node:path';
import { keys, obj } from './config.js';
import { emptyHarness } from './harness-config.js';
import { resolveHarness, type HarnessService } from './harness.js';
import { HarnessQueue } from './harness-history.js';
import { sourceBundle, type MemberConfigSource } from './member-config-format.js';
import { projectPath } from './project-files.js';
import { memberFields, type TeamService, type StoredMember } from './team.js';
import { AppError, identity } from './types.js';

const prefix = '.team/members/';
function manifestPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith(prefix) || !/^\.team\/members\/[^/]+\/member\.json$/.test(value)) throw new AppError('invalid_config', 'Use .team/members/<bundle>/member.json');
  projectPath(value);
  return value;
}
function parse(text: string): Record<string, unknown> {
  try { return obj(JSON.parse(text), 'Member manifest'); }
  catch { throw new AppError('invalid_config', 'Member manifest must be a JSON object'); }
}

/** File submission is the only agent configuration operation. No draft is an active setting. */
export class MemberConfigService {
  private readonly submissions = new HarnessQueue();
  constructor(private readonly team: TeamService, private readonly harness: HarnessService, private readonly running: (id: string) => boolean) {}

  async accepted(workspaceId: string, memberId: string): Promise<MemberConfigSource> {
    await this.team.get(workspaceId, memberId);
    const source = (await this.team.find(memberId))!.value.configuration;
    if (!source) throw new AppError('config_unavailable', 'Member source bundle has not been initialized', 409);
    return source;
  }
  private async lead(id: string): Promise<StoredMember> {
    const member = await this.team.find(id);
    if (!member?.value.lead || member.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead submits member configuration', 403);
    return member;
  }
  /** Rebuild missing editable copies; never replace a draft, including an invalid one. */
  async materialize(agentId: string): Promise<void> {
    const lead = await this.lead(agentId);
    await this.harness.operation(agentId, async () => {
      const files = await this.harness.files(agentId);
      for (const member of await this.team.active(lead.workspaceId)) {
        const source = member.value.configuration;
        if (!source) continue;
        const folder = dirname(source.path);
        for (const [path, bytes] of Object.entries(source.files)) {
          const absolute = join(files.root, folder, path);
          if (await files.ls.exists(absolute)) continue;
          let content = bytes;
          if (path === 'member.json') content = JSON.stringify({ ...parse(bytes), memberId: member.id, revision: member.revision }, null, 2) + '\n';
          await files.write.mkdir(dirname(absolute));
          await files.write.writeFile(absolute, content);
        }
      }
    });
  }
  async submit(agentId: string, input: unknown) {
    const lead = await this.lead(agentId);
    return this.submissions.run(lead.workspaceId, () => this.harness.operation(agentId, async () => {
      await this.lead(agentId); // Recheck accepted authority, never trust the draft's role.
      const path = manifestPath(input);
      const files = await this.harness.files(agentId);
      const read = async (relative: string) => Buffer.from(await files.read.readFile(join(files.root, relative))).toString('utf8');
      const text = await read(path), manifest = parse(text);
      keys(manifest, ['version', 'memberId', 'revision', 'name', 'role', 'responsibility', 'settings', 'promptFiles', 'harnesses']);
      if (manifest.version !== 1) throw new AppError('invalid_config', 'Member manifest version must be 1');
      const creating = manifest.memberId === null && manifest.revision === null;
      let current: StoredMember | null = null;
      if (!creating) {
        identity(manifest.memberId, 'memberId');
        if (!Number.isSafeInteger(manifest.revision) || (manifest.revision as number) < 0) throw new AppError('invalid_config', 'Give the current member revision');
        current = await this.team.find(manifest.memberId);
        if (!current || current.workspaceId !== lead.workspaceId || current.value.retiredAt !== null) throw new AppError('not_found', 'Member does not belong to this active team', 404);
        if (current.revision !== manifest.revision) throw new AppError('config_conflict', 'Member revision changed; reconcile the draft with the accepted bundle', 409);
        if (this.running(current.id)) throw new AppError('member_busy', 'Wait for the target member to finish before submitting configuration', 409);
        if (current.value.lead && (manifest.name !== current.value.name || manifest.role !== current.value.role || manifest.responsibility !== current.value.responsibility)) throw new AppError('access_denied', 'The lead cannot change its own identity through submission', 403);
      }
      for (const member of await this.team.active(lead.workspaceId)) {
        if (member.id !== current?.id && member.value.configuration?.path.toLowerCase() === path.toLowerCase()) throw new AppError('config_conflict', 'This bundle already belongs to another member', 409);
      }
      const bases = obj(manifest.harnesses, 'Purpose harnesses');
      keys(bases, ['design', 'implementation']);
      const settings = obj(manifest.settings, 'Member settings');
      keys(settings, ['connectionId', 'modelId', 'modelOptions', 'promptOptionIds', 'toolOptionIds']);
      if (!Array.isArray(manifest.promptFiles) || manifest.promptFiles.length > 10 || manifest.promptFiles.some(p => typeof p !== 'string' || !/^prompts\/(?:[^/]+\/)*[^/]+\.md$/.test(p))) throw new AppError('invalid_config', 'promptFiles lists at most 10 bundle-relative prompts/*.md files');
      const promptPaths = manifest.promptFiles as string[];
      if (new Set(promptPaths.map(p => p.toLowerCase())).size !== promptPaths.length) throw new AppError('invalid_config', 'Duplicate prompt files');
      const bundleFiles: Record<string, string> = { 'member.json': text };
      const prompts: string[] = [];
      for (const promptPath of promptPaths) {
        projectPath(promptPath); // Refuse traversal, absolute paths and unsafe names.
        const content = await read(`${dirname(path)}/${promptPath}`);
        bundleFiles[promptPath] = content;
        prompts.push(content);
      }
      if (Object.values(bundleFiles).reduce((n, s) => n + Buffer.byteLength(s), 0) > 256 * 1024) throw new AppError('invalid_config', 'Member bundle exceeds 256 KiB');
      const fields = memberFields({
        name: manifest.name, role: manifest.role, responsibility: manifest.responsibility,
        settings: { ...(current?.value.settings ?? lead.value.settings), ...settings, prompt: prompts.join('\n\n') },
        harness: { ...emptyHarness(), designScope: bases.design, implementationScope: bases.implementation, allowedCommands: (current ?? lead).value.harness.allowedCommands },
      });
      if (fields.settings.toolOptionIds.length) throw new AppError('invalid_config', 'Tools are fixed by the harness bases');
      if (current?.value.lead && JSON.stringify(fields.settings) !== JSON.stringify(current.value.settings)) throw new AppError('access_denied', 'Only the user changes the lead model and instructions', 403);
      await this.team.validateSubmittedSettings(fields.settings);
      await resolveHarness(this.harness.designs, lead.workspaceId, fields.harness);
      // All referenced bytes were captured under the same file-operation lock. The DB write
      // atomically stores that exact bundle and its validated projection, guarded by revision.
      const source = sourceBundle(path, bundleFiles, agentId);
      const update = async () => this.team.update(lead.workspaceId, current!.id, manifest.revision as number, fields, source);
      const member = current
        ? await (current.id === agentId ? update() : this.harness.operation(current.id, update))
        : await this.team.create(lead.workspaceId, fields, source);
      return { member, source: { path, digest: source.digest }, nextRevision: member.revision };
    }));
  }
}
