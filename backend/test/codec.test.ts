import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, Type } from '@earendil-works/pi-ai';
import { decode, encode, validateEntries } from '../src/core/codec.js';
import type { ContextEntry } from '../src/core/types.js';

test('versioned JSON preserves Pi content, opaque fields and runtime metadata', () => {
  const entries: ContextEntry[] = [
    { messageId: 'system', message: { role: 'system', content: 'instructions', timestamp: 0, toolsAdded: [{ name: 'echo', description: 'Echo', parameters: Type.Object({ value: Type.String() }) }] }, metadata: {} },
    { messageId: 'user', message: { role: 'user', content: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }], timestamp: 1 }, metadata: { nested: { retained: [true, null, 3] } } },
    { messageId: 'assistant', message: fauxAssistantMessage([{ type: 'thinking', thinking: 'reason', thinkingSignature: 'opaque' }, { type: 'text', text: 'Hi', textSignature: 'signature' }, { type: 'toolCall', id: 'call-1', name: 'echo', arguments: { value: 'hi' }, thoughtSignature: 'keep' }]), metadata: { compact: false } },
    { messageId: 'result', message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'echo', content: [{ type: 'text', text: 'hi' }], isError: false, details: { private: 'runtime' }, timestamp: 2 }, metadata: {} },
  ];
  assert.deepEqual(decode(encode(entries), validateEntries), entries);
});

test('rejects lossy values, unsupported versions and unknown content without silently dropping it', () => {
  for (const value of [NaN, Infinity, 1n, () => 1, new Date(), [undefined]]) assert.throws(() => encode(value));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => encode(cyclic));
  assert.throws(() => decode('{"version":2,"data":[]}', validateEntries), /schema version/);
  assert.throws(() => decode('{bad', validateEntries), /deserialize/);
  assert.throws(() => validateEntries([{ messageId: 'x', message: { role: 'user', timestamp: 1, content: [{ type: 'audio', data: 'opaque' }] }, metadata: {} }]), /content block/);
});
