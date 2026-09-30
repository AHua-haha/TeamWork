import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createModels, fauxAssistantMessage, fauxProvider, Type, type AssistantMessageEvent, type Message } from '@earendil-works/pi-ai';
import { MySqlStore } from '../../src/database.js';
import { AgentRuntime, fixedPolicy, piModelStream, type ModelRequest, type RuntimePolicy, type RuntimeTool } from '../../src/runtime.js';
import { createAgentServer } from '../../src/http.js';
import type { FollowEvent } from '../../src/types.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to a disposable MySQL 8.4 database (see README)');
const store = new MySqlStore(databaseUrl);
before(async () => { await store.migrate(); });
after(async () => { await store.close(); });

class Queue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private readers: ((result: IteratorResult<T>) => void)[] = [];
  push(value: T) {
    const read = this.readers.shift();
    if (read) read({ done: false, value }); else this.values.push(value);
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.values.length ? Promise.resolve({ done: false, value: this.values.shift()! }) : new Promise(resolve => this.readers.push(resolve)) };
  }
  async next(): Promise<T> { return (await this[Symbol.asyncIterator]().next()).value; }
}

const model = fauxProvider().getModel();
const message = (text = 'answer') => fauxAssistantMessage(text);
const user = { role: 'user' as const, content: 'hello', timestamp: 1 };
const limits = { maxChunks: 2, maxBytes: 100_000 };

async function fixture(options: { policy?: RuntimePolicy; retention?: typeof limits; maxSteps?: number } = {}) {
  const requests = new Queue<{ request: ModelRequest; events: Queue<AssistantMessageEvent> }>();
  const runtime = new AgentRuntime(store, options.policy ?? fixedPolicy(model), request => {
    const events = new Queue<AssistantMessageEvent>();
    requests.push({ request, events });
    return events;
  }, options);
  await runtime.open();
  const agentId = randomUUID();
  await store.createAgent(agentId);
  return { runtime, requests, agentId };
}

function answer(events: Queue<AssistantMessageEvent>, response = message()) {
  events.push({ type: 'start', partial: { ...response, content: [], stopReason: 'pending' } });
  events.push({ type: 'done', reason: response.stopReason as 'stop' | 'toolUse', message: response });
}

