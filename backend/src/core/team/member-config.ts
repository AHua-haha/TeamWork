import {resetMemberShell} from '../react-harness/index.js';
import { memberRoot } from '../workspace/workspace-layout.js';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { keys, obj, validateRunSettings } from './data/config.js';
import { resolveAssignment, type MemberWorkspace } from './member-workspace.js';
import { parseDesignScope } from './data/assignment.js';
import { sourceBundle, type MemberConfigSource } from './data/member-config.js';
import { memberFields, memberName, maxMembers, type MemberFields, type MemberActivationState, type NewMember, type StoredMember, type TeamService } from './data/members.js';
import { modelRunSettings } from '../workspace/data/models.js';
import { encodeText } from '../text.js';
import { AppError } from '../agent/data/model.js';

interface MemberChange {
  type: 'create' | 'update' | 'delete'; path: string; name: string; memberId?: string;
  before?: MemberConfigSource; after?: MemberConfigSource; fields?: MemberFields;
}
export interface MemberValidation {
  valid: boolean;
  changes: MemberChange[]; issues: { path: string; code: string; message: string }[];
}
interface Plan { review: MemberValidation; active: StoredMember[]; modelsRevision: number; activation: MemberActivationState | null }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const assignment = (scope: MemberFields['designScope']) => ({ working: scope.working.map(p => p.toLowerCase()).sort(), dependencies: scope.dependencies.map(p => p.toLowerCase()).sort() });
const withoutPrompt = (settings: MemberFields['settings']) => { const { prompt: _prompt, ...rest } = settings; return rest; };

