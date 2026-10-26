import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ClientSnapshot, CompletedRecord } from '../src/shared/backend-client/protocol.js';
import { projectSnapshot } from '../src/features/chat/project.js';
import { agentId, assistant, record, runId } from './fixtures.js';

function snapshot(completed: CompletedRecord[], live: ClientSnapshot['live'] = []): ClientSnapshot {
  return { agentId, completed, live, historyPosition: completed.length, synchronized: true, connection: 'following', run: null, sending: false, error: null };
}

test('projects completed and cumulative live Pi messages under stable identities', () => {
  const user = { ...record(1, 'u1', ''), message: { role: 'user' as const, content: 'Hello', timestamp: 1 } };
  const partial = assistant('Working', 'pending');
  const state = snapshot([user], [{ messageId: 'm1', runId, message: partial, nextSequence: 2, lastEvent: { type: 'text_delta', contentIndex: 0, delta: 'Working' } }]);
  const first = projectSnapshot(state);
  assert.equal(first[0]?.role, 'user');
  assert.equal(first[1]?.id, 'm1');
  assert.deepEqual(first[1]?.status, { type: 'running' });
  assert.deepEqual(first[1]?.content, [{ type: 'text', text: 'Working' }]);
  const whole = record(2, 'm1', 'Working!');
  const second = projectSnapshot(snapshot([user, whole], state.live));
  assert.equal(second.length, 2);
  assert.equal(second[1]?.id, 'm1');
  assert.deepEqual(second[1]?.content, [{ type: 'text', text: 'Working!' }]);
  assert.deepEqual(second[1]?.status, { type: 'complete', reason: 'stop' });
  assert.equal(state.live[0]?.message.content[0]?.type, 'text');
  assert.equal(partial.content[0]?.type, 'text');
});

test('preserves Pi part order, associates separate tool result, and leaves records intact', () => {
  const message: AssistantMessage = { ...assistant(''), stopReason: 'toolUse', content: [
    { type: 'thinking', thinking: 'Check status' },
    { type: 'text', text: 'Searching' },
    { type: 'toolCall', id: 'call_1', name: 'search', arguments: { q: 'test' } },
  ] };
  const result: ToolResultMessage = { role: 'toolResult', toolCallId: 'call_1', toolName: 'search', content: [{ type: 'text', text: 'Found' }], isError: false, timestamp: 2 };
  const records: CompletedRecord[] = [
    { ...record(1, 'm1', ''), message },
    { ...record(2, 't1', ''), message: result },
  ];
  const before = JSON.stringify(records);
  const display = projectSnapshot(snapshot(records));
  assert.equal(display.length, 1);
  assert.deepEqual((display[0]?.content as readonly { type: string }[]).map(part => part.type), ['reasoning', 'text', 'tool-call']);
  const tool = (display[0]?.content as readonly { type: string; toolCallId?: string; result?: unknown }[])[2];
  assert.equal(tool?.toolCallId, 'call_1');
  assert.deepEqual(tool?.result, { content: [{ type: 'text', text: 'Found' }] });
  assert.equal(JSON.stringify(records), before);
});

test('maps length errors, images and system sections without changing Pi payloads', () => {
  const image = { type: 'image' as const, mimeType: 'image/png', data: 'YWJj' };
  const records: CompletedRecord[] = [
    { ...record(1, 'sys', ''), message: { role: 'system', content: [{ type: 'text', text: 'First' }, { type: 'text', text: 'Second' }], timestamp: 1 } },
    { ...record(2, 'u1', ''), message: { role: 'user', content: [image], timestamp: 2 } },
    { ...record(3, 'm1', ''), message: assistant('truncated', 'length') },
  ];
  const display = projectSnapshot(snapshot(records));
  assert.deepEqual(display[0]?.content, [{ type: 'text', text: 'First\nSecond' }]);
  assert.deepEqual(display[1]?.content, [{ type: 'image', image: 'data:image/png;base64,YWJj' }]);
  assert.deepEqual(display[2]?.status, { type: 'incomplete', reason: 'length' });
  assert.equal(records[0]?.message.role, 'system');
});

test('associates reused tool call IDs with the nearest preceding call', () => {
  const call = { type: 'toolCall' as const, id: 'repeat', name: 'lookup', arguments: {} };
  const message: AssistantMessage = { ...assistant(''), content: [call], stopReason: 'toolUse' };
  const result = (text: string): ToolResultMessage => ({ role: 'toolResult', toolCallId: 'repeat', toolName: 'lookup', content: [{ type: 'text', text }], isError: false, timestamp: 2 });
  const records: CompletedRecord[] = [
    { ...record(1, 'a1', ''), message },
    { ...record(2, 'r1', ''), message: result('first') },
    { ...record(3, 'a2', ''), message },
    { ...record(4, 'r2', ''), message: result('second') },
  ];
  const display = projectSnapshot(snapshot(records));
  assert.equal(display.length, 2);
  const first = (display[0]?.content as readonly { result: { content: { text: string }[] } }[])[0];
  const second = (display[1]?.content as readonly { result: { content: { text: string }[] } }[])[0];
  assert.equal(first?.result.content[0]?.text, 'first');
  assert.equal(second?.result.content[0]?.text, 'second');
});
