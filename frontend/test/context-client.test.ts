import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BackendError } from '../src/shared/backend-client/agent-client.js';
import { ProtocolError } from '../src/shared/backend-client/sse.js';
import { ContextClient } from '../src/shared/backend-client/context-client.js';

const samplePage = { revision: 7, offset: 10, total: 31, nextOffset: 20, entries: [{ messageId: 'entry-x', message: { role: 'user', content: 'hello', timestamp: 0 }, metadata: { kind: 'user' } }] };

test('group context preserves backend page shape, pagination and read-only no-cache request', async () => {
  let requested = '';
  let init: RequestInit | undefined;
  const client = new ContextClient(async (input, options) => {
    requested = String(input); init = options;
    return Response.json(samplePage);
  });
  const result = await client.group('ws-1', { offset: 10, limit: 10, revision: 7 });
  assert.deepEqual(result, samplePage);
  assert.equal(requested, '/workspaces/ws-1/team/chat/context?offset=10&limit=10&revision=7');
  assert.equal(init?.method, 'GET');
  assert.equal((init?.headers as Record<string, string>)['Cache-Control'], 'no-cache');
});

test('member context encodes workspace and member IDs and omits unset pagination values', async () => {
  let requested = '';
  const client = new ContextClient(async input => { requested = String(input); return Response.json({ ...samplePage, offset: 0 }); });
  const result = await client.member('ws-2', 'member_3');
  assert.equal(requested, '/workspaces/ws-2/team/members/member_3/context');
  assert.equal(result.revision, samplePage.revision);
  assert.deepEqual(result.entries, samplePage.entries);
});

test('stale context revision preserves explicit context_changed backend error', async () => {
  const client = new ContextClient(async () => Response.json({ error: { code: 'context_changed', message: 'Context changed; refresh' } }, { status: 409 }));
  await assert.rejects(client.group('ws-1', { offset: 10, revision: 6 }), error => error instanceof BackendError && error.status === 409 && error.code === 'context_changed');
});

test('malformed context pages are protocol errors and invalid identities are rejected', async () => {
  const invalidPageClient = new ContextClient(async () => Response.json({ revision: 1, offset: 0, total: 1, nextOffset: 1, entries: 'bad' }));
  await assert.rejects(invalidPageClient.group('ws-1'), ProtocolError);
  const client = new ContextClient(async () => Response.json(samplePage));
  assert.throws(() => client.member('ws-1', '../bad'), /Invalid context identity/);
});

test('summary inspection preserves text and coverage and empty results using read-only requests', async () => {
  const summary = { revision: 3, from: 1, through: 10, analyzedThrough: 40, sourceDigest: 'a'.repeat(64), text: 'Agreed goals and outstanding work', messageId: 'summary-3', time: 1 };
  let requested = ''; let init: RequestInit | undefined;
  const client = new ContextClient(async (url, options) => { requested = String(url); init = options; return Response.json({ summary, retainedMessages: 30 }); });
  assert.deepEqual(await client.summary('ws-1'), { summary, retainedMessages: 30 });
  assert.equal(requested, '/workspaces/ws-1/team/chat/summary');
  assert.equal(init?.method, 'GET');
  assert.equal((init?.headers as Record<string, string>)['Cache-Control'], 'no-cache');
  assert.deepEqual(await new ContextClient(async () => Response.json({ summary: null, retainedMessages: 30 })).summary('ws-1'), { summary: null, retainedMessages: 30 });
});

test('summary inspection rejects malformed coverage and preserves server failures', async () => {
  for (const payload of [{}, {summary:null}, {summary:{revision:1,from:1,through:2,analyzedThrough:3,text:'bad'},retainedMessages:30}]) {
    await assert.rejects(new ContextClient(async () => Response.json(payload)).summary('ws-1'), ProtocolError);
  }
  const client = new ContextClient(async () => Response.json({ error: { code: 'not_found', message: 'Workspace not found' } }, { status: 404 }));
  await assert.rejects(client.summary('ws-1'), error => error instanceof BackendError && error.code === 'not_found');
  await assert.rejects(client.summary('../bad'), /Invalid workspace identity/);
});
