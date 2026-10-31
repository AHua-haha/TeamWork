import { randomUUID } from 'node:crypto';
import {validateComponentState} from './validation.js';
import {object, jsonValue} from '../../validation.js';
import { normalizeContext } from '@earendil-works/pi-ai';
import { estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate';
import type { ModelRequest } from '../contracts.js';
import { AgentMessageContext, type GroupContextReference } from './context.js';
import { AppError, identity, position, type ContextEntry, type ContextHistory, type ContextMetadataUpdate, type ComponentStateReplacement } from './model.js';

export interface CompactionSettings { thresholdTokens: number; prompt: string }
export type CompactionTrigger = 'before-model' | 'after-run';
/** revision is the committed baseline; preparedRevision orders journal-only operations. Cutover advances the live revision once. */
export interface PreparedComponentState extends ComponentStateReplacement { preparedRevision: number }
export interface CompactionState {
  componentStates?: PreparedComponentState[];
  contextMetadata?: ContextMetadataUpdate[];
  id: string; agentId: string; runId: string; trigger: CompactionTrigger;
  status: 'preparing' | 'completed' | 'failed'; startedAt: number; endedAt: number | null;
  error: {code: string; message: string} | null;
}
export function validateCompactionState(value: unknown): asserts value is CompactionState {
  if (!value || typeof value !== 'object') throw new AppError('invalid_data', 'Invalid compaction state');
  const state = value as CompactionState;
  identity(state.id); identity(state.agentId); identity(state.runId);
  if (!['before-model', 'after-run'].includes(state.trigger) || !['preparing', 'completed', 'failed'].includes(state.status)
    || !Number.isSafeInteger(state.startedAt) || state.startedAt < 0
    || (state.status === 'preparing' ? state.endedAt !== null : !Number.isSafeInteger(state.endedAt))
    || (state.error !== null && (!state.error || typeof state.error !== 'object' || typeof state.error.code !== 'string' || typeof state.error.message !== 'string'))) {
    throw new AppError('invalid_data', 'Invalid compaction lifecycle');
  }
  if (state.contextMetadata !== undefined) {
    if (!Array.isArray(state.contextMetadata)) throw new AppError('invalid_data', 'Invalid compaction metadata journal');
    const ids = new Set<string>();
    for (const update of state.contextMetadata) {
      identity(update.messageId, 'messageId');
      if (ids.has(update.messageId)) throw new AppError('invalid_data', 'Invalid compaction metadata journal');
      object(update.metadata); jsonValue(update.metadata);
      ids.add(update.messageId);
    }
  }
  if (state.componentStates !== undefined) {
    if (!Array.isArray(state.componentStates)) throw new AppError('invalid_data', 'Invalid compaction component state journal');
    const ids = new Set<string>();
    for (const replacement of state.componentStates) {
      identity(replacement.componentId, 'componentId');
      position(replacement.revision);
      position(replacement.preparedRevision);
      if (replacement.preparedRevision < replacement.revision || ids.has(replacement.componentId)) {
        throw new AppError('invalid_data', 'Invalid compaction component state journal');
      }
      validateComponentState({revision: replacement.preparedRevision, data: replacement.data});
      ids.add(replacement.componentId);
    }
  }
}
export function validateCompactionSettings(settings: CompactionSettings): void {
  if (!Number.isSafeInteger(settings.thresholdTokens) || settings.thresholdTokens < 1 || typeof settings.prompt !== 'string' || !settings.prompt.trim()) {
    throw new AppError('invalid_config', 'Compaction requires a positive safe-integer token threshold and instruction prompt');
  }
}
export function estimateRequestTokens(request: ModelRequest): number {
  // Measure the effective request after Harness projection. Historical usage can
  // describe a larger prefix whose file views have since been hidden or replaced.
  return normalizeContext(request.context).messages.reduce((tokens, message) => tokens + estimateMessageTokens(message), 0);
}
export function compactionInput(text: string, metadata: ContextEntry['metadata'] = {}): ContextEntry {
  return {messageId: randomUUID(), message: {role: 'user', content: text, timestamp: Date.now()}, metadata:{...metadata,runtimeGenerated:true}};
}

/** Shared coverage is selected by Agent from its own state, never supplied by Team. */
export async function compactedContext(agentId: string, before: ContextHistory, retained: ContextEntry[], group?: GroupContextReference): Promise<ContextEntry[]> {
  let through = 0;
  if (group) for (const entry of before.entries) if (entry.metadata.groupContextId === group.id) {
    const value = Number(entry.metadata.groupPosition);
    if (!Number.isSafeInteger(value) || value < 1) throw new AppError('invalid_context', 'Invalid incorporated group position');
    through = Math.max(through, value);
  }
  const original = group ? await new AgentMessageContext(agentId, {revision: 0, entries: []}).incoming({
    id: group.id, read: async after => (await group.read(after, through)).filter(message => message.position <= through),
  }) ?? [] : [];
  const handled=new Set(before.entries.filter(entry=>entry.metadata.reactInputHandled===true).map(entry=>entry.messageId));
  const shared=original.map(entry=>handled.has(entry.messageId)?{...entry,metadata:{...entry.metadata,reactInputHandled:true}}:entry);
  return [...shared, ...structuredClone(retained)];
}

export async function compactionAcknowledgement<T>(operation: () => Promise<T> | undefined): Promise<T | undefined> {
  try { return await operation(); }
  catch (error) { throw new AppError('compaction_persistence_failure', `Context preparation could not be acknowledged: ${error instanceof Error ? error.message : 'persistence failed'}`); }
}
