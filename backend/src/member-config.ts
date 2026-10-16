import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { keys, obj, validateRunSettings } from './config.js';
import { resolveHarness, type HarnessService } from './harness.js';
import { harnessConfig } from './harness-config.js';
import { sourceBundle, type MemberConfigSource } from './member-config-format.js';
import { memberFields, maxMembers, type MemberFields, type NewMember, type StoredMember, type TeamService } from './team.js';
import { modelRunSettings } from './workspace-models.js';
import { decodeText, encodeText, sha256 } from './text.js';
import { AppError, identity } from './types.js';

interface MemberChange {
  type: 'create' | 'update' | 'delete'; path: string; name: string; memberId?: string;
  before?: MemberConfigSource; after?: MemberConfigSource; fields?: MemberFields;
}
export interface MemberConfigReview {
  origin: 'pending' | 'committed'; revision: string; digest: string; valid: boolean;
  changes: MemberChange[]; issues: { path: string; code: string; message: string }[];
}
interface Plan { review: MemberConfigReview; active: StoredMember[]; modelsRevision: number }
const memberRoot = '.team/members';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const assignment = (scope: MemberFields['harness']['designScope']) => ({ working: scope.working.map(p => p.toLowerCase()).sort(), dependencies: scope.dependencies.map(p => p.toLowerCase()).sort() });
const withoutPrompt = (settings: MemberFields['settings']) => { const { prompt: _prompt, ...rest } = settings; return rest; };

