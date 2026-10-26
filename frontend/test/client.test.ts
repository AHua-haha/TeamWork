import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentClient } from '../src/shared/backend-client/agent-client.js';
import { ProtocolError, readSse } from '../src/shared/backend-client/sse.js';
import { agentId, assistant, event, record, run, runId, streamResponse, until } from './fixtures.js';
import type { FollowEvent } from '../src/shared/backend-client/protocol.js';

const base = { version: 2 as const, agentId, runId };

test('SSE parser accepts split UTF-8, CRLF, comments and multiline data', async () => {
  const bytes = new TextEncoder().encode(': ping\r\nevent: note\r\ndata: café\r\ndata: next\r\n\r\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } });
  const frames = [];
  for await (const frame of readSse(body)) frames.push(frame);
  assert.deepEqual(frames, [{ name: 'note', data: 'café\nnext' }]);
});

test('completed history syncs, deduplicates on refresh and ends without polling', async () => {
  const requests: string[] = [];
  const completed = run('completed');
  const payloads = [
    event({ ...base, type: 'message', record: record(1, 'm1', 'Hello') }) + event({ ...base, type: 'sync', historyPosition: 1, run: completed }) + event({ ...base, type: 'end', historyPosition: 1, run: completed }),
    event({ ...base, type: 'sync', historyPosition: 1, run: completed }) + event({ ...base, type: 'end', historyPosition: 1, run: completed }),
  ];
  const client = new AgentClient(agentId, { fetcher: async input => {
    requests.push(String(input));
    return streamResponse(payloads.shift()!);
  } });
  client.follow();
  await until(() => client.getSnapshot().connection === 'idle' && client.getSnapshot().synchronized);
  assert.equal(client.getSnapshot().completed[0]?.messageId, 'm1');
  assert.equal(requests.length, 1);
  client.refresh();
  await until(() => client.getSnapshot().connection === 'idle' && requests.length === 2);
  assert.equal(client.getSnapshot().completed.length, 1);
  assert.match(requests[1]!, /after=1/);
  client.dispose();
});

test('compact deltas keep one live identity until a persisted record replaces it', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const client = new AgentClient(agentId, { fetcher: async () => streamResponse(body) });
  const push = (value: FollowEvent) => controller.enqueue(new TextEncoder().encode(event(value)));
  client.follow(runId);
  push({ ...base, type: 'sync', historyPosition: 0, run: run() });
  push({ ...base, type: 'chunk', messageId: 'm1', sequence: 0, event: { type: 'start', message: {...assistant('', 'pending'),content:[]} } });
  push({ ...base, type: 'chunk', messageId: 'm1', sequence: 1, event: { type: 'text_start', contentIndex: 0, content: { type: 'text', text: '' } } });
  push({ ...base, type: 'chunk', messageId: 'm1', sequence: 2, event: { type: 'text_delta', contentIndex: 0, delta: 'Hello' } });
  await until(() => {
    const block = client.getSnapshot().live[0]?.message.content[0];
    return block?.type === 'text' && block.text === 'Hello';
  });
  assert.equal(client.getSnapshot().live.length, 1);
  assert.equal(client.getSnapshot().live[0]?.lastEvent.type, 'text_delta');
  assert.equal(client.getSnapshot().completed.length, 0, 'progress is not persistence');
  push({ ...base, type: 'message', record: record(1, 'm1', 'Hello!') });
  push({ ...base, type: 'end', historyPosition: 1, run: run('completed') });
  controller.close();
  await until(() => client.getSnapshot().connection === 'idle');
  assert.equal(client.getSnapshot().completed[0]?.messageId, 'm1');
  assert.equal(client.getSnapshot().live.length, 0);
  client.dispose();
});

test('gap discards partial and waits for completed message', async () => {
  const payload = event({ ...base, type: 'sync', historyPosition: 0, run: run() })
    + event({ ...base, type: 'chunk', messageId: 'm1', sequence: 0, event: { type: 'start', message: {...assistant('', 'pending'),content:[]} } })
    + event({ ...base, type: 'chunk', messageId: 'm1', sequence: 1, event: { type: 'text_start', contentIndex: 0, content: { type: 'text', text: 'abc' } } })
    + event({ ...base, type: 'gap', messageId: 'm1', expectedSequence: 2, firstAvailable: 5 })
    + event({ ...base, type: 'chunk', messageId: 'm1', sequence: 5, event: { type: 'text_delta', contentIndex: 0, delta: 'z' } })
    + event({ ...base, type: 'message', record: record(1, 'm1', 'complete') })
    + event({ ...base, type: 'end', historyPosition: 1, run: run('completed') });
  const client = new AgentClient(agentId, { fetcher: async () => streamResponse(payload) });
  client.follow(runId);
  await until(() => client.getSnapshot().connection === 'idle');
  assert.equal(client.getSnapshot().completed[0]?.message.role, 'assistant');
  assert.equal(client.getSnapshot().live.length, 0);
  client.dispose();
});

