import assert from 'node:assert/strict';
import test from 'node:test';
import { GroupClient, type GroupEntry } from '../src/client/group-client.js';
import { workingItems, mentionAt, mentionToken } from '../src/ui/group-work.js';
import { assistant, record, run, streamResponse, until, agentId, runId } from './fixtures.js';
const workspaceId = 'w1';
const user: GroupEntry = { workspaceId, entryId: 'u1', position: 1, revision: 1, exchangeId: 'e1', time: 1, kind: 'user', messageId: 'u1', text: 'work' };
const member: Extract<GroupEntry, { kind: 'member' }> = { workspaceId, entryId: runId, position: 2, revision: 2, exchangeId: 'e1', time: 1, kind: 'member', memberId: agentId, name: 'Backend', run: run(), working: { after: 0, through: null }, finalRef: null, text: null };
const frame = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ version: 1, workspaceId, type, ...data })}\n\n`;
const change = (cursor: number, entry: GroupEntry) => frame('entry', { change: { cursor, entry } });

test('POST reserves immediately without skipping unseen changes; stale acknowledgement cannot replace a final', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  let accept!: (response: Response) => void;
  const ack = new Promise<Response>(resolve => { accept = resolve; });
  const client = new GroupClient(workspaceId, { fetcher: async (_url, init) => init?.method === 'POST' ? ack : streamResponse(body) });
  client.follow();
  const pending = client.send('work');
  controller.enqueue(new TextEncoder().encode(change(1, user) + change(2, member) + frame('sync', { cursor: 2 })));
  await until(() => client.getSnapshot().cursor === 2);
  const completed: GroupEntry = { ...member, revision: 3, run: run('completed'), working: { after: 0, through: 1 }, finalRef: { agentId, runId, messageId: 'final', position: 1 }, text: '# Finished' };
  controller.enqueue(new TextEncoder().encode(change(3, completed)));
  await until(() => client.getSnapshot().cursor === 3);
  accept(new Response(JSON.stringify({ entries: [user, member] }), { status: 202 }));
  await pending;
  assert.equal(client.getSnapshot().entries.length, 2);
  assert.equal(client.getSnapshot().entries[1]!.revision, 3);
  assert.equal(client.getSnapshot().entries[1]!.position, 2);
  client.dispose(); controller.close();
});

test('acknowledgement ahead of feed does not advance cursor; reconnect fills gaps and updates older positions', async () => {
  const requests: string[] = [];
  let hold!: ReadableStreamDefaultController<Uint8Array>;
  const retained = new ReadableStream<Uint8Array>({ start(value) { hold = value; } });
  const later: GroupEntry = { ...user, entryId: 'u2', messageId: 'u2', position: 3, revision: 3, text: 'later' };
  const done: GroupEntry = { ...member, revision: 4, run: run('cancelled'), working: { after: 0, through: 1 } };
  let follows = 0;
  const client = new GroupClient(workspaceId, { retryDelayMs: () => 0, fetcher: async (url, init) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ entries: [later] }), { status: 202 });
    requests.push(String(url)); follows++;
    return follows === 1 ? streamResponse(change(1, user) + change(2, member) + frame('sync', { cursor: 2 })) : streamResponse(retained);
  } });
  await client.send('later'); assert.equal(client.getSnapshot().cursor, 0);
  client.follow();
  await until(() => requests.length === 2);
  assert.match(requests[1]!, /after=2$/);
  hold.enqueue(new TextEncoder().encode(change(3, later) + change(4, done) + frame('sync', { cursor: 4 })));
  await until(() => client.getSnapshot().cursor === 4);
  assert.deepEqual(client.getSnapshot().entries.map(entry => entry.entryId), ['u1', runId, 'u2']);
  assert.equal(client.getSnapshot().entries[1]!.revision, 4);
  client.dispose(); hold.close();
});

test('refusal leaves no optimistic entry; malformed/gapped updates stop without advancing cursor', async () => {
  const client = new GroupClient(workspaceId, { fetcher: async (_url, init) => init?.method === 'POST'
    ? new Response(JSON.stringify({ error: { code: 'member_busy', message: 'Backend is working' } }), { status: 409 })
    : streamResponse(change(2, member)) });
  await assert.rejects(client.send('work'), /Backend is working/);
  assert.equal(client.getSnapshot().entries.length, 0);
  assert.match(client.getSnapshot().commandError!, /working/);
  client.follow(); await until(() => client.getSnapshot().connection === 'error');
  assert.equal(client.getSnapshot().cursor, 0); client.dispose();
});

test('working projection respects run/range, retains rejected candidates, and excludes only accepted final text', () => {
  const old = { ...record(1, 'old', 'old'), runId: 'old_run' };
  const candidate = record(2, 'candidate', 'private rejected candidate');
  const final = record(3, 'final', 'accepted final');
  final.message = { ...final.message, content: [{ type: 'thinking', thinking: 'last reasoning' }, { type: 'text', text: 'accepted final' }] } as typeof final.message;
  const next = { ...record(4, 'next', 'next'), runId: 'next_run' };
  const snapshot = { agentId, completed: [old, candidate, final, next], live: [], historyPosition: 4, synchronized: true, connection: 'idle' as const, run: run('completed'), sending: false, error: null };
  const entry = { ...member, working: { after: 1, through: 3 }, finalRef: { agentId, runId, messageId: 'final', position: 3 }, text: 'accepted final' };
  const before = structuredClone(snapshot);
  assert.deepEqual(workingItems(snapshot, entry).map(item => item.text), ['private rejected candidate', 'last reasoning']);
  assert.deepEqual(snapshot, before);
});

test('mention insertion uses braces for spaces and does not suggest for email addresses', () => {
  assert.equal(mentionToken('Frontend Worker'), '@{Frontend Worker}');
  assert.equal(mentionToken('Backend'), '@Backend');
  assert.equal(mentionAt('mail@example', 12), null);
  assert.deepEqual(mentionAt('Hi @Back', 8), { start: 3, query: 'Back' });
});

test('private working tools pair reused IDs with their own chronological result', () => {
  const call = (position: number) => ({ ...record(position, `call-${position}`, ''), message: { ...assistant(''), content: [{ type: 'toolCall' as const, id: 'reused', name: 'read', arguments: { path: String(position) } }] } });
  const result = (position: number, text: string) => ({ ...record(position, `result-${position}`, ''), message: { role: 'toolResult' as const, toolCallId: 'reused', toolName: 'read', content: [{ type: 'text' as const, text }], isError: false, timestamp: 1 } });
  const snapshot = { agentId, completed: [call(1), result(2, 'first result'), call(3), result(4, 'second result')], live: [], historyPosition: 4, synchronized: true, connection: 'idle' as const, run: run('completed'), sending: false, error: null };
  assert.deepEqual(workingItems(snapshot, { ...member, working: { after: 0, through: 4 } }).map(item => item.result), ['first result', 'second result']);
});
