import { randomUUID } from 'node:crypto';
import { emptyRunSettings, keys, obj, validateRunSettings, type ConfigService, type ResolvedRunConfig, type RunSettings } from './config.js';
import type { DesignService } from './design.js';
import { emptyHarness, harnessConfig, type HarnessConfig } from './harness-config.js';
import { resolveHarness } from './harness.js';
import { AppError } from './types.js';
import { generatedSource, migrateMemberSource, type MemberConfigSource } from './member-config-format.js';
import type { WorkspaceRecord } from './context-base.js';
import type { RunConfigSource } from './runtime.js';

export const maxMembers = 20;
const namePattern = /^[A-Za-z0-9](?:[A-Za-z0-9 _.-]{0,38}[A-Za-z0-9])?$/;
const controlCharacter = /[\u0000-\u001f\u007f-\u009f]/;

/** The team's record of one member. Its conversation has the member's ID. */
export interface MemberRecord {
  workspaceId: string; name: string; role: string; responsibility: string; harness: HarnessConfig;
  lead: boolean; settings: RunSettings; createdAt: number; retiredAt: number | null;
  configuration?: MemberConfigSource;
}
/** The fields a caller may set. */
export interface MemberFields { name: string; role: string; responsibility: string; harness: HarnessConfig; settings: RunSettings }
export interface StoredMember { id: string; workspaceId: string; revision: number; value: MemberRecord }
export interface MemberView extends MemberFields { memberId: string; workspaceId: string; revision: number; lead: boolean; issues: string[]; ready: boolean }
export interface TeamView { workspaceId: string; members: MemberView[] }

/** A member to store, with its keys. `nameKey` is the lower-cased name. */
export interface NewMember { id: string; workspaceId: string; lead: boolean; nameKey: string; value: MemberRecord }

/** Persistence for members. A member's creation also creates its conversation. */
export interface TeamStore {
  /** All members of a workspace, retired ones too, in the order they were created. */
  listMembers(workspaceId: string): Promise<StoredMember[]>;
  getMember(memberId: string): Promise<StoredMember | null>;
  /** Fails with `lead_exists` for a second lead and `member_exists` for a name an active member has. */
  createMember(member: NewMember): Promise<StoredMember>;
  /** `nameKey` is null for a retired member, which frees its name. */
  updateMember(memberId: string, revision: number, nameKey: string | null, value: MemberRecord, requireIdle?: boolean): Promise<StoredMember>;
}

export const leadResponsibility = 'Works with the user on this project: helps maintain the user design, forms the team the project needs, gives work to the members, and reports results.';

/** The lead every workspace is created with: no model, so the user chooses one before it can run. */
export function newLead(workspaceId: string): NewMember {
  const id = randomUUID();
  const fields = { name: 'Lead', role: 'Lead', responsibility: leadResponsibility, harness: emptyHarness(), settings: emptyRunSettings };
  return {
    id, workspaceId, lead: true, nameKey: 'lead',
    value: { workspaceId, ...fields, configuration: generatedSource(fields, id, 0), lead: true, createdAt: Date.now(), retiredAt: null },
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
    const fields = memberFields({ name: data.name, role: data.role, responsibility: data.responsibility, harness: data.harness, settings: data.settings });
    if (typeof data.workspaceId !== 'string' || typeof data.lead !== 'boolean' || !Number.isSafeInteger(data.createdAt) || !(data.retiredAt === null || Number.isSafeInteger(data.retiredAt))) throw new Error('shape');
    return { ...member, value: { ...fields, configuration: data.configuration as MemberConfigSource | undefined, workspaceId: data.workspaceId, lead: data.lead, createdAt: data.createdAt as number, retiredAt: data.retiredAt as number | null } };
  } catch { throw new AppError('corrupt_data', `Stored member ${member.id} cannot be read`, 500); }
}

const active = (member: StoredMember) => member.value.retiredAt === null;
const nameKey = (name: string) => name.toLowerCase();

/** Members of workspace teams: creating, changing, retiring, and reading them. The run part lives in the runner. */
export class TeamService {
  constructor(
    private readonly store: TeamStore,
    private readonly workspaces: { record(workspaceId: string): Promise<WorkspaceRecord>; list(): Promise<WorkspaceRecord[]> },
    private readonly config: { issuesFor(settings: readonly RunSettings[]): Promise<string[][]> },
    private readonly designs: DesignService,
  ) {}

