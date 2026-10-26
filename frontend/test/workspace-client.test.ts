import assert from 'node:assert/strict';
import test from 'node:test';
import { BackendError } from '../src/shared/backend-client/agent-client.js';
import { ContextFeed, WorkspaceClient, type ChangeRecord } from '../src/shared/backend-client/workspace-client.js';
import { streamResponse, until } from './fixtures.js';

const workspaceId = 'w 1';
const models = { models: [{ connectionId: 'main', modelId: 'm1' }], defaultModel: { connectionId: 'main', modelId: 'm1' } };
const user = { type: 'user' } as const;

function change(seq: number, path = `user/${seq}.md`): ChangeRecord {
  return { seq, time: seq, author: user, reason: null, files: [{ action: 'update', path, fromPath: null, revision: `r${seq}` }] };
}

function frame(value: { type: 'record'; record: ChangeRecord } | { type: 'sync'; seq: number } | { type: 'stream_error'; message: string }, id = workspaceId): string {
  return `event: ${value.type}\ndata: ${JSON.stringify({ version: 1, workspaceId: id, ...value })}\n\n`;
}

/** A stream that stays open until the feed aborts its request, like a live backend connection. */
function openStream(text: string, signal: AbortSignal | null | undefined): Response {
  return streamResponse(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    },
  }));
}

