import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAssistantMessageFrames, type AssistantMessage, type AssistantMessageFrame } from '@earendil-works/pi-ai';
import { ProgressReducer, type ProgressEvent } from '../src/shared/backend-client/progress.js';
import { assistant } from './fixtures.js';

test('incremental compact projection matches Pi replay across interleaved text, thinking, tool checkpoints and signatures', () => {
  const message = { ...assistant('', 'pending'), content: [] };
  const frames: ProgressEvent[] = [
    { type: 'start', message },
    { type: 'text_start', contentIndex: 0, content: { type: 'text', text: '' } },
    { type: 'thinking_start', contentIndex: 1, content: { type: 'thinking', thinking: '' } },
    { type: 'text_delta', contentIndex: 0, delta: 'Visible' },
    { type: 'thinking_delta', contentIndex: 1, delta: 'hidden' },
    { type: 'toolcall_start', contentIndex: 2, toolCall: { type: 'toolCall', id: 'call', name: 'read', arguments: {} } },
    { type: 'toolcall_checkpoint', contentIndex: 2, json: '{"path":"s' },
    { type: 'toolcall_delta', contentIndex: 2, delta: 'rc"}' },
    { type: 'text_end', contentIndex: 0, content: 'Visible text', textSignature: 'phase metadata' },
    { type: 'thinking_end', contentIndex: 1, content: 'hidden', thinkingSignature: 'opaque signature' },
    { type: 'toolcall_end', contentIndex: 2, id: 'call', name: 'read', arguments: { path: 'src' }, thoughtSignature: 'tool signature', namespace: 'files' },
  ];
  const reducer = new ProgressReducer(), replay: AssistantMessageFrame[] = [];
  let previous: AssistantMessage | undefined;
  for (const frame of frames) {
    const frozen: string | undefined = JSON.stringify(previous);
    replay.push(frame.type === 'start' ? { type: 'start', partial: frame.message } : frame);
    const actual = reducer.apply(frame);
    assert.deepEqual(actual, reduceAssistantMessageFrames(replay));
    assert.equal(JSON.stringify(previous), frozen, 'published snapshots remain immutable');
    previous = actual;
  }
  assert.equal(JSON.stringify(frames).includes('"partial"'), false);
  assert.deepEqual(message.content, [], 'start header is not mutated');
});

test('compact projection rejects missing starts, block gaps, kind mismatches and updates after block end', () => {
  assert.throws(() => new ProgressReducer().apply({ type: 'text_delta', contentIndex: 0, delta: 'tail' }), /start/);
  const reducer = new ProgressReducer(); reducer.apply({ type: 'start', message: { ...assistant('', 'pending'), content: [] } });
  assert.throws(() => reducer.apply({ type: 'text_start', contentIndex: 1, content: { type: 'text', text: '' } }), /start/);
  reducer.apply({ type: 'text_start', contentIndex: 0, content: { type: 'text', text: '' } });
  assert.throws(() => reducer.apply({ type: 'thinking_delta', contentIndex: 0, delta: 'wrong' }), /update/);
  reducer.apply({ type: 'text_end', contentIndex: 0, content: 'whole' });
  assert.throws(() => reducer.apply({ type: 'text_delta', contentIndex: 0, delta: 'late' }), /update/);
});
