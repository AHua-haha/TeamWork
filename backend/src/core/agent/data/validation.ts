import type { Message } from '@earendil-works/pi-ai';
import { identity, position, type ComponentState, type ContextEntry, type RunState } from './model.js';
import { invalid, object, jsonValue } from '../../validation.js';

export function validateMessage(value: unknown): asserts value is Message {
  object(value);
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) invalid('Message timestamp is required');
  if (!['system', 'user', 'assistant', 'toolResult'].includes(String(value.role))) invalid('Unknown Pi message role');
  if (typeof value.content === 'string') {
    if (value.role !== 'user' && value.role !== 'system') invalid('This message role requires content blocks');
  } else {
    if (!Array.isArray(value.content)) invalid('Message content is required');
    for (const part of value.content) {
      object(part);
      if (part.type === 'text' && typeof part.text === 'string') continue;
      if (part.type === 'thinking' && value.role === 'assistant' && typeof part.thinking === 'string') continue;
      if (part.type === 'image' && ['user', 'toolResult'].includes(String(value.role)) && typeof part.data === 'string' && typeof part.mimeType === 'string') continue;
      if (part.type === 'toolCall' && value.role === 'assistant' && typeof part.id === 'string' && typeof part.name === 'string') {
        if (!part.id || !part.name) invalid('Tool call identity and name must be nonempty');
        object(part.arguments);
        continue;
      }
      invalid('Unsupported or malformed Pi content block');
    }
  }
  if (value.role === 'assistant') {
    for (const field of ['api', 'provider', 'model']) if (typeof value[field] !== 'string') invalid(`Assistant ${field} is required`);
    if (!['pending', 'stop', 'length', 'toolUse', 'error', 'aborted', 'deferred'].includes(String(value.stopReason))) invalid('Invalid stop reason');
    object(value.usage);
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) {
      if (typeof value.usage[field] !== 'number' || !Number.isFinite(value.usage[field])) invalid('Invalid token usage');
    }
    object(value.usage.cost);
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) {
      if (typeof value.usage.cost[field] !== 'number' || !Number.isFinite(value.usage.cost[field])) invalid('Invalid usage cost');
    }
  }
  if (value.role === 'toolResult' && (typeof value.toolCallId !== 'string' || typeof value.toolName !== 'string' || typeof value.isError !== 'boolean')) invalid('Malformed tool result');
  jsonValue(value);
}

export function validateComponentState(value: unknown): asserts value is ComponentState {
  object(value);
  position(value.revision);
  object(value.data);
  jsonValue(value.data);
}

export function validateEntries(value: unknown): asserts value is ContextEntry[] {
  if (!Array.isArray(value)) invalid('Context must be a list');
  const ids = new Set<string>();
  for (const entry of value) {
    object(entry);
    identity(entry.messageId, 'messageId');
    if (ids.has(entry.messageId)) invalid('Duplicate context message identity');
    ids.add(entry.messageId);
    validateMessage(entry.message);
    object(entry.metadata);
    jsonValue(entry.metadata);
  }
}

export function validateRun(value: unknown): asserts value is RunState {
  object(value);
  identity(value.agentId);
  identity(value.runId);
  if (!['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(String(value.status))) invalid('Unknown run status');
  if (!['model', 'tools', 'finished'].includes(String(value.phase))) invalid('Unknown run phase');
  if (!Number.isSafeInteger(value.step) || (value.step as number) < 0) invalid('Invalid run step');
  if (typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)) invalid('Invalid run start time');
  if (value.activeMessageId !== null) identity(value.activeMessageId);
  if (value.status === 'running') {
    if (value.phase === 'finished' || value.endedAt !== null || value.endPosition !== null) invalid('Invalid active run state');
  } else {
    if (value.phase !== 'finished' || value.activeMessageId !== null || typeof value.endedAt !== 'number' || !Number.isFinite(value.endedAt) || !Number.isSafeInteger(value.endPosition) || (value.endPosition as number) < 0) invalid('Invalid terminal run state');
  }
  if (value.error !== null) {
    object(value.error);
    if (typeof value.error.code !== 'string' || typeof value.error.message !== 'string') invalid('Invalid run failure');
  }
}
