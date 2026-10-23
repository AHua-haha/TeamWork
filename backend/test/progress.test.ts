import assert from 'node:assert/strict';
import test from 'node:test';
import { AssistantMessageFrameEncoder, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { ProgressStore } from '../src/core/agent/progress.js';

const delta = (text: string) => ({ type: 'text_delta' as const, contentIndex: 0, delta: text });
test('per-member FIFO overlaps completed messages, evicts without readers, and preserves start boundaries', () => {
  const store = new ProgressStore(3);
  store.begin('a', 'r', 'm1', 7);
  store.append('a', { type: 'start', message: { ...fauxAssistantMessage(''), content: [], stopReason: 'pending' } });
  store.append('a', delta('old')); store.settle('a', 'r');
  store.begin('a', 'r', 'm2', 8);
  store.append('a', { type: 'start', message: { ...fauxAssistantMessage(''), content: [], stopReason: 'pending' } });
  assert.equal(store.read('a', 'r', 'm1')!.firstAvailable, 0, 'completed events overlap a subsequent message');
  store.append('a', delta('new'));
  assert.equal(store.read('a', 'r', 'm1')!.firstAvailable, 1);
  assert.equal(store.read('a', 'r', 'm2')!.historyPositionBeforeMessage, 8);
  store.append('a', delta('tail'));
  assert.equal(store.read('a', 'r', 'm1'), undefined);
  store.append('a', delta('more'));
  assert.equal(store.read('a', 'r', 'm2')!.firstAvailable, 1);
  store.begin('b', 's', 'other', 1); store.append('b', delta('independent'));
  assert.equal(store.read('a', 'r', 'm2')!.chunks.length, 3);
  store.clear('a'); assert.equal(store.read('a', 'r', 'm2'), undefined);
  assert.equal(store.read('b', 's', 'other')!.chunks.length, 1);
});

test('progress wakeups do not announce SQL changes and zero capacity still detects eviction', () => {
  const store = new ProgressStore(0); store.begin('a', 'r', 'm', 1);
  const before = store.lane('a').durable, version = store.lane('a').changes.version;
  store.append('a', delta('x'));
  assert.equal(store.lane('a').durable, before);
  assert.ok(store.lane('a').changes.version > version);
  assert.deepEqual(store.read('a', 'r', 'm'), { firstAvailable: 1, nextSequence: 1, historyPositionBeforeMessage: 1, chunks: [] });
});

test('Pi compact conversion owns immutable data and does not repeat growing cumulative partials', () => {
  const encoder = new AssistantMessageFrameEncoder(), partial = fauxAssistantMessage('');
  partial.stopReason = 'pending';
  const start = encoder.encode({ type: 'start', partial })!;
  const block = partial.content[0]!; if (block.type !== 'text') throw new Error('text required');
  const first = encoder.encode({ type: 'text_start', contentIndex: 0, partial })!;
  const events = [start.type === 'start' ? { type: 'start', message: start.partial } : start, first];
  for (let i = 0; i < 2000; i++) {
    block.text += 'a';
    const frame = encoder.encode({ type: 'text_delta', contentIndex: 0, delta: 'a', partial });
    if (frame) events.push(frame);
  }
  assert.equal(events[0]!.type, 'start');
  assert.equal(first.type === 'text_start' && first.content.text, '');
  const wire = JSON.stringify(events);
  assert.equal(wire.includes('"partial"'), false);
  assert.ok(wire.length < 200_000, `${wire.length} should grow with deltas, not accumulated response size`);
});

test('late finalization of an earlier run cannot clear a successor run progress', () => {
  const store = new ProgressStore(); store.begin('a', 'new-run', 'new-message', 9);
  store.append('a', delta('new')); store.settle('a', 'old-run');
  store.append('a', delta('still running'));
  assert.equal(store.read('a', 'new-run', 'new-message')!.nextSequence, 2);
});