test('unexpected EOF clears partials, reconnects with completed cursor, then ends', async () => {
  const requests: string[] = [];
  const responses = [
    event({ ...base, type: 'sync', historyPosition: 0, run: run() }) + event({ ...base, type: 'chunk', messageId: 'm1', sequence: 0, event: { type: 'start', message: {...assistant('old', 'pending'),content:[]} } }),
    event({ ...base, type: 'message', record: record(1, 'm1', 'complete') }) + event({ ...base, type: 'sync', historyPosition: 1, run: run('completed') }) + event({ ...base, type: 'end', historyPosition: 1, run: run('completed') }),
  ];
  const client = new AgentClient(agentId, { fetcher: async input => {
    requests.push(String(input));
    return streamResponse(responses.shift()!);
  }, retryDelayMs: () => 0 });
  client.follow(runId);
  await until(() => client.getSnapshot().connection === 'idle');
  assert.equal(requests.length, 2);
  assert.equal(client.getSnapshot().completed[0]?.messageId, 'm1');
  assert.equal(client.getSnapshot().live.length, 0);
  client.dispose();
});

test('submit sends only user input, follows accepted run, and cancellation is a backend command', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const client = new AgentClient(agentId, { fetcher: async (input, init) => {
    calls.push({ url: String(input), init });
    if (init?.method === 'POST' && String(input).endsWith('/runs')) return new Response(JSON.stringify({ runId, run: run() }), { status: 202 });
    if (init?.method === 'POST') return new Response(JSON.stringify({ cancellationRequested: true }), { status: 202 });
    return streamResponse(body);
  } });
  await client.send('Hi');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { input: 'Hi' });
  await until(() => calls.length === 2);
  assert.match(calls[1]!.url, /runId=run_1/);
  controller.enqueue(new TextEncoder().encode(event({ ...base, type: 'sync', historyPosition: 0, run: run() })));
  await until(() => client.getSnapshot().connection === 'following');
  await client.cancel();
  assert.match(calls[2]!.url, /runs\/run_1\/cancel$/);
  controller.enqueue(new TextEncoder().encode(event({ ...base, type: 'end', historyPosition: 0, run: run('cancelled') })));
  controller.close();
  await until(() => client.getSnapshot().connection === 'idle');
  assert.equal(calls.length, 3);
  client.dispose();
});

test('invalid protocol event is exposed and stops retrying', async () => {
  let requests = 0;
  const client = new AgentClient(agentId, { fetcher: async () => { requests++; return streamResponse('event: sync\ndata: {}\n\n'); } });
  client.follow();
  await until(() => client.getSnapshot().connection === 'error');
  assert.equal(requests, 1);
  assert.match(client.getSnapshot().error!, /Unsupported follow event/);
  client.dispose();
  assert.ok(ProtocolError);
});

test('private range inspection begins at its stored boundary and remains scoped to the selected run', async () => {
  const requests: string[] = [];
  const completed = { ...run('completed'), endPosition: 12 };
  const payload = event({ ...base, type: 'message', record: record(11, 'work', 'run work') })
    + event({ ...base, type: 'message', record: record(12, 'final', 'final') })
    + event({ ...base, type: 'sync', historyPosition: 12, run: completed })
    + event({ ...base, type: 'end', historyPosition: 12, run: completed });
  const client = new AgentClient(agentId, { historyAfter: 10, fetcher: async input => { requests.push(String(input)); return streamResponse(payload); } });
  client.follow(runId); await until(() => client.getSnapshot().connection === 'idle');
  assert.match(requests[0]!, /runId=run_1&after=10/);
  assert.deepEqual(client.getSnapshot().completed.map(record => record.position), [11, 12]);
  client.dispose();
});

test('stored text metadata survives streamed-to-completed reconciliation without presentation annotations', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const client = new AgentClient(agentId, { fetcher: async () => streamResponse(body) });
  const partial = assistant('Streaming text');
  client.follow(runId);
  controller.enqueue(new TextEncoder().encode(event({version:2,agentId,runId,type:'sync',historyPosition:0,run:run()})+event({version:2,agentId,runId,type:'chunk',messageId:'m1',sequence:0,event:{type:'start',message:{...partial,content:[]}}})));
  await until(() => client.getSnapshot().live.length === 1);
  const completed = record(1, 'm1', 'Final text');
  const signature = JSON.stringify({v:1,id:'native',phase:'final_answer'});
  completed.message = { ...assistant('Final text'), content: [{type:'text',text:'Final text',textSignature:signature}] };
  controller.enqueue(new TextEncoder().encode(event({version:2,agentId,runId,type:'message',record:completed})+event({version:2,agentId,runId,type:'end',historyPosition:1,run:run('completed')})));
  await until(() => client.getSnapshot().connection === 'idle');
  assert.deepEqual(client.getSnapshot().completed[0]!.message, completed.message);
  assert.equal(client.getSnapshot().live.length, 0);
  client.dispose(); controller.close();
});
