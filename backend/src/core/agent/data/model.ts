import type { ProgressEvent } from './progress.js';
import type { JsonObject, Message } from '@earendil-works/pi-ai';

export { AppError, identity, position } from '../../errors.js';

export interface ContextEntry {
  messageId: string;
  message: Message;
  metadata: JsonObject;
}

export interface ContextHistory {
  revision: number;
  entries: ContextEntry[];
}

export interface AssistantResponseHandlerData {
  revision: number;
  data: JsonObject;
}

export interface ContextMetadataUpdate { messageId: string; metadata: JsonObject }
export interface HandlerMessageEffects {
  handlerId: string;
  revision: number;
  data: JsonObject;
  metadataUpdates: ContextMetadataUpdate[];
}

export interface ContextPatch {
  metadata?: ContextMetadataUpdate[];
  append: ContextEntry[];
  update: ContextEntry[];
}

export interface CompletedMessage extends ContextEntry {
  agentId: string;
  runId: string;
  position: number;
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface RunState {
  agentId: string;
  runId: string;
  status: RunStatus;
  phase: 'model' | 'tools' | 'finished';
  step: number;
  startedAt: number;
  endedAt: number | null;
  endPosition: number | null;
  activeMessageId: string | null;
  error: { code: string; message: string } | null;
}

export interface CurrentState {
  agentId: string;
  contextRevision: number;
  historyPosition: number;
  run: RunState | null;
}

export interface FollowSnapshot {
  state: CurrentState;
  history: CompletedMessage[];
}

/** Whole Pi records and compact progress frames. Positions start at 1; chunks at 0 per message. */
export type FollowEvent = { version: 2; agentId: string; runId: string | null } & (
  | { type: 'message'; record: CompletedMessage }
  | { type: 'sync'; historyPosition: number; run: RunState | null }
  | { type: 'chunk'; messageId: string; sequence: number; event: ProgressEvent }
  | { type: 'gap'; messageId: string; expectedSequence: number; firstAvailable: number }
  | { type: 'state'; run: RunState }
  | { type: 'end'; historyPosition: number; run: RunState | null }
);

export interface AgentRecord {
  id:string; contextLength:number; contextRevision:number; historyPosition:number;
  activeRunId:string|null; latestRunId:string|null; contextFormat:number;
}

/** Narrow coordination view; private context and SQL rows stay inside Agent. */
export interface AgentExecutionState {id:string;historyPosition:number;activeRunId:string|null}
