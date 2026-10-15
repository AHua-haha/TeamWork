import assert from 'node:assert/strict';
import test from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { finalAnswer, textPhase } from '../src/final-answer.js';

const text = (value: string, phase?: string) => ({ type: 'text' as const, text: value, ...(phase ? { textSignature: JSON.stringify({ v: 1, id: 'native', phase }) } : {}) });

test('natural completion without native phase selects exact text blocks, excluding thinking', () => {
  assert.deepEqual(finalAnswer(fauxAssistantMessage([{ type: 'thinking', thinking: 'private' }, text('Answer'), text('More')])), { text: 'Answer\nMore', contentIndices: [1, 2] });
});

test('native final phase selects only final blocks while native commentary alone continues', () => {
  assert.equal(finalAnswer(fauxAssistantMessage([text('Working', 'commentary')])), null);
  assert.deepEqual(finalAnswer(fauxAssistantMessage([text('Working', 'commentary'), text('Unknown'), text('Answer', 'final_answer')])), { text: 'Answer', contentIndices: [2] });
  assert.deepEqual(finalAnswer(fauxAssistantMessage([text('Working', 'commentary'), text('Answer')])), { text: 'Answer', contentIndices: [1] });
});

test('tool-bearing, pending, truncated, aborted and empty output never selects a final answer', () => {
  for (const stopReason of ['pending', 'length', 'aborted', 'error', 'toolUse'] as const) assert.equal(finalAnswer(fauxAssistantMessage('Looks final', { stopReason })), null);
  assert.equal(finalAnswer(fauxAssistantMessage([text('Looks final', 'final_answer'), { type: 'toolCall', id: 'read', name: 'read', arguments: {} }])), null);
  assert.equal(finalAnswer(fauxAssistantMessage(' ')), null);
});

test('opaque or unsupported signatures do not invent a native phase', () => {
  assert.equal(textPhase({ ...text('Answer'), textSignature: 'opaque-provider-signature' }), undefined);
  assert.equal(textPhase(text('Answer', 'not-a-phase')), undefined);
});