/** File validation, user-committed review and activation are distinct from active settings. */
export class MemberConfigService {
  constructor(private readonly team: TeamService, private readonly harness: HarnessService) {}
  async accepted(workspaceId: string, memberId: string): Promise<MemberConfigSource> {
    await this.team.get(workspaceId, memberId);
    const source = (await this.team.find(memberId))!.value.configuration;
    if (!source) throw new AppError('config_unavailable', 'Member source bundle has not been initialized', 409);
    return source;
  }
  private async lead(workspaceId: string) {
    const lead = (await this.team.active(workspaceId)).find(member => member.value.lead);
    if (!lead) throw new AppError('lead_required', 'Workspace lead is unavailable', 409);
    return lead;
  }
  async materialize(agentId: string): Promise<void> {
    const lead = await this.team.find(agentId);
    if (!lead?.value.lead || lead.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead reads member configuration', 403);
    await this.harness.operation(agentId, async () => {
      const files = await this.harness.files(agentId), environment = await this.harness.environment(agentId);
      for (const member of await this.team.active(lead.workspaceId)) {
        const source = member.value.configuration;
        if (!source) continue;
        await environment.history.initializeMemberBundle(agentId, source.path, async () => {
          for (const [path, content] of Object.entries(source.files)) {
            const absolute = join(files.root, dirname(source.path), path);
            if (await files.ls.exists(absolute)) continue;
            await files.write.mkdir(dirname(absolute));
            await files.write.writeFile(absolute, content);
          }
        });
      }
    });
  }
  async validate(agentId: string, path: unknown): Promise<MemberConfigReview> {
    const lead = await this.team.find(agentId);
    if (!lead?.value.lead || lead.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead validates member files', 403);
    if (path !== memberRoot) throw new AppError('invalid_input', `Validate the complete ${memberRoot} change set`);
    await this.materialize(agentId);
    return this.harness.operation(agentId, async () => (await this.plan(lead.workspaceId, lead.id, 'pending')).review);
  }
  async review(workspaceId: string): Promise<MemberConfigReview> {
    const lead = await this.lead(workspaceId);
    return this.harness.operation(lead.id, async () => (await this.plan(workspaceId, lead.id, 'committed')).review);
  }
  /** Only the user HTTP control boundary calls this, inside the workspace idle gate. */
  async activate(workspaceId: string, revision: string, digest: string) {
    const lead = await this.lead(workspaceId);
    return this.harness.operation(lead.id, async () => {
      const plan = await this.plan(workspaceId, lead.id, 'committed'), review = plan.review;
      if (revision !== review.revision || digest !== review.digest) throw new AppError('stale_revision', 'Member/configuration/design review changed; review again', 409);
      if (!review.valid) throw new AppError('invalid_config', review.issues.map(i => `${i.path}: ${i.message}`).join('; '));
      const create: NewMember[] = [], update: StoredMember[] = [];
      for (const change of review.changes) {
        if (change.type === 'create') {
          const id = randomUUID(), fields = change.fields!;
          create.push({ id, workspaceId, lead: false, nameKey: fields.name.toLowerCase(), value: { workspaceId, ...fields, lead: false, createdAt: Date.now(), retiredAt: null, configuration: change.after } });
        } else {
          const current = plan.active.find(member => member.id === change.memberId)!;
          update.push({ ...current, revision: current.revision + 1, value: change.type === 'delete' ? { ...current.value, retiredAt: Date.now() } : { ...current.value, ...change.fields!, configuration: change.after } });
        }
      }
      // These bundles already exist in user-accepted history. Mark them before
      // persistence so later materialization cannot undo an intentional deletion.
      const environment = await this.harness.environment(lead.id);
      for (const change of review.changes) if (change.type !== 'delete') await environment.history.initializeMemberBundle(lead.id, change.path, async () => {});
      await this.team.activate(workspaceId, { expected: plan.active.map(m => ({ id: m.id, revision: m.revision })), modelsRevision: plan.modelsRevision, create, update });
      return { revision, changes: review.changes.map(change => ({ type: change.type, path: change.path, name: change.name })), memberIds: [...plan.active.filter(member => !update.some(next => next.id === member.id && next.value.retiredAt !== null)).map(member => member.id), ...create.map(member => member.id)] };
    });
  }
  private async plan(workspaceId: string, leadId: string, origin: 'pending' | 'committed'): Promise<Plan> {
    const all = await this.team.all(workspaceId), active = all.filter(member => member.value.retiredAt === null);
    const models = await this.team.models(workspaceId), environment = await this.harness.environment(leadId);
    const part = environment.parts.find(part => part.id === 'member-config')!;
    const state = await environment.history.ensure(leadId, part, environment.root);
    const revision = origin === 'pending' ? (await environment.history.checkpoint(leadId, part, environment.root, { type: 'harness', memberId: leadId }, 'Validate member files')).revision : state.committed;
    const paths = await environment.history.paths(revision), entries = new Map<string, string>();
    const textAt = async (path: string) => {
      if (entries.has(path)) return entries.get(path)!;
      const bytes = await environment.history.readSnapshotBytes(revision, path);
      if (bytes === null) throw new AppError('invalid_config', `Referenced file is missing: ${path}`);
      const text = decodeText(bytes);
      if (text === null) throw new AppError('invalid_config', `${path} must be UTF-8 text without NUL bytes`);
      encodeText(text); entries.set(path, text); return text;
    };
    const review: MemberConfigReview = { origin, revision, digest: '', valid: false, changes: [], issues: [] };
    const issue = (path: string, error: unknown) => {
      if (!(error instanceof AppError) || error.status >= 500) throw error;
      review.issues.push({ path, code: error.code, message: error.message });
    };
    if (origin === 'committed') {
      const selected = await environment.history.revision(revision);
      if (selected.kind !== 'commit' || selected.actor.type !== 'user') review.issues.push({ path: memberRoot, code: 'approval_required', message: 'User must commit the member-config files before activation' });
    }
    const designs = new Map<string, string>(), known = new Map(active.map(m => [m.value.configuration!.path.toLowerCase(), m]));
    const manifests = paths.filter(path => path.toLowerCase().endsWith('/member.json')), seen = new Set<string>(), resulting: MemberFields[] = [];
    for (const path of manifests) {
      try {
        const match = /^\.team\/members\/([^/]+)\/member\.json$/.exec(path);
        if (!match) throw new AppError('invalid_path', 'Member manifests belong at .team/members/<bundle>/member.json');
        identity(match[1], 'bundle');
        if (seen.has(path.toLowerCase())) throw new AppError('invalid_config', 'Duplicate member bundle ignoring case');
        seen.add(path.toLowerCase());
        const current = known.get(path.toLowerCase());
        if (!current && all.some(m => m.value.configuration?.path.toLowerCase() === path.toLowerCase())) throw new AppError('invalid_config', 'A retired bundle cannot be reused; create a new bundle');
        const raw = await textAt(path);
        let value: unknown;
        try { value = JSON.parse(raw); } catch { throw new AppError('invalid_config', 'Member manifest must be valid JSON'); }
        const data = obj(value, 'Member manifest'); keys(data, ['name', 'role', 'responsibility', 'settings', 'promptFiles', 'designScope', 'execute']);
        const settings = obj(data.settings, 'Member settings');
        if ('prompt' in settings) throw new AppError('invalid_config', 'Use referenced Markdown prompt files, not settings.prompt');
        const execute = obj(data.execute, 'Execute assignment'); keys(execute, ['allowedCommands']);
        const harness = harnessConfig({ designScope: data.designScope, allowedCommands: execute.allowedCommands });
        if (!Array.isArray(data.promptFiles) || data.promptFiles.length > 20 || data.promptFiles.some(p => typeof p !== 'string' || !/^prompts\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.md$/.test(p) || p.split('/').some((s: string) => s === '..' || s.startsWith('.')))) throw new AppError('invalid_config', 'promptFiles lists at most 20 safe bundle-relative prompts/*.md files');
        const refs = data.promptFiles as string[];
        if (new Set(refs.map(p => p.toLowerCase())).size !== refs.length) throw new AppError('invalid_config', 'Duplicate prompt reference');
        const files: Record<string, string> = { 'member.json': raw };
        for (const ref of refs) {
          files[ref] = await textAt(`${dirname(path)}/${ref}`);
        }
        const prompt = refs.map(ref => files[ref]!).join('\n\n');
        let defaults;
        if (current) defaults = current.value.settings;
        else {
          const selected = models.value.models.find(m => m.connectionId === (settings.connectionId ?? models.value.defaultModel?.connectionId) && m.modelId === (settings.modelId ?? models.value.defaultModel?.modelId));
          if (!selected) throw new AppError('invalid_config', 'Choose a model from this workspace');
          defaults = modelRunSettings(selected);
        }
        const fields = memberFields({ name: data.name, role: data.role, responsibility: data.responsibility, harness, settings: validateRunSettings({ ...defaults, ...settings, prompt }) });
        if (current) {
          if (fields.name !== current.value.name || fields.role !== current.value.role || !same(withoutPrompt(fields.settings), withoutPrompt(current.value.settings)) || !same(assignment(fields.harness.designScope), assignment(current.value.harness.designScope))) throw new AppError('forbidden_update', 'Update may change only responsibility, supplementary prompts and execution rules');
          fields.harness.designScope = current.value.harness.designScope;
        } else if (!harness.designScope.working.length && !harness.designScope.dependencies.length) throw new AppError('invalid_config', 'A new worker needs a design assignment');
        const resolved = await resolveHarness(this.harness.designs, workspaceId, fields.harness);
        for (const design of [...resolved.working, ...resolved.dependencies]) designs.set(design.path, design.revision);
        const source = { ...sourceBundle(path, files, 'user'), acceptedRevision: origin === 'committed' ? revision : undefined, ...(current?.value.configuration?.previous ? { previous: current.value.configuration.previous } : {}) };
        const changed = !current || source.digest !== current.value.configuration?.digest;
        if (changed) {
          const [issues] = await this.team.settingsIssues([fields.settings]);
          if (fields.settings.toolOptionIds.length || issues!.length) throw new AppError('invalid_config', issues!.join('; ') || 'Member tools come only from harnesses');
          review.changes.push({ type: current ? 'update' : 'create', path, name: fields.name, memberId: current?.id, before: current?.value.configuration, after: source, fields });
        }
        resulting.push(fields);
      } catch (error) { issue(path, error); }
    }
    for (const member of active) {
      const path = member.value.configuration!.path;
      if (seen.has(path.toLowerCase())) continue;
      if (member.value.lead) review.issues.push({ path, code: 'lead_required', message: 'The lead cannot be deleted' });
      else review.changes.push({ type: 'delete', path, name: member.value.name, memberId: member.id, before: member.value.configuration });
    }
    if (resulting.length > maxMembers) review.issues.push({ path: memberRoot, code: 'team_full', message: `A team has at most ${maxMembers} members` });
    if (new Set(resulting.map(m => m.name.toLowerCase())).size !== resulting.length) review.issues.push({ path: memberRoot, code: 'member_exists', message: 'Resulting member names must be unique' });
    review.valid = !review.issues.length;
    review.digest = sha256(JSON.stringify({ revision, active: active.map(m => [m.id, m.revision]), modelsRevision: models.revision, designs: [...designs].sort(([a],[b]) => a.localeCompare(b)) }));
    return { review, active, modelsRevision: models.revision };
  }
}