test('workspace client sends paths, queries and bodies in the backend format', async () => {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const api = new WorkspaceClient((async (input, init) => {
    calls.push({ path: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(input) === '/workspaces') return new Response(JSON.stringify({ workspaces: [] }));
    return new Response(JSON.stringify({}));
  }) as typeof fetch);
  assert.deepEqual(await api.listWorkspaces(), []);
  await api.createWorkspace({ name: 'Billing', directory: '/srv/billing', adopt: true, models });
  await api.projectTree(workspaceId, 'src');
  await api.saveProject(workspaceId, 'docs/a b.md', 'text', null);
  await api.contextTree(workspaceId, 'user', 2);
  await api.readContext(workspaceId, { revision: 'abc' });
  await api.saveContext(workspaceId, 'user/notes.md', 'hello', 'r1', 'Restored');
  await api.moveContext(workspaceId, 'user/a', 'user/b');
  await api.deleteContext(workspaceId, 'user/b', 'r2');
  await api.contextHistory(workspaceId, 'user/notes.md');
  await api.contextHistory(workspaceId, 'user/notes.md', 7, 20);
  await api.findContext(workspaceId, 'note');
  await api.searchContext(workspaceId, 'todo');
  await api.searchContext(workspaceId, 'todo', 'user');
  assert.deepEqual(calls, [
    { path: '/workspaces', method: 'GET', body: undefined },
    { path: '/workspaces', method: 'POST', body: { name: 'Billing', directory: '/srv/billing', adopt: true, models } },
    { path: '/workspaces/w%201/files/tree?path=src&depth=1', method: 'GET', body: undefined },
    { path: '/workspaces/w%201/files/file?path=docs%2Fa+b.md', method: 'PUT', body: { content: 'text', baseRevision: null } },
    { path: '/workspaces/w%201/context/tree?path=user&depth=2', method: 'GET', body: undefined },
    { path: '/workspaces/w%201/context/file?revision=abc', method: 'GET', body: undefined },
    { path: '/workspaces/w%201/context/file?path=user%2Fnotes.md', method: 'PUT', body: { content: 'hello', baseRevision: 'r1', reason: 'Restored' } },
    { path: '/workspaces/w%201/context/move', method: 'POST', body: { from: 'user/a', to: 'user/b' } },
    { path: '/workspaces/w%201/context/delete', method: 'POST', body: { path: 'user/b', baseRevision: 'r2' } },
    { path: '/workspaces/w%201/context/history?path=user%2Fnotes.md', method: 'GET', body: undefined },
    { path: '/workspaces/w%201/context/history?path=user%2Fnotes.md&before=7&limit=20', method: 'GET', body: undefined },
    { path: '/workspaces/w%201/context/find?q=note', method: 'GET', body: undefined },
    { path: '/workspaces/w%201/context/search?q=todo', method: 'GET', body: undefined },
    { path: '/workspaces/w%201/context/search?q=todo&path=user', method: 'GET', body: undefined },
  ]);
});

test('workspace client exposes backend error codes for conflict handling', async () => {
  const api = new WorkspaceClient((async () => new Response(JSON.stringify({ error: { code: 'stale_revision', message: 'The file changed' } }), { status: 409 })) as typeof fetch);
  await assert.rejects(api.saveContext(workspaceId, 'user/a.md', 'x', 'r1'), error => error instanceof BackendError && error.status === 409 && error.code === 'stale_revision');
});

test('context feed replays records after its seq in order and then follows', async () => {
  const requests: string[] = [];
  const feed = new ContextFeed(workspaceId, 3, { fetcher: async (input, init) => {
    requests.push(String(input));
    return openStream(frame({ type: 'record', record: change(4) }) + frame({ type: 'record', record: change(5) }) + frame({ type: 'sync', seq: 5 }), init?.signal);
  } });
  const seen: number[] = [];
  feed.onRecord(record => seen.push(record.seq));
  let notified = 0;
  feed.subscribe(() => notified++);
  feed.start();
  await until(() => feed.getSnapshot().connection === 'following');
  assert.deepEqual(seen, [4, 5]);
  assert.deepEqual(feed.getSnapshot(), { seq: 5, connection: 'following', error: null });
  assert.ok(notified >= 3);
  feed.dispose();
  assert.deepEqual(requests, ['/workspaces/w%201/context/follow?after=3']);
});

test('context feed retries a stream error from the last applied seq', async () => {
  const requests: string[] = [];
  const states: string[] = [];
  const responses = [
    () => streamResponse(frame({ type: 'record', record: change(2) }) + frame({ type: 'stream_error', message: 'Database unavailable' })),
  ];
  // Later connections replay nothing new and stay open.
  const feed = new ContextFeed(workspaceId, 1, { fetcher: async (input, init) => {
    requests.push(String(input));
    return (responses.shift() ?? (() => openStream(frame({ type: 'sync', seq: 2 }), init?.signal)))();
  }, retryDelayMs: () => 0 });
  feed.subscribe(() => states.push(feed.getSnapshot().connection));
  feed.start();
  await until(() => feed.getSnapshot().connection === 'following');
  assert.deepEqual(requests, ['/workspaces/w%201/context/follow?after=1', '/workspaces/w%201/context/follow?after=2']);
  assert.ok(states.includes('disconnected'));
  feed.dispose();
});

test('context feed stops on a gap, a wrong sync position, or a client error', async () => {
  const cases: [string, () => Response, RegExp][] = [
    ['gap', () => streamResponse(frame({ type: 'record', record: change(3) })), /gap/],
    ['sync', () => streamResponse(frame({ type: 'sync', seq: 4 })), /sync position/],
    ['workspace', () => streamResponse(frame({ type: 'sync', seq: 1 }, 'other')), /Unsupported change event/],
    ['not found', () => new Response(JSON.stringify({ error: { code: 'not_found', message: 'Workspace not found' } }), { status: 404 }), /Workspace not found/],
  ];
  for (const [name, respond, message] of cases) {
    let requests = 0;
    const feed = new ContextFeed(workspaceId, 1, { fetcher: async () => { requests++; return respond(); }, retryDelayMs: () => 0 });
    feed.start();
    await until(() => feed.getSnapshot().connection === 'error');
    assert.equal(requests, 1, name);
    assert.match(feed.getSnapshot().error!, message, name);
    assert.equal(feed.getSnapshot().seq, 1, name);
    feed.dispose();
  }
});


test('workspace client reviews initialization and sends cleanup consent only when explicitly supplied', async () => {
  const calls:{path:string; body:unknown}[]=[];
  const review={directory:'/srv/existing',cleanupPaths:['.rsi/members'],cleanupRevision:'a'.repeat(64)};
  const client=new WorkspaceClient((async(input,init)=>{
    calls.push({path:String(input),body:JSON.parse(String(init?.body))});
    return new Response(JSON.stringify(String(input).endsWith('/initialization')?review:{}));
  }) as typeof fetch);
  assert.deepEqual(await client.inspectInitialization({directory:'/srv/existing',adopt:true}),review);
  assert.equal(calls.length,1); // A review alone never creates or cleans a workspace.
  await client.createWorkspace({name:'Existing',directory:review.directory,adopt:true,models,cleanupRevision:review.cleanupRevision});
  assert.deepEqual(calls,[
    {path:'/workspaces/initialization',body:{directory:'/srv/existing',adopt:true}},
    {path:'/workspaces',body:{name:'Existing',directory:'/srv/existing',adopt:true,models,cleanupRevision:review.cleanupRevision}},
  ]);
});
