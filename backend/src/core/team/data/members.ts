import { randomUUID } from 'node:crypto';
import { emptyRunSettings, keys, obj, validateRunSettings, type ConfigService, type ResolvedRunConfig, type RunSettings } from './config.js';
import type { DesignService } from '../../workspace/design.js';
import { emptyHarness, harnessConfig, type HarnessConfig, type EffectiveHarnessConfig } from '../../harness/data/config.js';
import { resolveHarness } from '../../harness/harness.js';
import { AppError } from '../../agent/data/model.js';
import { generatedSource, migrateMemberSource, type MemberConfigSource } from './member-config.js';
import type { RunConfigSource } from './config.js';
import type { WorkspaceService } from '../../workspace/workspace.js';
import { defaultRunSettings } from '../../workspace/data/models.js';

export const maxMembers = 20;
const namePattern = /^[A-Za-z0-9](?:[A-Za-z0-9 _.-]{0,38}[A-Za-z0-9])?$/;
const controlCharacter = /[\u0000-\u001f\u007f-\u009f]/;

/** The team's record of one member. Its conversation has the member's ID. */
export interface MemberRecord {
  workspaceId: string; name: string; role: string; responsibility: string; harness: HarnessConfig;
  lead: boolean; settings: RunSettings; createdAt: number; retiredAt: number | null;
  configuration?: MemberConfigSource;
  /** User-owned model preferences, independent of the activated member files. */
  modelSettings?: MemberModelSettings;
}
export type MemberModelSettings = Pick<RunSettings, 'connectionId' | 'modelId' | 'modelOptions'>;
export function memberModelSettings(value: unknown): MemberModelSettings {
  const data = obj(value, 'Member model settings');
  keys(data, ['connectionId', 'modelId', 'modelOptions']);
  const { connectionId, modelId, modelOptions } = validateRunSettings({ ...emptyRunSettings, connectionId: data.connectionId, modelId: data.modelId, modelOptions: data.modelOptions });
  return { connectionId, modelId, modelOptions };
}
export function effectiveMemberSettings(member: StoredMember): RunSettings {
  return { ...member.value.settings, ...member.value.modelSettings };
}
/** The fields a caller may set. */
export interface MemberFields { name: string; role: string; responsibility: string; harness: HarnessConfig; settings: RunSettings }
export interface StoredMember { id: string; workspaceId: string; revision: number; value: MemberRecord }
export interface MemberView extends Omit<MemberFields, 'harness'> { harness: EffectiveHarnessConfig; memberId: string; workspaceId: string; revision: number; lead: boolean; issues: string[]; ready: boolean }
export interface TeamView { workspaceId: string; members: MemberView[] }
/** Identity/presentation only; no readiness or effective harness assessment. */
export type RosterMember = Pick<MemberView, 'memberId' | 'workspaceId' | 'revision' | 'name' | 'role' | 'responsibility' | 'lead'>;
export interface TeamRoster { workspaceId: string; members: RosterMember[] }

/** A member to store, with its keys. `nameKey` is the lower-cased name. */
export interface NewMember { id: string; workspaceId: string; lead: boolean; nameKey: string; value: MemberRecord }

/** Persistence for members. A member's creation also creates its conversation. */
export interface MemberActivation {
  expected: { id: string; revision: number }[];
  modelsRevision: number;
  create: NewMember[];
  update: StoredMember[];
  expectedActivation: MemberActivationState | null;
  activation: MemberActivationState;
}
export interface MemberActivationState { revision: string; time: number }
export interface TeamStore {
  getMemberActivation(workspaceId: string): Promise<MemberActivationState | null>;
  /** Atomic, workspace-idle, revision-checked member changes; creates import shared history. */
  activateMembers(workspaceId: string, input: MemberActivation): Promise<void>;
  /** All members of a workspace, retired ones too, in the order they were created. */
  listMembers(workspaceId: string): Promise<StoredMember[]>;
  getMember(memberId: string): Promise<StoredMember | null>;
  /** Fails with `lead_exists` for a second lead and `member_exists` for a name an active member has. */
  createMember(member: NewMember): Promise<StoredMember>;
  /** `nameKey` is null for a retired member, which frees its name. */
  updateMember(memberId: string, revision: number, nameKey: string | null, value: MemberRecord, requireIdle?: boolean): Promise<StoredMember>;
}

export const leadResponsibility = 'Works with the user on this project: helps maintain the user design, forms the team the project needs, gives work to the members, and reports results.';

