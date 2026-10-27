import { json, type RunSettings, type ModelOptions, type ConfigRecord } from './config-client.js';

export interface WorkspaceRecord { workspaceId: string; name: string; directory: string; createdAt: number }
export interface ModelReference { connectionId: string; modelId: string }
export interface WorkspaceModels { models: ModelOptions[]; defaultModel: ModelReference | null }
export interface WorkspaceModelsRecord { revision: number; value: WorkspaceModels; issues: string[] }
export interface WorkspaceInput { name: string; directory: string; adopt: boolean; models: WorkspaceModels; cleanupRevision?: string }
export interface WorkspaceInitialization { directory: string; cleanupPaths: string[]; cleanupRevision: string | null }
export interface Workspace extends WorkspaceRecord {}
export interface RosterMember { memberId: string; workspaceId: string; revision: number; name: string; role: string; responsibility: string; lead: boolean; running: boolean }
export interface TeamRoster { workspaceId: string; members: RosterMember[] }
export type MemberModelSettings = Pick<RunSettings, 'connectionId' | 'modelId' | 'modelOptions'>;
export interface MemberModelConfig extends ConfigRecord<MemberModelSettings> { issues: string[] }
export interface ConfigurationIssue { path: string; code: string; message: string }
export interface MemberConfigurationReview { revision: string; digest: string; valid: boolean; issues: ConfigurationIssue[]; changes?: { type: 'create' | 'update' | 'delete'; path: string; name: string }[] }

/** Workspace metadata, member metadata, activation, and model settings. */
export class WorkspaceClient {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  private get<T>(path: string): Promise<T> { return this.fetcher(path).then(json<T>); }
  private write<T>(path: string, method: 'POST' | 'PUT', data: object): Promise<T> {
    return this.fetcher(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json<T>);
  }
  private base(workspaceId: string): string { return `/workspaces/${encodeURIComponent(workspaceId)}`; }

  listWorkspaces(): Promise<WorkspaceRecord[]> { return this.get<{ workspaces: WorkspaceRecord[] }>('/workspaces').then(result => result.workspaces); }
  inspectInitialization(input: Pick<WorkspaceInput, 'directory' | 'adopt'>): Promise<WorkspaceInitialization> { return this.write('/workspaces/initialization', 'POST', input); }
  createWorkspace(input: WorkspaceInput): Promise<Workspace> { return this.write('/workspaces', 'POST', input); }
  getWorkspace(workspaceId: string): Promise<Workspace> { return this.get(this.base(workspaceId)); }
  members(workspaceId: string): Promise<TeamRoster> { return this.get(`${this.base(workspaceId)}/members`); }
  member(workspaceId: string, memberId: string): Promise<RosterMember> { return this.get(`${this.base(workspaceId)}/members/${encodeURIComponent(memberId)}`); }
  roster(workspaceId: string): Promise<TeamRoster> { return this.members(workspaceId); }
  memberModelSettings(workspaceId: string, memberId: string): Promise<MemberModelConfig> { return this.get(`${this.base(workspaceId)}/members/${encodeURIComponent(memberId)}/model-settings`); }
  updateMemberModelSettings(workspaceId: string, memberId: string, revision: number, value: MemberModelSettings): Promise<MemberModelConfig> { return this.write(`${this.base(workspaceId)}/members/${encodeURIComponent(memberId)}/model-settings`, 'PUT', { revision, value }); }
  committedMemberReview(workspaceId: string): Promise<MemberConfigurationReview> { return this.get(`${this.base(workspaceId)}/team/configuration?source=committed`); }
  activateMemberConfiguration(workspaceId: string, input: { revision: string; digest: string }): Promise<{ revision: string; memberIds: string[] }> { return this.write(`${this.base(workspaceId)}/team/configuration/activate`, 'POST', input); }
  workspaceModels(workspaceId: string): Promise<WorkspaceModelsRecord> { return this.get(`${this.base(workspaceId)}/models`); }
  updateWorkspaceModels(workspaceId: string, revision: number, value: WorkspaceModels): Promise<WorkspaceModelsRecord> { return this.write(`${this.base(workspaceId)}/models`, 'PUT', { revision, value }); }
}
