import { BackendError, waitForRetry } from './agent-client.js';
import { json, type RunSettings, type ModelOptions, type ConfigRecord } from './config-client.js';
import { ProtocolError, readSse, type SseFrame } from './sse.js';

export interface WorkspaceRecord { workspaceId: string; name: string; directory: string; createdAt: number }
export interface ModelReference { connectionId: string; modelId: string }
export interface WorkspaceModels { models: ModelOptions[]; defaultModel: ModelReference | null }
export interface WorkspaceModelsRecord { revision: number; value: WorkspaceModels; issues: string[] }
export interface WorkspaceInput { name: string; directory: string; adopt: boolean; models: WorkspaceModels; cleanupRevision?: string }
export interface WorkspaceInitialization { directory: string; cleanupPaths: string[]; cleanupRevision: string | null }
export interface Problem { path: string; code: string; message: string }
export interface ContextOverview { workspaceId: string; seq: number; files: number; bytes: number; problems: Problem[] }
export interface Workspace extends WorkspaceRecord { context: ContextOverview }
export type Author = { type: 'user' } | { type: 'external' } | { type: 'lead'; memberId: string; runId: string };
export type FileAction = 'create' | 'update' | 'move' | 'delete';
export interface FolderEntry { path: string; type: 'folder' }
export interface FileEntry { path: string; type: 'file'; size: number; updatedAt: number; revision?: string; author?: Author }
export type Entry = FileEntry | FolderEntry;
export interface Listing { path: string; entries: Entry[]; truncated: boolean }
export interface Found { paths: string[]; truncated: boolean }
export interface ProjectFile { path: string; revision: string; content: string; size: number; updatedAt: number }
export interface ContextFile extends ProjectFile { current: boolean; author: Author; reason: string | null }
export interface ChangeFile { action: FileAction; path: string; fromPath: string | null; revision: string | null }
export interface ChangeRecord { seq: number; time: number; author: Author; reason: string | null; files: ChangeFile[] }
export interface ContextVersion { revision: string | null; seq: number; time: number; action: FileAction; path: string; fromPath: string | null; size: number | null; author: Author; reason: string | null }
export interface DesignPart { content: string; implementation: string[]; documents: {path: string; content: string}[] }
export interface DesignSummary { path: string; revision: string; implementation: string[] }
export interface DesignCatalog { designs: DesignSummary[]; truncated: boolean }
export interface CurrentDesign extends ContextFile { design: DesignPart | null; designIssue: string | null }
export interface History { versions: ContextVersion[]; next: number | null }
export interface Match { path: string; line: number; text: string }
export type CommandRule = { kind: 'exact'; argv: string[] } | { kind: 'executable'; executable: string };
export interface HarnessConfig { designScope: { working: string[]; dependencies: string[] }; implementationScope: { paths: string[]; usePaths: string[] }; allowedCommands: CommandRule[] }
/** A team member as the backend reports it. `memberId` is also the ID of the member's conversation. */
export interface Member {
  memberId: string; workspaceId: string; revision: number; name: string; role: string; responsibility: string; harness: HarnessConfig;
  lead: boolean; settings: RunSettings; issues: string[]; ready: boolean; running: boolean;
}
export type MemberModelSettings = Pick<RunSettings, 'connectionId' | 'modelId' | 'modelOptions'>;
export interface MemberModelConfig extends ConfigRecord<MemberModelSettings> { issues: string[] }
export interface Team { workspaceId: string; members: Member[] }
export type RosterMember = Pick<Member, 'memberId' | 'workspaceId' | 'revision' | 'name' | 'role' | 'responsibility' | 'lead' | 'running'>;
export interface TeamRoster { workspaceId: string; members: RosterMember[] }
export interface HarnessResource { id: string; paths: string[]; exclude: string[]; commit: 'agent' | 'user'; prompt: string; context?: 'design' | 'impl' }
export interface HarnessDefinition { id: string; tools: string[]; prompt: string; resources: HarnessResource[] }
export interface MemberInspection {
  member: Member;
  configuration: { path: string; files: Record<string, string>; digest: string; submittedBy: string; submittedAt: number; formatVersion?: number; acceptedRevision?: string } | null;
  harnesses: HarnessDefinition[];
}
export interface ConfigurationIssue { path: string; code: string; message: string }
export interface FileChange { path: string; action: 'add' | 'modify' | 'delete'; patch: string; truncated: boolean }
export interface FileReview { revision: string; base: string; changes: FileChange[] }
export interface WorkspaceChanges {
  workspaceId: string; leadId: string; design: FileReview; members: FileReview;
  activation: { revision: string; activeRevision: string | null; hasChanges: boolean };
}
export interface MemberConfigurationReview { revision: string; digest: string; valid: boolean; issues: ConfigurationIssue[]; changes?: { type: 'create' | 'update' | 'delete'; path: string; name: string }[] }
export interface ConfigurationCommit { revision: string; message: string; time: number; author: string }
export interface CurrentMemberConfiguration {
  workspaceId: string; leadId: string;
  active: { revision: string | null; time: number | null };
  current: { revision: string; members: { path: string; memberId?: string; fields: { name: string; role: string; responsibility: string; settings: RunSettings; harness: Omit<HarnessConfig, 'implementationScope'> } }[]; files: { path: string; content: string | null; problem: string | null; size: number }[] };
  changes: FileChange[];
  status: { hasPending: boolean; pendingPaths: string[]; valid: boolean; issues: ConfigurationIssue[]; commits: ConfigurationCommit[]; more: boolean; historyKnown: boolean };
  activation: { revision: string; digest: string; valid: boolean; issues: ConfigurationIssue[]; hasChanges: boolean };
}