/** A workspace lead initialized with supplied default settings; empty settings support legacy imports. */
export function newLead(workspaceId: string, settings: RunSettings = emptyRunSettings, working: string[] = []): NewMember {
  const id = randomUUID();
  const fields = { name: 'Lead', role: 'Lead', responsibility: leadResponsibility, harness: { ...emptyHarness(), designScope: { working, dependencies: [] } }, settings };
  return {
    id, workspaceId, lead: true, nameKey: 'lead',
    value: { workspaceId, ...fields, configuration: generatedSource(fields, id), lead: true, createdAt: Date.now(), retiredAt: null },
  };
}

function text(value: unknown, label: string, max: number, required: boolean, multiline = false): string {
  if (typeof value !== 'string' || value.length > max || controlCharacter.test(multiline ? value.replace(/[\n\r\t]/g, '') : value) || (required && !value.trim())) {
    throw new AppError('invalid_input', `${label} must be ${required ? '1' : '0'}–${max} characters without control characters`);
  }
  return value.trim();
}

export function memberName(value: unknown): string {
  if (typeof value !== 'string' || !namePattern.test(value)) throw new AppError('invalid_input', 'name must be 1–40 letters, digits, spaces, ".", "_", or "-", starting and ending with a letter or digit');
  return value;
}

/** The editable fields from a full value. */
export function memberFields(value: unknown): MemberFields {
  const data = obj(value, 'Member');
  keys(data, ['name', 'role', 'responsibility', 'harness', 'settings']);
  return { name: memberName(data.name), role: text(data.role, 'role', 80, true), responsibility: text(data.responsibility, 'responsibility', 4000, false, true), harness: harnessConfig(data.harness), settings: validateRunSettings(data.settings, 'Settings') };
}

function stored(member: StoredMember): StoredMember {
  const value = member.value as unknown;
  try {
    const data = obj(value, 'Member record');
    const { implementationScope: _legacy, ...assignment } = data.harness as Record<string, unknown>;
    const fields = memberFields({ name: data.name, role: data.role, responsibility: data.responsibility, harness: assignment, settings: data.settings });
    if (typeof data.workspaceId !== 'string' || typeof data.lead !== 'boolean' || !Number.isSafeInteger(data.createdAt) || !(data.retiredAt === null || Number.isSafeInteger(data.retiredAt))) throw new Error('shape');
    return { ...member, value: { ...fields, configuration: data.configuration as MemberConfigSource | undefined, ...(data.modelSettings === undefined ? {} : { modelSettings: memberModelSettings(data.modelSettings) }), workspaceId: data.workspaceId, lead: data.lead, createdAt: data.createdAt as number, retiredAt: data.retiredAt as number | null } };
  } catch { throw new AppError('corrupt_data', `Stored member ${member.id} cannot be read`, 500); }
}

const active = (member: StoredMember) => member.value.retiredAt === null;
const nameKey = (name: string) => name.toLowerCase();

/** Members of workspace teams: creating, changing, retiring, and reading them. The run part lives in the runner. */
export class TeamService {
  constructor(
    private readonly store: TeamStore,
    private readonly workspaces: Pick<WorkspaceService, 'record' | 'list' | 'models' | 'defaultSettings' | 'initializeModels'>,
    private readonly config: { issuesFor(settings: readonly RunSettings[]): Promise<string[][]> },
    private readonly designs: DesignService,
  ) {}

  /** Gives each workspace that has no lead one, so workspaces registered before teams existed get theirs. Safe to repeat. */
  async initialize(): Promise<void> {
    for (const workspace of await this.workspaces.list()) {
      for (const raw of await this.store.listMembers(workspace.workspaceId)) {
        if (raw.value.retiredAt !== null) continue;
        const data = raw.value as MemberRecord & { scope?: unknown; harness: HarnessConfig & { implementationScope?: unknown } };
        const { implementationScope: legacyPaths, ...assignment } = data.harness ?? emptyHarness();
        const harness = harnessConfig({ ...emptyHarness(), ...assignment });
        const member = { ...data, harness } as MemberRecord;
        const converted = data.configuration ? migrateMemberSource(data.configuration, harness.allowedCommands) : generatedSource(member, raw.id);
        if (legacyPaths !== undefined || data.scope !== undefined || converted) {
          const { scope: _legacyScope, ...value } = member as MemberRecord & { scope?: unknown };
          await this.store.updateMember(raw.id, raw.revision, value.name.toLowerCase(), { ...value, configuration: converted ?? member.configuration });
        }
      }
      if ((await this.store.listMembers(workspace.workspaceId)).some(member => member.value.lead)) continue;
      const models = await this.workspaces.models(workspace.workspaceId);
      try { await this.store.createMember(newLead(workspace.workspaceId, models.value.defaultModel ? defaultRunSettings(models.value) : emptyRunSettings)); }
      catch (error) {
        if (!(error instanceof AppError && ['lead_exists', 'member_exists'].includes(error.code))) throw error;
      }
    }
  }