/** Current member files are inputs; activation stores the durable active snapshot independently of Git. */
export class MemberConfigService {
  constructor(private readonly team: TeamService, private readonly workspace: MemberWorkspace) {}
  async activeSource(workspaceId: string, memberId: string): Promise<MemberConfigSource> {
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
  async validate(agentId: string, path: unknown): Promise<MemberValidation> {
    const lead = await this.team.find(agentId);
    if (!lead || lead.value.retiredAt !== null) throw new AppError('access_denied', 'This agent is not an active team member', 403);
    if (path !== memberRoot) throw new AppError('invalid_input', `Validate the complete ${memberRoot} change set`);
    return this.workspace.operation(agentId, async () => (await this.plan(lead.workspaceId, lead.id)).review);
  }
  /** Only the user HTTP control boundary calls this, inside the workspace idle gate. */
  async activate(workspaceId: string) {
    const lead = await this.lead(workspaceId);
    return this.workspace.operation(lead.id, async () => {
      const plan = await this.plan(workspaceId, lead.id), review = plan.review;
      if (!review.valid) throw new AppError('invalid_config', review.issues.map(i => `${i.path}: ${i.message}`).join('; '));
      const create: NewMember[] = [], update: StoredMember[] = [];
      const revision = randomUUID(); // Application activation identity, never a Git revision.
      for (const change of review.changes) {
        if (change.type === 'create') {
          const id = randomUUID(), fields = change.fields!;
          create.push({ id, workspaceId, lead: false, nameKey: fields.name.toLowerCase(), value: { workspaceId, ...fields, lead: false, createdAt: Date.now(), retiredAt: null, configuration: change.after } });
        } else {
          const current = plan.active.find(member => member.id === change.memberId)!;
          update.push({ ...current, revision: current.revision + 1, value: change.type === 'delete' ? { ...current.value, retiredAt: Date.now() } : { ...current.value, ...change.fields!, configuration: change.after } });
        }
      }
      await this.team.activate(workspaceId, { expected: plan.active.map(m => ({ id: m.id, revision: m.revision })), modelsRevision: plan.modelsRevision, create, update, expectedActivation: plan.activation, activation: { revision, time: Math.max(Date.now(), (plan.activation?.time ?? -1) + 1) } });
      await Promise.all(update.map(member => resetMemberShell(member.id)));
      return { revision, changes: review.changes.map(change => ({ type: change.type, path: change.path, name: change.name })), memberIds: [...plan.active.filter(member => !update.some(next => next.id === member.id && next.value.retiredAt !== null)).map(member => member.id), ...create.map(member => member.id)] };
    });
  }
  private async plan(workspaceId: string, leadId: string): Promise<Plan> {
    await this.workspace.designs.refresh(workspaceId);
    const all = await this.team.all(workspaceId), active = all.filter(member => member.value.retiredAt === null);
    const activation = await this.team.activation(workspaceId);
    const models=await this.team.models(workspaceId), selectedFiles=await this.workspace.configurationFiles(leadId);
    const paths=Object.keys(selectedFiles);
    const textAt=async(path:string)=>{const text=selectedFiles[path];if(text===undefined)throw new AppError('invalid_config',`Referenced file is missing: ${path}`);encodeText(text);return text;};
    const review:MemberValidation={valid:false,changes:[],issues:[]};
    const issue=(path:string,error:unknown)=>{if(!(error instanceof AppError)||error.status>=500)throw error;review.issues.push({path,code:error.code,message:error.message});};
    const known = new Map(active.map(m => [m.value.configuration!.path.toLowerCase(), m]));
    const manifests = paths.filter(path => path.toLowerCase().endsWith('/member.json')), seen = new Set<string>(), resulting: MemberFields[] = [];
    for (const path of manifests) {
      try {
        const match = /^\.rsi\/members\/([^/]+)\/member\.json$/.exec(path);
        if (!match) throw new AppError('invalid_path', 'Member manifests belong at .rsi/members/<name>/member.json');
        memberName(match[1]);
        if (seen.has(path.toLowerCase())) throw new AppError('invalid_config', 'Duplicate member bundle ignoring case');
        seen.add(path.toLowerCase());
        const current = known.get(path.toLowerCase());
        if (!current && all.some(m => m.value.configuration?.path.toLowerCase() === path.toLowerCase())) throw new AppError('invalid_config', 'A retired bundle cannot be reused; create a new bundle');
        const raw = await textAt(path);
        let value: unknown;
        try { value = JSON.parse(raw); } catch { throw new AppError('invalid_config', 'Member manifest must be valid JSON'); }
        const data = obj(value, 'Member manifest'); keys(data, ['name', 'role', 'responsibility', 'settings', 'designScope']);
        const settings = obj(data.settings, 'Member settings');
        if('prompt' in settings||'promptOptionIds' in settings)throw new AppError('invalid_config','Member instructions come only from agent.md; inline prompts and catalog selections are not supported');
        const designScope=parseDesignScope(data.designScope);
        const prompt=await textAt(`${dirname(path)}/agent.md`);
        const files:Record<string,string>={'member.json':raw,'agent.md':prompt};
        let defaults;
        if (current) defaults = current.value.settings;
        else {
          const selected = models.value.models.find(m => m.connectionId === (settings.connectionId ?? models.value.defaultModel?.connectionId) && m.modelId === (settings.modelId ?? models.value.defaultModel?.modelId));
          if (!selected) throw new AppError('invalid_config', 'Choose a model from this workspace');
          defaults = modelRunSettings(selected);
        }
        const fields = memberFields({ name: data.name, role: data.role, responsibility: data.responsibility, designScope, settings: validateRunSettings({ ...defaults, ...settings, prompt }) });
        if (current) {
          if (fields.name !== current.value.name || fields.role !== current.value.role || !same(withoutPrompt(fields.settings), withoutPrompt(current.value.settings)) || !same(assignment(fields.designScope), assignment(current.value.designScope))) throw new AppError('forbidden_update', 'Update may change only responsibility and agent.md');
          fields.designScope = current.value.designScope;
        } else if (!designScope.working.length && !designScope.dependencies.length) throw new AppError('invalid_config', 'A new worker needs a design assignment');
        if (match[1] !== fields.name) throw new AppError('invalid_config', 'Member directory must exactly match its name');
        await resolveAssignment(this.workspace.designs, workspaceId, fields.designScope);
        const source = sourceBundle(path, files, 'user');
        const changed = !current || source.digest !== current.value.configuration?.digest;
        if (changed) {
          const [issues] = await this.team.settingsIssues([{ ...fields.settings, ...current?.value.modelSettings }]);
          if (fields.settings.toolOptionIds.length || issues!.length) throw new AppError('invalid_config', issues!.join('; ') || 'Member tools come from React Harnesses');
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
    return { review, active, modelsRevision: models.revision, activation };
  }
}
