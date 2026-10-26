import type { Message, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { ClientSnapshot, CompletedRecord } from '../../shared/backend-client/index.js';

type Part = Exclude<ThreadMessageLike['content'], string>[number];

function contentParts(content: string | readonly { type: 'text' | 'image'; text?: string; data?: string; mimeType?: string }[]): Part[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map(block => block.type === 'image'
    ? { type: 'image', image: `data:${block.mimeType};base64,${block.data}` }
    : { type: 'text', text: block.text ?? '' });
}

function resultValue(result: ToolResultMessage): unknown {
  return {
    content: result.content.map(block => block.type === 'text'
      ? { type: 'text', text: block.text }
      : { type: 'image', mimeType: block.mimeType, data: block.data }),
    ...(result.details === undefined ? {} : { details: result.details }),
  };
}

function projectMessage(id: string, message: Message, results: Map<string, ToolResultMessage>, metadata?: CompletedRecord['metadata'], live = false): ThreadMessageLike {
  const common = {
    id,
    createdAt: new Date(message.timestamp),
    metadata: { custom: { ...(metadata ?? {}), backendMessageId: id } },
  };
  if (message.role === 'system') {
    const text = typeof message.content === 'string' ? message.content : message.content.map(block => block.text).join('\n');
    return { ...common, role: 'system', content: [{ type: 'text', text }] };
  }
  if (message.role === 'user') return { ...common, role: 'user', content: contentParts(message.content) };
  if (message.role === 'toolResult') {
    return { ...common, role: 'assistant', content: [{ type: 'text', text: `${message.toolName} result\n${message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')}` }], status: { type: 'complete', reason: 'unknown' } };
  }
  const content: Part[] = message.content.map(block => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'thinking') return { type: 'reasoning', text: block.thinking };
    const result = results.get(block.id);
    return {
      type: 'tool-call', toolCallId: block.id, toolName: block.name,
      args: block.arguments, argsText: JSON.stringify(block.arguments),
      ...(result ? { result: resultValue(result), isError: result.isError } : {}),
    };
  });
  const status: ThreadMessageLike['status'] = live ? { type: 'running' }
    : message.stopReason === 'length' ? { type: 'incomplete', reason: 'length' }
    : message.stopReason === 'error' ? { type: 'incomplete', reason: 'error', error: message.errorMessage }
    : message.stopReason === 'aborted' ? { type: 'incomplete', reason: 'cancelled' }
    : { type: 'complete', reason: 'stop' };
  return { ...common, role: 'assistant', content, status };
}

/** Pure presentation view. Completed records and live Pi messages remain untouched in the client. */
export function projectSnapshot(snapshot: ClientSnapshot): ThreadMessageLike[] {
  const resultsByMessage = new Map<string, Map<string, ToolResultMessage>>();
  const pendingCalls = new Map<string, string>();
  const associatedResults = new Set<string>();
  for (const record of snapshot.completed) {
    if (record.message.role === 'assistant') for (const block of record.message.content) {
      if (block.type === 'toolCall') pendingCalls.set(block.id, record.messageId);
    }
    if (record.message.role === 'toolResult') {
      const owner = pendingCalls.get(record.message.toolCallId);
      if (owner) {
        const results = resultsByMessage.get(owner) ?? new Map<string, ToolResultMessage>();
        results.set(record.message.toolCallId, record.message);
        resultsByMessage.set(owner, results);
        associatedResults.add(record.messageId);
        pendingCalls.delete(record.message.toolCallId);
      }
    }
  }
  const displayed = snapshot.completed
    .filter(record => !associatedResults.has(record.messageId))
    .map(record => projectMessage(record.messageId, record.message, resultsByMessage.get(record.messageId) ?? new Map(), record.metadata));
  const completedIds = new Set(snapshot.completed.map(record => record.messageId));
  for (const live of snapshot.live) {
    if (!completedIds.has(live.messageId)) displayed.push(projectMessage(live.messageId, live.message, new Map(), undefined, true));
  }
  return displayed;
}
