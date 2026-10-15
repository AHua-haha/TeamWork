import type { AssistantMessage, AssistantMessageEvent, JsonObject, Message, UserMessage } from '@earendil-works/pi-ai';

export interface MessageOutput { response: { toolCallId: string; text: string } }

/** Backend-owned records and Pi payloads. No assistant-ui types cross this boundary. */
export interface CompletedRecord {
  agentId: string;
  runId: string;
  messageId: string;
  position: number;
  message: Message;
  metadata: JsonObject;
  output?: MessageOutput;
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

export type FollowEvent = { version: 1; agentId: string; runId: string | null } & (
  | { type: 'message'; record: CompletedRecord }
  | { type: 'sync'; historyPosition: number; run: RunState | null }
  | { type: 'chunk'; messageId: string; sequence: number; event: AssistantMessageEvent; output?: MessageOutput }
  | { type: 'gap'; messageId: string; expectedSequence: number; firstAvailable: number }
  | { type: 'state'; run: RunState }
  | { type: 'end'; historyPosition: number; run: RunState | null }
);

export type UserInput = UserMessage['content'];

export interface LiveMessage {
  messageId: string;
  runId: string;
  message: AssistantMessage;
  nextSequence: number;
  lastEvent: AssistantMessageEvent;
  output?: MessageOutput;
}

export type ConnectionStatus = 'idle' | 'syncing' | 'following' | 'disconnected' | 'error';
export interface ClientSnapshot {
  agentId: string;
  completed: readonly CompletedRecord[];
  live: readonly LiveMessage[];
  historyPosition: number;
  synchronized: boolean;
  connection: ConnectionStatus;
  run: RunState | null;
  sending: boolean;
  error: string | null;
}
