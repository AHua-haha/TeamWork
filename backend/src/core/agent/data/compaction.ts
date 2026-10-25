import { randomUUID } from 'node:crypto';
import { normalizeContext } from '@earendil-works/pi-ai';
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate';
import type { ModelRequest } from '../contracts.js';
import { AgentMessageContext, repairInterruptedTools, type GroupContextMessage, type GroupContextReference, type GroupSemanticIndex, type GroupSemanticNode } from './context.js';
import { AppError, identity, type ContextEntry, type ContextHistory } from './model.js';

export interface CompactionSettings { thresholdTokens: number; prompt: string }
export type CompactionTrigger = 'before-model' | 'after-run';
export interface CompactionState {
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
}
export function validateCompactionSettings(settings: CompactionSettings): void {
  if (!Number.isSafeInteger(settings.thresholdTokens) || settings.thresholdTokens < 1 || typeof settings.prompt !== 'string' || !settings.prompt.trim()) {
    throw new AppError('invalid_config', 'Compaction requires a positive safe-integer token threshold and instruction prompt');
  }
}
export function estimateRequestTokens(request: ModelRequest): number {
  return estimateContextTokens(normalizeContext(request.context)).tokens;
}
export function compactionInput(text: string, metadata: ContextEntry['metadata'] = {}): ContextEntry {
  return {messageId: randomUUID(), message: {role: 'user', content: text, timestamp: Date.now()}, metadata};
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
    id: group.id, read: async after => (await group.read(after)).filter(message => message.position <= through),
  }) ?? [] : [];
  const semantic = group?.semantic ? await group.semantic() : undefined;
  const shared = semantic ? semanticView(agentId, group!.id, original, semantic) : original;
  const working = structuredClone(retained);
  for (const entry of working) if (entry.message.role === 'assistant') {
    // These reports measured the discarded prefix. Never alter the immutable history record.
    entry.message.usage = {...entry.message.usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      ...(entry.message.usage.reasoning === undefined ? {} : {reasoning: 0}),
      ...(entry.message.usage.cacheWrite1h === undefined ? {} : {cacheWrite1h: 0}),
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};
    entry.metadata = {...entry.metadata, contextUsageInvalidated: true};
  }
  return [...shared, ...working];
}

function semanticView(agentId: string, groupId: string, original: ContextEntry[], index: GroupSemanticIndex): ContextEntry[] {
  const messages = original;
  const output: ContextEntry[] = [];
  const byPosition = new Map(messages.map(entry => [Number(entry.metadata.groupPosition), entry]));
  const appendOriginal = (first: number, last: number) => {
    for (let position = first; position <= last; position++) {
      const entry = byPosition.get(position);
      if (entry) output.push(structuredClone(entry));
    }
  };
  const renderChildren = (children: GroupSemanticNode[], first: number, last: number) => {
    let cursor = first;
    for (const child of children) {
      if (child.firstPosition > cursor) appendOriginal(cursor, child.firstPosition - 1);
      renderNode(child);
      cursor = child.lastPosition + 1;
    }
    if (cursor <= last) appendOriginal(cursor, last);
  };
  const renderNode = (node: GroupSemanticNode) => {
    if (!node.involvedMemberIds.includes(agentId)) {
      output.push(compactionInput(`[Group context summary ${node.firstPosition}-${node.lastPosition}]\nTopic: ${node.topic}\nSummary: ${node.summary}\nSource group positions: ${node.firstPosition}-${node.lastPosition}`, {
        source: 'group-semantic-view', groupContextId: groupId, groupPosition: node.lastPosition, semanticNodeId: node.id,
      }));
      // Summaries cannot carry image data. Preserve native image entries from the source range.
      for (let position = node.firstPosition; position <= node.lastPosition; position++) {
        const entry = byPosition.get(position);
        if (entry && Array.isArray(entry.message.content) && entry.message.content.some(block => block.type === 'image')) output.push(structuredClone(entry));
      }
      return;
    }
    if (!node.children.length) { appendOriginal(node.firstPosition, node.lastPosition); return; }
    renderChildren(node.children, node.firstPosition, node.lastPosition);
  };
  renderChildren(index.tree, index.from, Math.min(index.through, Math.max(index.from - 1, ...messages.map(entry => Number(entry.metadata.groupPosition)))));
  const lastIndexed = Math.min(index.through, Math.max(0, ...messages.map(entry => Number(entry.metadata.groupPosition))));
  if (lastIndexed < throughPosition(messages)) appendOriginal(lastIndexed + 1, throughPosition(messages));
  return output;
}
function throughPosition(entries: ContextEntry[]): number { return Math.max(0, ...entries.map(entry => Number(entry.metadata.groupPosition))); }

/** Failure/restart keeps old knowledge and recorded effects, rather than applying a partial cutover. */
export function interruptedCompactionContext(current: ContextHistory, recorded: ContextEntry[], error: CompactionState['error']): ContextEntry[] {
  const ids = new Set(current.entries.map(entry => entry.messageId));
  const entries = repairInterruptedTools([...structuredClone(current.entries), ...structuredClone(recorded.filter(entry => !ids.has(entry.messageId)))]);
  entries.push(compactionInput(`Context compaction ended without replacement${error ? ` (${error.code}): ${error.message}` : '.'} No old context was discarded. Recorded preparation tools may have changed external state; inspect it before acting. Preparation is over; resume ordinary work only when the caller requests it.`, {source: 'context-compaction-recovery'}));
  return entries;
}