  /** Gives each workspace that has no lead one, so workspaces registered before teams existed get theirs. Safe to repeat. */
  async initialize(beforeMigration?: (member: StoredMember, harness: HarnessConfig) => Promise<void>): Promise<void> {
    for (const workspace of await this.workspaces.list()) {
      for (const member of await this.store.listMembers(workspace.workspaceId)) {
        const data = member.value as unknown as Record<string, unknown>;
        const oldHarness = data.harness as HarnessConfig | undefined;
        if (oldHarness?.implementationScope && data.configuration) {
          // Retired bundles are historical records; a format upgrade must not replay retirement effects.
          if (member.value.retiredAt !== null) continue;
          const configuration = migrateMemberSource(data.configuration as MemberConfigSource, member.id, member.revision + 1);
          if (configuration) await this.store.updateMember(member.id, member.revision, member.value.retiredAt === null ? member.value.name.toLowerCase() : null, { ...member.value, configuration });
          continue;
        }
        const { scope: _oldScope, ...rest } = data;
        let harness = oldHarness ? { ...emptyHarness(), ...oldHarness } : emptyHarness();
        if (oldHarness && !oldHarness.implementationScope) {
          const mapped = async (paths: string[]) => {
            const result: string[] = [];
            for (const path of paths) {
              try { result.push(...(await this.designs.read(workspace.workspaceId, path)).implementation); }
              catch (error) { if (!(error instanceof AppError) || error.status >= 500) throw error; }
            }
            return [...new Set(result)];
          };
          harness = { ...harness, implementationScope: { paths: await mapped(oldHarness.designScope.working), usePaths: await mapped(oldHarness.designScope.dependencies) } };
        }
        const value = { ...rest, harness } as unknown as MemberRecord;
        value.harness = harnessConfig(harness);
        if (oldHarness) await beforeMigration?.(member, harness);
        value.configuration = generatedSource(value, member.id, member.revision + 1);
        await this.store.updateMember(member.id, member.revision, value.retiredAt === null ? value.name.toLowerCase() : null, value);
      }
      if ((await this.store.listMembers(workspace.workspaceId)).some(member => member.value.lead)) continue;
      try { await this.store.createMember(newLead(workspace.workspaceId)); }
      catch (error) {
        // Another backend process created it first; either unique key may report it.
        if (!(error instanceof AppError && (error.code === 'lead_exists' || error.code === 'member_exists'))) throw error;
      }
    }
  }

  /** The team of a workspace. Reading changes nothing. */
  async team(workspaceId: string): Promise<TeamView> {
    await this.lead(workspaceId);
    return { workspaceId, members: await this.views((await this.active(workspaceId))) };
  }

  /** A member of any team, retired or not, or null. */
  async find(memberId: string): Promise<StoredMember | null> {
    const member = await this.store.getMember(memberId);
    return member ? stored(member) : null;
  }

  async get(workspaceId: string, memberId: string): Promise<MemberView> {
    return (await this.views([await this.member(workspaceId, memberId)]))[0]!;
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

  /** Fields left out of `settings` copy the lead's; the instructions start empty. */
  async create(workspaceId: string, input: unknown, source?: MemberConfigSource): Promise<MemberView> {
    const lead = await this.lead(workspaceId);
    const data = obj(input, 'Member');
    keys(data, ['name', 'role', 'responsibility', 'harness', 'settings']);
    if (data.settings !== undefined && (typeof data.settings !== 'object' || data.settings === null || Array.isArray(data.settings))) throw new AppError('invalid_input', 'settings is an object');
    const fields = memberFields({ responsibility: '', harness: emptyHarness(), ...data, settings: { ...lead.value.settings, prompt: '', ...(data.settings as object | undefined) } });
    if ((await this.active(workspaceId)).length >= maxMembers) throw new AppError('team_full', `A team has at most ${maxMembers} members`, 409);
    return this.view(await this.insert(workspaceId, fields, source));
  }

  async update(workspaceId: string, memberId: string, revision: number, value: unknown, source?: MemberConfigSource): Promise<MemberView> {
    const current = await this.member(workspaceId, memberId);
    const fields = memberFields(value);
    const generated = generatedSource(fields, memberId, revision + 1);
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

  /** Reject unresolved provider/model/catalog settings before activating a file submission. */
  async validateSubmittedSettings(settings: RunSettings): Promise<void> {
    const [issues] = await this.config.issuesFor([settings]);
    if (issues!.length) throw new AppError('invalid_config', issues!.join('; '));
  }

  /** What stops each of these members from running. */
  async issues(members: readonly StoredMember[]): Promise<string[][]> {
    const issues = await this.config.issuesFor(members.map(member => member.value.settings));
    for (const [index, member] of members.entries()) {
      if (member.value.settings.toolOptionIds.length) issues[index]!.push('Workspace member tools are supplied by the harness; clear catalog tool selections');
      const scope = member.value.harness.designScope;
      if (!member.value.lead && !scope.working.length && !scope.dependencies.length && !member.value.harness.implementationScope.paths.length && !member.value.harness.implementationScope.usePaths.length) issues[index]!.push('Configure a design scope or implementation scope for this member');
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
    return this.store.createMember({ id, workspaceId, lead: false, nameKey: nameKey(fields.name), value: { ...fields, configuration: source ?? generatedSource(fields, id, 0), workspaceId, lead: false, createdAt: Date.now(), retiredAt: null } });
  }

  private async view(member: StoredMember): Promise<MemberView> {
    return (await this.views([member]))[0]!;
  }

  private async views(members: StoredMember[]): Promise<MemberView[]> {
    const issues = await this.issues(members);
    return members.map((member, index) => {
      const { name, role, responsibility, harness, settings, lead } = member.value;
      return { memberId: member.id, workspaceId: member.workspaceId, revision: member.revision, name, role, responsibility, harness, lead, settings, issues: issues[index]!, ready: issues[index]!.length === 0 };
    });
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
      return config.resolveSettings(member.value.settings, member.revision);
    },
  };
}