  /** The team of a workspace. Reading changes nothing. */
  async team(workspaceId: string): Promise<TeamView> {
    await this.lead(workspaceId);
    return { workspaceId, members: await this.views((await this.active(workspaceId))) };
  }

  /** Cheap chat roster: no design reads, model checks or harness resolution. */
  async roster(workspaceId: string): Promise<TeamRoster> {
    await this.requireWorkspace(workspaceId);
    return { workspaceId, members: (await this.active(workspaceId)).map(member => {
      const {name, role, responsibility, lead} = member.value;
      return { memberId: member.id, workspaceId, revision: member.revision, name, role, responsibility, lead };
    }) };
  }

  /** A member of any team, retired or not, or null. */
  async find(memberId: string): Promise<StoredMember | null> {
    const member = await this.store.getMember(memberId);
    return member ? stored(member) : null;
  }

  async get(workspaceId: string, memberId: string): Promise<MemberView> {
    return (await this.views([await this.member(workspaceId, memberId)]))[0]!;
  }
  async inspect(workspaceId: string, memberId: string) {
    const stored = await this.member(workspaceId, memberId);
    return { stored, member: await this.view(stored) };
  }
  async modelSettings(workspaceId: string, memberId: string) {
    return this.modelSettingsView(await this.member(workspaceId, memberId));
  }
  async updateModelSettings(workspaceId: string, memberId: string, revision: number, input: unknown) {
    const member = await this.member(workspaceId, memberId);
    const modelSettings = memberModelSettings(input);
    const [issues] = await this.config.issuesFor([{ ...emptyRunSettings, ...modelSettings }]);
    if (issues!.length) throw new AppError('invalid_config', issues!.join('; '));
    const saved = await this.store.updateMember(memberId, revision, nameKey(member.value.name), { ...member.value, modelSettings });
    return this.modelSettingsView(saved);
  }
  private async modelSettingsView(member: StoredMember) {
    const value = memberModelSettings(member.value.modelSettings ?? {
      connectionId: member.value.settings.connectionId, modelId: member.value.settings.modelId, modelOptions: member.value.settings.modelOptions,
    });
    const [issues] = await this.config.issuesFor([{ ...emptyRunSettings, ...value }]);
    return { id: member.id, revision: member.revision, value, issues: issues! };
  }
  async requireWorkspace(workspaceId: string) { await this.workspaces.record(workspaceId); }
  async all(workspaceId: string) { await this.workspaces.record(workspaceId); return (await this.store.listMembers(workspaceId)).map(stored); }
  async activate(workspaceId: string, input: MemberActivation) { await this.store.activateMembers(workspaceId, input); }
  activation(workspaceId: string) { return this.store.getMemberActivation(workspaceId); }
  async settingsIssues(settings: readonly RunSettings[]) { return this.config.issuesFor(settings); }
  models(workspaceId: string) { return this.workspaces.models(workspaceId); }
  defaultSettings(workspaceId: string) { return this.workspaces.defaultSettings(workspaceId); }
  async initializeWorkspaceModels(): Promise<void> {
    for (const workspace of await this.workspaces.list()) await this.workspaces.initializeModels(workspace.workspaceId, (await this.active(workspace.workspaceId)).map(m => m.value.settings));
  }

  /** The active members, the lead first. */
  async active(workspaceId: string): Promise<StoredMember[]> {
    const members = (await this.store.listMembers(workspaceId)).map(stored).filter(active);
    // The sort is stable, so the others stay in the order the store lists them: the order they were created.
    return members.sort((a, b) => Number(b.value.lead) - Number(a.value.lead));
  }

  /** The active member with a name, ignoring letter case. */
  async byName(workspaceId: string, name: string): Promise<StoredMember | undefined> {
    return (await this.active(workspaceId)).find(member => nameKey(member.value.name) === nameKey(name));
  }

  /** New members start with workspace default model settings and empty direct instructions. */
  async create(workspaceId: string, input: unknown, source?: MemberConfigSource): Promise<MemberView> {
    await this.lead(workspaceId);
    const data = obj(input, 'Member');
    keys(data, ['name', 'role', 'responsibility', 'harness', 'settings']);
    if (data.settings !== undefined && (typeof data.settings !== 'object' || data.settings === null || Array.isArray(data.settings))) throw new AppError('invalid_input', 'settings is an object');
    const fields = memberFields({ responsibility: '', harness: emptyHarness(), ...data, settings: { ...(await this.defaultSettings(workspaceId)), ...(data.settings as object | undefined) } });
    if ((await this.active(workspaceId)).length >= maxMembers) throw new AppError('team_full', `A team has at most ${maxMembers} members`, 409);
    return this.view(await this.insert(workspaceId, fields, source));
  }