const query = (path: string, values: Record<string, string | number | null | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null) params.set(key, String(value));
  const search = params.toString();
  return search ? `${path}?${search}` : path;
};

/** Workspace, project-file, and context-base requests in the backend's format. */
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

  roster(workspaceId: string): Promise<TeamRoster> { return this.get(`${this.base(workspaceId)}/team/roster`); }
  team(workspaceId: string): Promise<Team> { return this.get(`${this.base(workspaceId)}/team`); }
  inspectMember(workspaceId: string, memberId: string): Promise<MemberInspection> { return this.get(`${this.base(workspaceId)}/team/members/${encodeURIComponent(memberId)}`); }
  memberModelSettings(workspaceId: string, memberId: string): Promise<MemberModelConfig> { return this.get(`${this.base(workspaceId)}/team/members/${encodeURIComponent(memberId)}/model-settings`); }
  updateMemberModelSettings(workspaceId: string, memberId: string, revision: number, value: MemberModelSettings): Promise<MemberModelConfig> { return this.write(`${this.base(workspaceId)}/team/members/${encodeURIComponent(memberId)}/model-settings`, 'PUT', { revision, value }); }

  currentMemberConfiguration(workspaceId: string): Promise<CurrentMemberConfiguration> { return this.get(`${this.base(workspaceId)}/team/configuration/current`); }
  changes(workspaceId: string): Promise<WorkspaceChanges> { return this.get(`${this.base(workspaceId)}/team/changes`); }
  committedMemberReview(workspaceId: string): Promise<MemberConfigurationReview> { return this.get(`${this.base(workspaceId)}/team/configuration?source=committed`); }

  activateMemberConfiguration(workspaceId: string, input: { revision: string; digest: string }): Promise<{ revision: string; memberIds: string[] }> { return this.write(`${this.base(workspaceId)}/team/configuration/activate`, 'POST', input); }
  workspaceModels(workspaceId: string): Promise<WorkspaceModelsRecord> { return this.get(`${this.base(workspaceId)}/models`); }
  updateWorkspaceModels(workspaceId: string, revision: number, value: WorkspaceModels): Promise<WorkspaceModelsRecord> { return this.write(`${this.base(workspaceId)}/models`, 'PUT', { revision, value }); }

  designs(workspaceId: string): Promise<DesignCatalog> { return this.get(`${this.base(workspaceId)}/designs`); }
  readDesign(workspaceId: string, path: string): Promise<CurrentDesign> { return this.get(query(`${this.base(workspaceId)}/designs/file`, { path })); }

  projectTree(workspaceId: string, path: string, depth = 1): Promise<Listing> { return this.get(query(`${this.base(workspaceId)}/files/tree`, { path, depth })); }
  readProject(workspaceId: string, path: string): Promise<ProjectFile> { return this.get(query(`${this.base(workspaceId)}/files/file`, { path })); }
  saveProject(workspaceId: string, path: string, content: string, baseRevision: string | null): Promise<{ path: string; revision: string }> {
    return this.write(query(`${this.base(workspaceId)}/files/file`, { path }), 'PUT', { content, baseRevision });
  }
  findProject(workspaceId: string, q: string): Promise<Found> { return this.get(query(`${this.base(workspaceId)}/files/find`, { q })); }

  overview(workspaceId: string): Promise<ContextOverview> { return this.get(`${this.base(workspaceId)}/context`); }
  contextTree(workspaceId: string, path: string, depth = 1): Promise<Listing> { return this.get(query(`${this.base(workspaceId)}/context/tree`, { path, depth })); }
  readContext(workspaceId: string, target: { path: string } | { revision: string }): Promise<ContextFile> {
    return this.get(query(`${this.base(workspaceId)}/context/file`, target));
  }
  saveContext(workspaceId: string, path: string, content: string, baseRevision: string | null, reason?: string): Promise<{ path: string; revision: string; seq: number | null }> {
    return this.write(query(`${this.base(workspaceId)}/context/file`, { path }), 'PUT', { content, baseRevision, reason });
  }
  moveContext(workspaceId: string, from: string, to: string, baseRevision?: string): Promise<{ seq: number; moved: { from: string; to: string; revision: string }[] }> {
    return this.write(`${this.base(workspaceId)}/context/move`, 'POST', { from, to, baseRevision });
  }
  deleteContext(workspaceId: string, path: string, baseRevision?: string): Promise<{ seq: number; deleted: string[] }> {
    return this.write(`${this.base(workspaceId)}/context/delete`, 'POST', { path, baseRevision });
  }
  contextHistory(workspaceId: string, path: string, before: number | null = null, limit?: number): Promise<History> {
    return this.get(query(`${this.base(workspaceId)}/context/history`, { path, before, limit }));
  }
  findContext(workspaceId: string, q: string): Promise<Found> { return this.get(query(`${this.base(workspaceId)}/context/find`, { q })); }
  searchContext(workspaceId: string, q: string, path = ''): Promise<{ matches: Match[]; truncated: boolean }> {
    return this.get(query(`${this.base(workspaceId)}/context/search`, { q, path: path || undefined }));
  }
}

