/** Deterministic payload comparison, no model/network calls or SQL mutation. */
import assert from 'node:assert/strict';
import { AssistantMessageFrameEncoder, fauxAssistantMessage } from '../../../backend/node_modules/@earendil-works/pi-ai/dist/index.js';
import { ProgressStore } from '../../../backend/src/progress.js';
const encoder = new AssistantMessageFrameEncoder(), buffer = new ProgressStore();
const partial = fauxAssistantMessage(''); partial.stopReason = 'pending';
let oldBytes = 0, compactBytes = 0;
buffer.begin('member', 'run', 'message', 1);
const start = encoder.encode({ type: 'start', partial })!;
if (start.type !== 'start') throw new Error('start required');
buffer.append('member', { type: 'start', message: start.partial });
const first = encoder.encode({ type: 'text_start', contentIndex: 0, partial })!;
if (first.type === 'start') throw new Error('block required');
buffer.append('member', first);
const block = partial.content[0]!; if (block.type !== 'text') throw new Error('text required');
for (let i = 0; i < 2000; i++) {
  const delta = 'A compact stream payload sample. ';
  block.text += delta;
  const event = { type: 'text_delta' as const, contentIndex: 0, delta, partial };
  oldBytes += Buffer.byteLength(JSON.stringify(event));
  const frame = encoder.encode(event)!; if (frame.type === 'start') throw new Error('delta required');
  compactBytes += Buffer.byteLength(JSON.stringify(frame)); buffer.append('member', frame);
}
const retained = buffer.read('member', 'run', 'message')!;
assert.equal(retained.chunks.length, 1024); assert.equal(retained.firstAvailable, 978);
assert.ok(compactBytes < oldBytes / 100);
console.log(JSON.stringify({ events: 2000, textCharacters: block.text.length, oldEventPayloadBytes: oldBytes, compactEventPayloadBytes: compactBytes, reductionPercent: Number((100 * (1 - compactBytes / oldBytes)).toFixed(2)), retainedEvents: retained.chunks.length, caveat: 'Synthetic payload comparison; live laptop CPU reduction depends on workload. SQL-free progress is separately verified against real MySQL.' }, null, 2));
