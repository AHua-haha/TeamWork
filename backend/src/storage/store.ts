import type { Pool } from 'mysql2/promise';
import type { UserMessage } from '@earendil-works/pi-ai';
import type { CompletedMessage, ContextEntry, ContextHistory, CurrentState, FollowSnapshot, RunState, RunStatus } from '../foundation/types.js';
import type { ChatAcceptance, ChatPublication, ChatSnapshot } from '../domain/group-chat.js';
import type { PreparedChatImage } from '../domain/chat-images.js';

export type ConfigScope = 'app' | 'agent' | 'connection' | 'catalog' | 'model_cache';

export interface StoredConfig<T = unknown> {
  scope: ConfigScope;
  id: string;
  revision: number;
  value: T;
}

/**
 * Store interface that domain and runtime depend on.
 * Storage implements this; domain/runtime never import the concrete MySqlStore.
 */
export interface Store {
  // TODO: workspace-reset.ts reaches into storage implementation. Extract proper interface.
  readonly pool: Pool;
  // Lifecycle
  migrate(): Promise<void>;
  acquireRuntime(onLost: (error: Error) => void): Promise<void>;
  assertRuntime(): void;
  releaseRuntime(): Promise<void>;
  close(): Promise<void>;

  // Agent
  createAgent(agentId?: string, entries?: ContextEntry[]): Promise<CurrentState>;
  listAgents(): Promise<string[]>;

  // Config
  getConfig<T>(scope: ConfigScope, id: string): Promise<StoredConfig<T>>;
  listConfigs<T>(scope: ConfigScope): Promise<StoredConfig<T>[]>;
  createConfig<T>(scope: ConfigScope, id: string, value: T): Promise<StoredConfig<T>>;
  updateConfig<T>(scope: ConfigScope, id: string, revision: number, value: T, clearModelCache?: boolean): Promise<StoredConfig<T>>;
  deleteConfig(scope: ConfigScope, id: string, revision: number, clearModelCache?: boolean): Promise<void>;
  configBundle(agentId: string | null): Promise<{
    app: StoredConfig | null;
    agent: StoredConfig | null;
    catalog: StoredConfig[];
    connections: StoredConfig[];
    modelCaches: StoredConfig[];
  }>;

  // Context
  getContext(agentId: string): Promise<ContextHistory>;
  replaceContext(agentId: string, revision: number, entries: ContextEntry[]): Promise<ContextHistory>;

  // Run
  startRun(agentId: string, input: UserMessage, runId?: string): Promise<RunState>;
  beginMessage(agentId: string, runId: string, messageId: string, step: number): Promise<number>;
  commitMessage(agentId: string, runId: string, entry: ContextEntry): Promise<CompletedMessage>;
  finishRun(agentId: string, runId: string, status: Exclude<RunStatus, 'running'>, error?: RunState['error']): Promise<RunState>;
  recoverInterruptedRuns(beforeFinish?: (run: { agentId: string; runId: string }) => Promise<void>): Promise<void>;

  // State
  getState(agentId: string): Promise<CurrentState>;
  followSnapshot(agentId: string, runId?: string | null, after?: number, includeHistory?: boolean): Promise<FollowSnapshot>;
  runMessages(agentId: string, runId: string): Promise<CompletedMessage[]>;

  // Member context
  prepareMemberContext(agentId: string, runId: string, documents: ContextEntry[]): Promise<void>;

  // Chat
  configureChat(workspaceId: string, value: number): Promise<void>;
  publishChat(input: ChatPublication): Promise<ChatAcceptance>;
  chatSnapshot(workspaceId: string, after?: number, limit?: number): Promise<ChatSnapshot>;
  stopChat(workspaceId: string): Promise<Array<{ agentId: string; runId: string }>>;
  resetChat(workspaceId: string): Promise<{ workspaceId: string; resetCursor: number; resetPosition: number }>;
  chatImage(workspaceId: string, imageId: string): Promise<PreparedChatImage>;

  // Workspace
  createWorkspace(record: { workspaceId: string; name: string; directory: string }, directoryKey: string, lead: unknown, models?: unknown): Promise<void>;
  getWorkspace(workspaceId: string): Promise<{ workspaceId: string; name: string; directory: string; createdAt: number } | null>;
  listWorkspaces(): Promise<Array<{ workspaceId: string; name: string; directory: string; createdAt: number }>>;

  // Workspace models
  getWorkspaceModels(workspaceId: string): Promise<{ revision: number; value: unknown } | null>;
  saveWorkspaceModels(workspaceId: string, expectedRevision: number | null, value: unknown, initializeLead: boolean): Promise<{ revision: number; value: unknown }>;

  // Context base
  loadContext(workspaceId: string): Promise<{ seq: number; files: unknown[] }>;
  commitContext(workspaceId: string, expectedSeq: number, commit: unknown): Promise<void>;
  blob(workspaceId: string, hash: string): Promise<string | null>;
  version(workspaceId: string, revision: string): Promise<unknown | null>;
  history(workspaceId: string, fileId: string, before: number, limit: number): Promise<unknown[]>;
  lastFileId(workspaceId: string, pathKey: string): Promise<string | null>;
  records(workspaceId: string, after: number, limit: number): Promise<unknown[]>;

  // Team members
  createMember(record: { id: string; workspaceId: string; value: unknown }): Promise<{ id: string; workspaceId: string; revision: number; value: unknown }>;
  getMember(id: string): Promise<{ id: string; workspaceId: string; revision: number; value: unknown } | null>;
  listMembers(workspaceId: string): Promise<Array<{ id: string; workspaceId: string; revision: number; value: unknown }>>;
  updateMember(id: string, expectedRevision: number, nameKey: string | null, value: unknown, requireIdle?: boolean): Promise<{ id: string; workspaceId: string; revision: number; value: unknown }>;
  activateMembers(workspaceId: string, change: { expected: Array<{ id: string; revision: number }>; modelsRevision: number | null; create: unknown[]; update: unknown[] }): Promise<void>;

  // Admin
}