export type FeedConnection = 'syncing' | 'following' | 'disconnected' | 'error';
export interface FeedSnapshot { seq: number; connection: FeedConnection; error: string | null }
interface FeedOptions { fetcher?: typeof fetch; retryDelayMs?: (attempt: number) => number }
type FeedEvent = { type: 'record'; record: ChangeRecord } | { type: 'sync'; seq: number } | { type: 'stream_error'; message: string };

function feedEvent(frame: SseFrame, workspaceId: string): FeedEvent {
  let value: unknown;
  try { value = JSON.parse(frame.data); }
  catch { throw new ProtocolError('Invalid JSON in change stream'); }
  const event = (value && typeof value === 'object' ? value : {}) as { version?: unknown; workspaceId?: unknown; type?: unknown };
  if (event.version !== 1 || event.workspaceId !== workspaceId || event.type !== frame.name || !['record', 'sync', 'stream_error'].includes(String(event.type))) {
    throw new ProtocolError('Unsupported change event');
  }
  return event as FeedEvent;
}

/** Follows a workspace's context change records in order, reconnecting from the last applied seq. */
export class ContextFeed {
  private readonly fetcher: typeof fetch;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly listeners = new Set<() => void>();
  private readonly recordListeners = new Set<(record: ChangeRecord) => void>();
  private readonly controller = new AbortController();
  private snapshot: FeedSnapshot;

  constructor(readonly workspaceId: string, after: number, options: FeedOptions = {}) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.retryDelayMs = options.retryDelayMs ?? (attempt => Math.min(500 * 2 ** Math.min(attempt, 4), 8000));
    this.snapshot = { seq: after, connection: 'syncing', error: null };
  }

  getSnapshot = (): FeedSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  onRecord(listener: (record: ChangeRecord) => void): () => void {
    this.recordListeners.add(listener);
    return () => { this.recordListeners.delete(listener); };
  }

  start(): void { void this.run(this.controller.signal); }

  dispose(): void {
    this.controller.abort();
    this.listeners.clear();
    this.recordListeners.clear();
  }

  private publish(changes: Partial<FeedSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of this.listeners) listener();
  }

  private async run(signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const response = await this.fetcher(query(`/workspaces/${encodeURIComponent(this.workspaceId)}/context/follow`, { after: this.snapshot.seq }), { headers: { Accept: 'text/event-stream' }, signal });
        if (!response.ok) await json(response);
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new ProtocolError('Backend did not return an SSE stream');
        for await (const frame of readSse(response.body)) {
          if (signal.aborted) return;
          const event = feedEvent(frame, this.workspaceId);
          if (event.type === 'stream_error') throw new Error(event.message);
          if (event.type === 'sync') {
            if (event.seq !== this.snapshot.seq) throw new ProtocolError('Change records did not reach the sync position');
            attempt = 0;
            this.publish({ connection: 'following', error: null });
            continue;
          }
          if (event.record.seq !== this.snapshot.seq + 1) throw new ProtocolError('Change records have a gap');
          this.publish({ seq: event.record.seq });
          for (const listener of this.recordListeners) listener(event.record);
        }
        throw new Error('Change stream closed');
      } catch (error) {
        if (signal.aborted) return;
        const fatal = error instanceof ProtocolError || (error instanceof BackendError && error.status >= 400 && error.status < 500);
        this.publish({ connection: fatal ? 'error' : 'disconnected', error: error instanceof Error ? error.message : 'Change stream failed' });
        if (fatal) return;
        await waitForRetry(this.retryDelayMs(attempt++), signal);
        if (!signal.aborted) this.publish({ connection: 'syncing', error: null });
      }
    }
  }
}