async function collect(stream: AsyncIterable<FollowEvent>): Promise<FollowEvent[]> {
  const events: FollowEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function until(stream: AsyncIterator<FollowEvent>, type: FollowEvent['type']): Promise<FollowEvent> {
  for (;;) {
    const next = await stream.next();
    assert.equal(next.done, false, `stream ended before ${type}`);
    if (next.value.type === type) return next.value;
  }
}

test('MySQL atomic history/context, revision conflicts, immutable history and concurrent start exclusion', { timeout: 15_000 }, async () => {
  const { agentId } = await store.createAgent();
  const attempts = await Promise.allSettled([store.startRun(agentId, user), store.startRun(agentId, user)]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  const run = attempts.find(item => item.status === 'fulfilled')!;
  assert.equal(run.status, 'fulfilled');
  if (run.status !== 'fulfilled') return;
  const original = await store.followSnapshot(agentId, run.value.runId, 0);
  assert.equal(original.history.length, 1);
  const context = await store.getContext(agentId);
  await store.replaceContext(agentId, context.revision, [{ messageId: 'summary', message: { role: 'system', content: 'summary', timestamp: 2 }, metadata: { revision: 1 } }]);
  await assert.rejects(store.replaceContext(agentId, context.revision, []), /revision changed/);
  assert.deepEqual((await store.followSnapshot(agentId, run.value.runId, 0)).history, original.history);
  await assert.rejects(store.commitMessage(agentId, run.value.runId, { ...original.history[0]!, message: { role: 'toolResult', toolCallId: 'x', toolName: 'x', content: [], isError: false, timestamp: 1 } }), /exists/);
  assert.equal((await store.getContext(agentId)).entries.length, 1);
  await store.finishRun(agentId, run.value.runId, 'completed');
});

test('MySQL keeps count/byte retention boundaries after full eviction and clears chunks on commit', { timeout: 15_000 }, async () => {
  const { agentId } = await store.createAgent();
  const run = await store.startRun(agentId, user);
  const id = randomUUID();
  await store.beginMessage(agentId, run.runId, id, 1);
  const partial = message('one');
  await store.appendChunk(agentId, run.runId, id, { type: 'start', partial }, limits);
  for (let i = 1; i < 5; i++) await store.appendChunk(agentId, run.runId, id, { type: 'text_delta', contentIndex: 0, delta: String(i), partial }, limits);
  let live = (await store.followSnapshot(agentId, run.runId, 0)).live!;
  assert.equal(live.firstAvailable, 3);
  assert.deepEqual(live.chunks.map(chunk => chunk.sequence), [3, 4]);
  await store.appendChunk(agentId, run.runId, id, { type: 'text_delta', contentIndex: 0, delta: 'x', partial }, { maxChunks: 10, maxBytes: 1 });
  live = (await store.followSnapshot(agentId, run.runId, 0)).live!;
  assert.equal(live.firstAvailable, 6);
  assert.equal(live.chunks.length, 0);
  await store.commitMessage(agentId, run.runId, { messageId: id, message: partial, metadata: { kept: true } });
  const snapshot = await store.followSnapshot(agentId, run.runId, 0);
  assert.equal(snapshot.live, null);
  assert.equal(snapshot.history[1]?.messageId, id);
  assert.equal(snapshot.history[1]?.metadata.kept, true);
  await store.finishRun(agentId, run.runId, 'completed');
});

test('real Pi provider collection drives shared loop, validates and executes tool, then rereads persisted compacted context', { timeout: 15_000 }, async () => {
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  const models = createModels();
  models.setProvider(faux.provider);
  const captured: Message[][] = [];
  faux.setResponses([
    context => { captured.push(context.messages); return fauxAssistantMessage([{ type: 'toolCall', id: 'call-1', name: 'echo', arguments: { value: 'test' } }], { stopReason: 'toolUse' }); },
    context => { captured.push(context.messages); return message('finished'); },
  ]);
  let executed = 0;
  const echo: RuntimeTool = { definition: { name: 'echo', description: 'Echo input', parameters: Type.Object({ value: Type.String() }) }, execute: async args => { executed++; return { content: [{ type: 'text', text: String(args.value) }], isError: false }; } };
  const base = fixedPolicy(faux.getModel(), [echo]);
  const runtime = new AgentRuntime(store, {
    ...base,
    beforeStep: async scope => {
      if (scope.step === 2) {
        const history = await scope.readContext();
        assert.deepEqual(history.entries.map(item => item.message.role), ['user', 'assistant', 'toolResult']);
        await scope.replaceContext(history.revision, [{ messageId: 'summary', message: { role: 'user', content: 'compacted', timestamp: 1 }, metadata: { sourceCount: 3 } }]);
      }
    },
  }, piModelStream(models));
  await runtime.open();
  try {
    const { agentId } = await store.createAgent();
    const run = await runtime.start(agentId, 'go');
    const events = await collect(runtime.follow(agentId, { runId: run.runId }));
    assert.equal(executed, 1);
    assert.equal(captured.length, 2);
    assert.ok(captured[1]?.some(item => item.role === 'user' && item.content === 'compacted'));
    const final = events.at(-1)!;
    assert.equal(final.type, 'end');
    if (final.type === 'end') assert.equal(final.run?.status, 'completed');
    const history = events.filter(event => event.type === 'message');
    assert.deepEqual(history.map(event => event.record.message.role), ['user', 'assistant', 'toolResult', 'assistant']);
    assert.deepEqual((await store.getContext(agentId)).entries.map(entry => entry.message.role), ['user', 'assistant']);
  } finally { await runtime.close(); }
});

test('live Pi chunks keep stable identity; disconnect/reconnect gets complete record without chunk replay', { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    const { events } = await f.requests.next();
    const live = f.runtime.follow(f.agentId, { runId: run.runId });
    await until(live, 'sync');
    const partial = message('Hel');
    events.push({ type: 'start', partial });
    const chunk = await until(live, 'chunk');
    assert.equal(chunk.type, 'chunk');
    await live.return(undefined);
    events.push({ type: 'done', reason: 'stop', message: message('Hello') });
    const complete = await collect(f.runtime.follow(f.agentId, { runId: run.runId, after: 1 }));
    const final = complete.find(event => event.type === 'message')!;
    assert.equal(final.type, 'message');
    if (final.type === 'message' && chunk.type === 'chunk') assert.equal(final.record.messageId, chunk.messageId);
    const reconnect = await collect(f.runtime.follow(f.agentId, { runId: run.runId, after: 1 }));
    assert.equal(reconnect.filter(event => event.type === 'chunk').length, 0);
    assert.equal(reconnect.filter(event => event.type === 'message').length, 1);
  } finally { await f.runtime.close(); }
});

test('slow follower sees gap after pruning and waits for full message; no tail masquerades as complete', { timeout: 15_000 }, async () => {
  const f = await fixture({ retention: { maxChunks: 0, maxBytes: 0 } });
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    const { events } = await f.requests.next();
    const stream = f.runtime.follow(f.agentId, { runId: run.runId });
    await until(stream, 'sync');
    events.push({ type: 'start', partial: message('partial') });
    const gap = await until(stream, 'gap');
    assert.equal(gap.type, 'gap');
    events.push({ type: 'text_delta', contentIndex: 0, delta: 'tail', partial: message('partialtail') });
    events.push({ type: 'done', reason: 'stop', message: message('full') });
    const rest = await collect(stream);
    assert.equal(rest.filter(event => event.type === 'chunk').length, 0);
    assert.equal(rest.filter(event => event.type === 'message').length, 1);
    assert.equal(rest.at(-1)?.type, 'end');
  } finally { await f.runtime.close(); }
});

