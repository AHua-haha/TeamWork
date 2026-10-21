import type { ProgressEvent } from '../domain/progress.js';
import type { JsonObject, Message } from '@earendil-works/pi-ai';

export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
  }
}

export interface ContextEntry {
  messageId: string;
  message: Message;
  metadata: JsonObject;
}

export interface ContextHistory {
  revision: number;
  entries: ContextEntry[];
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

export function identity(value: unknown, label = 'identity'): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new AppError('invalid_input', `${label} must be 1–64 ASCII letters, digits, underscores or hyphens`);
  }
}

export function position(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AppError('invalid_input', 'Position must be a nonnegative safe integer');
  }
}
