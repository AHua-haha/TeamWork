import type { AssistantMessageEvent, Message } from '@earendil-works/pi-ai';
import { AppError, identity, type ContextEntry, type RunState } from './types.js';

function invalid(message: string): never {
  throw new AppError('invalid_data', message);
}

function object(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object');
}

/** JSON is the persistence boundary. Optional undefined object properties are omitted, as in Pi. */
function jsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null) invalid('Unsupported JSON value');
  if (ancestors.has(value)) invalid('Cyclic data cannot be stored');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    invalid('Only plain JSON objects can be stored');
  }
  if (Object.getOwnPropertySymbols(value).length) invalid('Symbol keys cannot be stored');
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) jsonValue(item, ancestors);
  } else {
    for (const item of Object.values(value)) if (item !== undefined) jsonValue(item, ancestors);
  }
  ancestors.delete(value);
}

export function encode(value: unknown): string {
  jsonValue(value);
  return JSON.stringify({ version: 1, data: value });
}

export function decode<T>(raw: unknown, validate: (value: unknown) => void): T {
  try {
    const envelope: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    object(envelope);
    if (envelope.version !== 1 || !('data' in envelope)) invalid('Unsupported record schema version');
    jsonValue(envelope.data);
    validate(envelope.data);
    return envelope.data as T;
  } catch (error) {
    throw new AppError('corrupt_data', `Cannot deserialize stored record: ${error instanceof Error ? error.message : 'invalid data'}`, 500);
  }
}

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

export function validateEvent(value: unknown): asserts value is AssistantMessageEvent {
  object(value);
  if (value.type === 'done' || value.type === 'error') {
    const message = value.type === 'done' ? value.message : value.error;
    validateMessage(message);
    if (message.role !== 'assistant' || message.stopReason !== value.reason) invalid('Invalid Pi terminal event');
    if (!(value.type === 'done' ? ['stop', 'length', 'toolUse', 'deferred'] : ['aborted', 'error']).includes(String(value.reason))) invalid('Invalid terminal reason');
  } else if (['start', 'text_start', 'text_delta', 'text_end', 'thinking_start', 'thinking_delta', 'thinking_end', 'toolcall_start', 'toolcall_delta', 'toolcall_end'].includes(String(value.type))) {
    validateMessage(value.partial);
    if (value.partial.role !== 'assistant') invalid('Pi partial must be an assistant message');
    if (value.type !== 'start' && (!Number.isSafeInteger(value.contentIndex) || (value.contentIndex as number) < 0)) invalid('Invalid content index');
    if (String(value.type).endsWith('_delta') && typeof value.delta !== 'string') invalid('Invalid delta');
    if (['text_end', 'thinking_end'].includes(String(value.type)) && typeof value.content !== 'string') invalid('Invalid completed content block');
    if (value.type === 'toolcall_end') {
      object(value.toolCall);
      validateMessage({ ...value.partial, content: [value.toolCall] });
      if (value.toolCall.type !== 'toolCall') invalid('Invalid completed tool call');
    }
  } else invalid('Unknown Pi event');
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
