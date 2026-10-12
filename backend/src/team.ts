import { randomUUID } from 'node:crypto';
import { emptyRunSettings, keys, obj, validateRunSettings, type ConfigService, type ResolvedRunConfig, type RunSettings } from './config.js';
import { validSegment } from './context-base.js';
import { AppError } from './types.js';
import type { WorkspaceRecord } from './context-base.js';
import type { RunConfigSource } from './runtime.js';

export const maxMembers = 20;
export const maxScopePaths = 50;
const maxScopeSegments = 16;
const namePattern = /^[A-Za-z0-9](?:[A-Za-z0-9 _.-]{0,38}[A-Za-z0-9])?$/;
const controlCharacter = /[\u0000-\u001f\u007f-\u009f]/;

/** The team's record of one member. Its conversation has the member's ID. */
export interface MemberRecord {
  workspaceId: string; name: string; role: string; responsibility: string; scope: string[];
  lead: boolean; settings: RunSettings; createdAt: number; retiredAt: number | null;
}
/** The fields a caller may set. */
export interface MemberFields { name: string; role: string; responsibility: string; scope: string[]; settings: RunSettings }
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
  updateMember(memberId: string, revision: number, nameKey: string | null, value: MemberRecord): Promise<StoredMember>;
}

export const leadResponsibility = 'Works with the user on this project: understands what the user wants, forms the team the project needs, gives work to the members, and reports results.';

/** The lead every workspace is created with: no model, so the user chooses one before it can run. */
export function newLead(workspaceId: string): NewMember {
  return {
    id: randomUUID(), workspaceId, lead: true, nameKey: 'lead',
    value: { workspaceId, name: 'Lead', role: 'Lead', responsibility: leadResponsibility, scope: [], lead: true, settings: emptyRunSettings, createdAt: Date.now(), retiredAt: null },
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

/** One scope path in the context base's form: `agent` or `agent/...`, without a trailing slash. */
export function scopePath(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('invalid_path', 'A scope path is a string');
  const path = value.replace(/\/+$/, '');
  const segments = path.split('/');
  if (segments[0] !== 'agent' || segments.length > maxScopeSegments || !segments.slice(1).every(validSegment)) {
    throw new AppError('invalid_path', `"${value}" is not an agent-context path: it starts with agent/ and its names use letters, digits, spaces, "-", "_", or "."`);
  }
  return path;
}

function scope(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > maxScopePaths) throw new AppError('invalid_input', `scope is a list of at most ${maxScopePaths} paths`);
  const paths = value.map(scopePath);
  if (new Set(paths.map(path => path.toLowerCase())).size !== paths.length) throw new AppError('invalid_input', 'scope contains duplicate paths');
  return paths;
}

/** The editable fields from a full value. */
export function memberFields(value: unknown): MemberFields {
  const data = obj(value, 'Member');
  keys(data, ['name', 'role', 'responsibility', 'scope', 'settings']);
  return { name: memberName(data.name), role: text(data.role, 'role', 80, true), responsibility: text(data.responsibility, 'responsibility', 4000, false, true), scope: scope(data.scope), settings: validateRunSettings(data.settings, 'Settings') };
}

function stored(member: StoredMember): StoredMember {
  const value = member.value as unknown;
  try {
    const data = obj(value, 'Member record');
    const fields = memberFields({ name: data.name, role: data.role, responsibility: data.responsibility, scope: data.scope, settings: data.settings });
    if (typeof data.workspaceId !== 'string' || typeof data.lead !== 'boolean' || !Number.isSafeInteger(data.createdAt) || !(data.retiredAt === null || Number.isSafeInteger(data.retiredAt))) throw new Error('shape');
    return { ...member, value: { ...fields, workspaceId: data.workspaceId, lead: data.lead, createdAt: data.createdAt as number, retiredAt: data.retiredAt as number | null } };
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
  ) {}

  /** Gives each workspace that has no lead one, so workspaces registered before teams existed get theirs. Safe to repeat. */
  async initialize(): Promise<void> {
    for (const workspace of await this.workspaces.list()) {
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
  async create(workspaceId: string, input: unknown): Promise<MemberView> {
    const lead = await this.lead(workspaceId);
    const data = obj(input, 'Member');
    keys(data, ['name', 'role', 'responsibility', 'scope', 'settings']);
    if (data.settings !== undefined && (typeof data.settings !== 'object' || data.settings === null || Array.isArray(data.settings))) throw new AppError('invalid_input', 'settings is an object');
    const fields = memberFields({ responsibility: '', scope: [], ...data, settings: { ...lead.value.settings, prompt: '', ...(data.settings as object | undefined) } });
    if ((await this.active(workspaceId)).length >= maxMembers) throw new AppError('team_full', `A team has at most ${maxMembers} members`, 409);
    return this.view(await this.insert(workspaceId, fields));
  }

  async update(workspaceId: string, memberId: string, revision: number, value: unknown): Promise<MemberView> {
    const current = await this.member(workspaceId, memberId);
    const fields = memberFields(value);
    const next: MemberRecord = { ...current.value, ...fields };
    return this.view(await this.store.updateMember(memberId, revision, nameKey(fields.name), next));
  }

  /** Marks the member retired. The lead cannot be retired. */
  async retire(workspaceId: string, memberId: string, revision: number): Promise<StoredMember> {
    const current = await this.member(workspaceId, memberId);
    if (current.value.lead) throw new AppError('lead_required', 'The lead cannot be retired', 409);
    return this.store.updateMember(memberId, revision, null, { ...current.value, retiredAt: Date.now() });
  }

  /** What stops each of these members from running. */
  async issues(members: readonly StoredMember[]): Promise<string[][]> {
    return this.config.issuesFor(members.map(member => member.value.settings));
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

  private async insert(workspaceId: string, fields: MemberFields): Promise<StoredMember> {
    return this.store.createMember({ id: randomUUID(), workspaceId, lead: false, nameKey: nameKey(fields.name), value: { ...fields, workspaceId, lead: false, createdAt: Date.now(), retiredAt: null } });
  }

  private async view(member: StoredMember): Promise<MemberView> {
    return (await this.views([member]))[0]!;
  }

  private async views(members: StoredMember[]): Promise<MemberView[]> {
    const issues = await this.config.issuesFor(members.map(member => member.value.settings));
    return members.map((member, index) => {
      const { name, role, responsibility, scope: paths, settings, lead } = member.value;
      return { memberId: member.id, workspaceId: member.workspaceId, revision: member.revision, name, role, responsibility, scope: paths, lead, settings, issues: issues[index]!, ready: issues[index]!.length === 0 };
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
      return config.resolveSettings(member.value.settings, member.revision);
    },
  };
}