test('completion during sync is not lost and terminal follower is bounded before a subsequent run', { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    const run = await f.runtime.start(f.agentId, 'first');
    const { events } = await f.requests.next();
    const stream = f.runtime.follow(f.agentId, { runId: run.runId });
    const first = await stream.next(); // pause while delivering the initial history snapshot
    assert.equal(first.value?.type, 'message');
    answer(events, message('first answer'));
    await collect(f.runtime.follow(f.agentId, { runId: run.runId }));
    const next = await f.runtime.start(f.agentId, 'second');
    answer((await f.requests.next()).events, message('second answer'));
    const remaining = await collect(stream);
    const records = remaining.filter(event => event.type === 'message');
    assert.equal(records.length, 1);
    assert.ok(records.every(event => event.record.runId === run.runId));
    assert.equal(remaining.at(-1)?.runId, run.runId);
    await collect(f.runtime.follow(f.agentId, { runId: next.runId }));
  } finally { await f.runtime.close(); }
});

test('cancellation interrupts waiting provider, drops partial, and disconnect does not cancel execution', { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    const { events } = await f.requests.next();
    const stream = f.runtime.follow(f.agentId, { runId: run.runId });
    events.push({ type: 'start', partial: message('unfinished') });
    await until(stream, 'chunk');
    await stream.return(undefined);
    assert.equal((await f.runtime.getState(f.agentId)).run?.status, 'running');
    await f.runtime.cancel(f.agentId, run.runId);
    const final = await collect(f.runtime.follow(f.agentId, { runId: run.runId }));
    const end = final.at(-1)!;
    assert.equal(end.type, 'end');
    if (end.type === 'end') assert.equal(end.run?.status, 'cancelled');
    assert.equal(final.filter(event => event.type === 'message').length, 1);
  } finally { await f.runtime.close(); }
});

test('model errors and tool validation failures become run failures without fabricated success', { timeout: 15_000 }, async () => {
  const echo: RuntimeTool = { definition: { name: 'echo', description: '', parameters: Type.Object({ value: Type.String() }) }, execute: async () => { throw new Error('must not execute'); } };
  const f = await fixture({ policy: fixedPolicy(model, [echo]) });
  try {
    const first = await f.runtime.start(f.agentId, 'model failure');
    const one = await f.requests.next();
    one.events.push({ type: 'error', reason: 'error', error: { ...message(), stopReason: 'error', errorMessage: 'provider unavailable' } });
    await collect(f.runtime.follow(f.agentId, { runId: first.runId }));
    assert.equal((await f.runtime.getState(f.agentId)).run?.status, 'failed');
    const second = await f.runtime.start(f.agentId, 'tool failure');
    answer((await f.requests.next()).events, fauxAssistantMessage([{ type: 'toolCall', id: 'bad-call', name: 'echo', arguments: {} }], { stopReason: 'toolUse' }));
    const result = await collect(f.runtime.follow(f.agentId, { runId: second.runId }));
    assert.equal((await f.runtime.getState(f.agentId)).run?.status, 'failed');
    const tool = result.find(event => event.type === 'message' && event.record.message.role === 'toolResult');
    assert.ok(tool && tool.type === 'message' && tool.record.message.role === 'toolResult' && tool.record.message.isError);
  } finally { await f.runtime.close(); }
});

