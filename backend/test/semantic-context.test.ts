import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactedContext } from '../src/core/agent/data/compaction.js';
import type { ContextEntry } from '../src/core/agent/data/model.js';
import type { GroupContextReference, GroupSemanticIndex } from '../src/core/agent/data/context.js';
import { groupEntry, groupSender, type ChatMessage } from '../src/core/team/data/group-chat.js';

function message(position: number, text: string): ChatMessage {
  return { workspaceId: 'workspace', messageId: `g${position}`, position, exchangeId: `e${position}`, author: { type: 'user' }, text, recipients: [], time: position };
}
function shared(position: number, text: string): { position: number; entry: ContextEntry; sender: string } {
  const value = message(position, text);
  return { position, entry: groupEntry(value), sender: groupSender(value) };
}
function context(items: ReturnType<typeof shared>[]): ContextEntry[] {
  return items.map(item => ({ ...structuredClone(item.entry), metadata: { ...item.entry.metadata, groupContextId: 'workspace', groupPosition: item.position } }));
}
function reference(items: ReturnType<typeof shared>[], semantic: GroupSemanticIndex): GroupContextReference {
  return { id: 'workspace', read: async after => items.filter(item => item.position > after), semantic: async () => structuredClone(semantic) };
}
function index(tree: GroupSemanticIndex['tree'], through: number): GroupSemanticIndex {
  return { revision: 1, from: 1, through, sourceDigest: '0'.repeat(64), tree };
}

test('semantic compaction replaces an uninvolved range with its summary', async () => {
  const items = [shared(1, 'private database details'), shared(2, 'deployment details')];
  const result = await compactedContext('backend', { revision: 1, entries: context(items) }, [], reference(items, index([{ id: 'scope', firstPosition: 1, lastPosition: 2, topic: 'Database', summary: 'The team selected an isolated database.', involvedMemberIds: [], children: [] }], 2)));
  assert.equal(result.length, 1);
  assert.match(String(result[0]!.message.content), /The team selected an isolated database/);
  assert.doesNotMatch(JSON.stringify(result), /private database details/);
});

test('semantic compaction opens involved internal ranges and preserves involved leaves', async () => {
  const items = [shared(1, 'unrelated details'), shared(2, 'backend implementation request')];
  const tree = [{ id: 'root', firstPosition: 1, lastPosition: 2, topic: 'Project', summary: 'Project work.', involvedMemberIds: ['backend'], children: [
    { id: 'unrelated', firstPosition: 1, lastPosition: 1, topic: 'Other', summary: 'Other work.', involvedMemberIds: [], children: [] },
    { id: 'owned', firstPosition: 2, lastPosition: 2, topic: 'Backend', summary: 'Backend work.', involvedMemberIds: ['backend'], children: [] },
  ] }];
  const result = await compactedContext('backend', { revision: 1, entries: context(items) }, [], reference(items, index(tree, 2)));
  assert.equal(result.length, 2);
  assert.match(String(result[0]!.message.content), /Other work/);
  assert.match(JSON.stringify(result[1]), /backend implementation request/);
});

test('semantic compaction falls back to original messages beyond the analyzed boundary', async () => {
  const items = [shared(1, 'analyzed details'), shared(2, 'new uncovered details')];
  const result = await compactedContext('backend', { revision: 1, entries: context(items) }, [], reference(items, index([{ id: 'scope', firstPosition: 1, lastPosition: 1, topic: 'Old', summary: 'Old summary.', involvedMemberIds: [], children: [] }], 1)));
  assert.equal(result.length, 2);
  assert.match(String(result[0]!.message.content), /Old summary/);
  assert.match(JSON.stringify(result[1]), /new uncovered details/);
});