  async update(workspaceId: string, memberId: string, revision: number, value: unknown, source?: MemberConfigSource): Promise<MemberView> {
    const current = await this.member(workspaceId, memberId);
    const fields = memberFields(value);
    const generated = generatedSource(fields, memberId);
    if (current.value.configuration) generated.path = current.value.configuration.path;
    const next: MemberRecord = { ...current.value, ...fields, configuration: source ?? generated };
    const changedScope = JSON.stringify(fields.harness) !== JSON.stringify(current.value.harness);
    return this.view(await this.store.updateMember(memberId, revision, nameKey(fields.name), next, Boolean(source) || changedScope));
  }

  /** Marks the member retired. The lead cannot be retired. */
  async retire(workspaceId: string, memberId: string, revision: number): Promise<StoredMember> {
    const current = await this.member(workspaceId, memberId);
    if (current.value.lead) throw new AppError('lead_required', 'The lead cannot be retired', 409);
    return this.store.updateMember(memberId, revision, null, { ...current.value, retiredAt: Date.now() });
  }

  /** What stops each of these members from running. */
  async issues(members: readonly StoredMember[]): Promise<string[][]> {
    const issues = await this.config.issuesFor(members.map(effectiveMemberSettings));
    for (const [index, member] of members.entries()) {
      if (member.value.settings.toolOptionIds.length) issues[index]!.push('Workspace member tools are supplied by the harness; clear catalog tool selections');
      const scope = member.value.harness.designScope;
      if (!member.value.lead && !scope.working.length && !scope.dependencies.length) issues[index]!.push('Configure a design scope for this member');
      try { await resolveHarness(this.designs, member.workspaceId, member.value.harness); }
      catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
        issues[index]!.push(`Harness design is unavailable: ${error.message}`);
      }
    }
    return issues;
  }

  private async member(workspaceId: string, memberId: string): Promise<StoredMember> {
    const member = await this.find(memberId);
    if (!member || member.workspaceId !== workspaceId || !active(member)) throw new AppError('not_found', `Member ${memberId} not found`, 404);
    return member;
  }

  private async lead(workspaceId: string): Promise<StoredMember> {
    await this.workspaces.record(workspaceId);
    const found = (await this.store.listMembers(workspaceId)).map(stored).find(member => member.value.lead);
    if (!found) throw new AppError('corrupt_data', `Workspace ${workspaceId} has no lead`, 500);
    return found;
  }

  private async insert(workspaceId: string, fields: MemberFields, source?: MemberConfigSource): Promise<StoredMember> {
    const id = randomUUID();
    return this.store.createMember({ id, workspaceId, lead: false, nameKey: nameKey(fields.name), value: { ...fields, configuration: source ?? generatedSource(fields, id), workspaceId, lead: false, createdAt: Date.now(), retiredAt: null } });
  }

  private async view(member: StoredMember): Promise<MemberView> {
    return (await this.views([member]))[0]!;
  }

  private async views(members: StoredMember[]): Promise<MemberView[]> {
    const issues = await this.issues(members);
    return Promise.all(members.map(async (member, index) => {
      const { name, role, responsibility, harness, lead } = member.value;
      let implementationScope = { paths: [] as string[], usePaths: [] as string[] };
      try { const resolved = await resolveHarness(this.designs, member.workspaceId, harness); implementationScope = { paths: resolved.writable, usePaths: resolved.readonly }; }
      catch (error) { if (!(error instanceof AppError) || error.status >= 500) throw error; }
      return { memberId: member.id, workspaceId: member.workspaceId, revision: member.revision, name, role, responsibility, harness: { ...harness, implementationScope }, lead, settings: effectiveMemberSettings(member), issues: issues[index]!, ready: issues[index]!.length === 0 };
    }));
  }
}

/** Run snapshots: a team member's come from its settings, any other agent's from its config. */
export function teamRunConfig(team: TeamService, config: ConfigService): RunConfigSource {
  return {
    async resolveForRun(agentId: string): Promise<ResolvedRunConfig> {
      const member = await team.find(agentId);
      if (!member) return config.resolveForRun(agentId);
      if (member.value.retiredAt !== null) throw new AppError('invalid_agent_config', 'This member has been retired', 409);
      const [issues] = await team.issues([member]);
      if (issues!.length) throw new AppError('invalid_agent_config', issues!.join('; '), 409);
      return config.resolveSettings(effectiveMemberSettings(member), member.revision);
    },
  };
}