test('database commit failure is never announced as completed and terminal failure is observable', { timeout: 15_000 }, async () => {
  const f = await fixture();
  const original = store.commitMessage.bind(store);
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    store.commitMessage = async () => { throw new Error('simulated write outage'); };
    answer((await f.requests.next()).events);
    const events = await collect(f.runtime.follow(f.agentId, { runId: run.runId }));
    assert.equal(events.filter(event => event.type === 'message').length, 1);
    assert.equal((await f.runtime.getState(f.agentId)).run?.status, 'failed');
  } finally { store.commitMessage = original; await f.runtime.close(); }
});

test('runtime owner lock excludes second owner and startup recovers abandoned runs', { timeout: 15_000 }, async () => {
  const other = new MySqlStore(databaseUrl!);
  const f = await fixture();
  try {
    await assert.rejects(other.acquireRuntime(() => {}), /Another runtime/);
  } finally { await other.close(); await f.runtime.close(); }
  const abandoned = await store.startRun(f.agentId, user);
  await store.beginMessage(f.agentId, abandoned.runId, randomUUID(), 1);
  const recovered = new AgentRuntime(store, fixedPolicy(model), () => new Queue());
  await recovered.open();
  try {
    const state = await recovered.getState(f.agentId);
    assert.equal(state.run?.status, 'interrupted');
    assert.equal((await store.followSnapshot(f.agentId, abandoned.runId, 0)).live, null);
  } finally { await recovered.close(); }
});

test('HTTP accepts input only, streams synchronization and run end, reports busy and bad cursors', { timeout: 15_000 }, async () => {
  const f = await fixture();
  const server = createAgentServer(f.runtime);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/agents/${f.agentId}`;
  const send = (data: unknown) => fetch(`${url}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    assert.equal((await send({ input: 'hi', messages: [] })).status, 400);
    assert.equal((await send({ input: 'x'.repeat(2 * 1024 * 1024) })).status, 413);
    const idle = await fetch(`${url}/follow`);
    const idleText = await idle.text();
    assert.match(idleText, /event: sync/);
    assert.match(idleText, /event: end/);
    const response = await send({ input: 'go' });
    assert.equal(response.status, 202);
    const accepted = await response.json() as { runId: string };
    assert.equal((await send({ input: 'busy' })).status, 409);
    const follow = await fetch(`${url}/follow?runId=${accepted.runId}`);
    assert.match(follow.headers.get('content-type')!, /text\/event-stream/);
    answer((await f.requests.next()).events);
    const text = await follow.text();
    assert.match(text, /event: message/);
    assert.match(text, /event: sync/);
    assert.match(text, /event: end/);
    assert.equal((await fetch(`${url}/follow?after=999999`)).status, 409);
    assert.equal((await fetch(`${url}/follow?after=NaN`)).status, 400);
    const state = await (await fetch(`${url}/state`)).json() as { run: { status: string } };
    assert.equal(state.run.status, 'completed');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await f.runtime.close();
  }
});

test('runtime policy controls each model/request and continuation; configured step limit terminates', { timeout: 15_000 }, async () => {
  const f = await fixture({
    maxSteps: 2,
    policy: {
      buildRequest: (scope, history) => ({
        model: { ...model, id: `selected-${scope.step}` },
        context: { systemPrompt: `step ${scope.step}`, messages: history.entries.map(entry => entry.message) },
        tools: [], options: { temperature: 0.2 },
      }),
      shouldContinue: () => true,
      messageMetadata: scope => ({ step: scope.step }),
    },
  });
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    const first = await f.requests.next();
    assert.equal(first.request.model.id, 'selected-1');
    assert.equal(first.request.context.messages.length, 1);
    answer(first.events);
    const second = await f.requests.next();
    assert.equal(second.request.model.id, 'selected-2');
    assert.equal(second.request.context.systemPrompt, 'step 2');
    assert.equal(second.request.context.messages.length, 2);
    answer(second.events);
    const events = await collect(f.runtime.follow(f.agentId, { runId: run.runId }));
    assert.equal((await f.runtime.getState(f.agentId)).run?.error?.code, 'step_limit');
    assert.deepEqual(events.filter(event => event.type === 'message').filter(event => event.record.message.role === 'assistant').map(event => event.record.metadata.step), [1, 2]);
  } finally { await f.runtime.close(); }
});

test('multiple followers see same identities; aborting one follow leaves others and run alive', { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    const { events } = await f.requests.next();
    const disconnect = new AbortController();
    const first = f.runtime.follow(f.agentId, { runId: run.runId, signal: disconnect.signal });
    await until(first, 'state');
    const pending = first.next();
    disconnect.abort();
    assert.equal((await pending).done, true);
    const left = collect(f.runtime.follow(f.agentId, { runId: run.runId }));
    const right = collect(f.runtime.follow(f.agentId, { runId: run.runId }));
    answer(events);
    const lists = await Promise.all([left, right]);
    assert.deepEqual(lists[0].filter(event => event.type === 'message').map(event => event.record.messageId), lists[1].filter(event => event.type === 'message').map(event => event.record.messageId));
    assert.equal((await f.runtime.getState(f.agentId)).run?.status, 'completed');
  } finally { await f.runtime.close(); }
});

test('EOF without Pi done is a failed run, and cancel interrupts a running tool', { timeout: 15_000 }, async () => {
  const runtime = new AgentRuntime(store, fixedPolicy(model), async function* () {
    yield { type: 'start', partial: message() };
  });
  await runtime.open();
  try {
    const { agentId } = await store.createAgent();
    const run = await runtime.start(agentId, 'go');
    await collect(runtime.follow(agentId, { runId: run.runId }));
    assert.equal((await runtime.getState(agentId)).run?.error?.code, 'invalid_stream');
  } finally { await runtime.close(); }
  const entered = new Queue<boolean>();
  const tool: RuntimeTool = { definition: { name: 'wait', description: 'Wait', parameters: Type.Object({}) }, execute: async (_args, scope) => {
    entered.push(true);
    await new Promise<void>(resolve => scope.signal.addEventListener('abort', () => resolve(), { once: true }));
    return { content: [], isError: false };
  } };
  const f = await fixture({ policy: fixedPolicy(model, [tool]) });
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    answer((await f.requests.next()).events, fauxAssistantMessage([{ type: 'toolCall', id: 'wait-call', name: 'wait', arguments: {} }], { stopReason: 'toolUse' }));
    await entered.next();
    await f.runtime.cancel(f.agentId, run.runId);
    const events = await collect(f.runtime.follow(f.agentId, { runId: run.runId }));
    assert.equal((await f.runtime.getState(f.agentId)).run?.status, 'cancelled');
    assert.equal(events.filter(event => event.type === 'message').length, 2); // input and already-committed tool call
  } finally { await f.runtime.close(); }
});

test('failed terminal persistence surfaces as unavailable until restart recovery', { timeout: 15_000 }, async () => {
  const f = await fixture();
  const original = store.finishRun.bind(store);
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    store.finishRun = async () => { throw new Error('terminal write unavailable'); };
    answer((await f.requests.next()).events);
    await assert.rejects(collect(f.runtime.follow(f.agentId, { runId: run.runId })), /terminal state could not be persisted/);
    await assert.rejects(f.runtime.getState(f.agentId), /terminal state could not be persisted/);
  } finally {
    store.finishRun = original;
    await f.runtime.close();
  }
  const next = f.runtime;
  await next.open();
  try { assert.equal((await next.getState(f.agentId)).run?.status, 'interrupted'); }
  finally { await next.close(); }
});

test('persisted context survives reopening the pool; corrupt stored schema fails explicitly', { timeout: 15_000 }, async () => {
  const { agentId } = await store.createAgent();
  await store.replaceContext(agentId, 0, [{ messageId: 'opaque', message: user, metadata: { hidden: true, nested: [1, 'x'] } }]);
  const reopened = new MySqlStore(databaseUrl!);
  try {
    assert.deepEqual(await reopened.getContext(agentId), await store.getContext(agentId));
    await reopened.pool.execute('UPDATE agents SET context = ? WHERE id = ?', ['{"version":999,"data":[]}', agentId]);
    await assert.rejects(reopened.getContext(agentId), /schema version/);
  } finally { await reopened.close(); }
});
