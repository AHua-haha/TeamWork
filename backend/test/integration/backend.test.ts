import { testModels, testModelValidator } from '../memory-store.js';
import { emptyHarness } from '../../src/harness-config.js';
import type { JsonObject } from '@earendil-works/pi-ai';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createModels, fauxAssistantMessage, fauxProvider, Type, type AssistantMessageEvent, type Message } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { MySqlStore } from '../../src/database.js';
import { ConfigService } from '../../src/config.js';
import { AgentRuntime, configuredPolicy, fixedPolicy, piModelStream, type ModelRequest, type RuntimePolicy, type RuntimeTool } from '../../src/runtime.js';
import { createAgentServer } from '../../src/http.js';
import { TeamSystem } from '../../src/team-system.js';
import { newLead } from '../../src/team.js';
import { WorkspaceService } from '../../src/workspace.js';
import type { ContextCommit } from '../../src/context-base.js';
import { sha256 } from '../../src/text.js';
import type { FollowEvent } from '../../src/types.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to a disposable MySQL 8.4 database (see README)');
const store = new MySqlStore(databaseUrl);
const config = new ConfigService(store, createModels());
const workspaces = new WorkspaceService(store, testModelValidator);
const testEncryptionKey = Buffer.alloc(32, 7).toString('base64');
before(async () => {
  await store.migrate();
  await config.initialize();
});
after(async () => { await workspaces.close(); await store.close(); });
const unconfigured = ['Select a provider and model'];
/** A team over the store for an HTTP server whose runtime is `runtime`. */
function teamFor(runtime: AgentRuntime): TeamSystem {
  const team = new TeamSystem(store, workspaces, config);
  team.attach(runtime);
  return team;
}

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
const staticConfig = { resolveForRun: async () => ({ model, tools: [], systemPrompt: '', options: {}, source: { appRevision: 0, agentRevision: 0, catalogRevisions: {} } }) };
const message = (text = 'answer') => fauxAssistantMessage(text);
const user = { role: 'user' as const, content: 'hello', timestamp: 1 };
const limits = { maxChunks: 2, maxBytes: 100_000 };

async function fixture(options: { policy?: RuntimePolicy; retention?: typeof limits; maxSteps?: number } = {}) {
  const requests = new Queue<{ request: ModelRequest; events: Queue<AssistantMessageEvent> }>();
  const runtime = new AgentRuntime(store, staticConfig, options.policy ?? fixedPolicy(model), request => {
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
  const runtime = new AgentRuntime(store, staticConfig, {
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
  const recovered = new AgentRuntime(store, staticConfig, fixedPolicy(model), () => new Queue());
  await recovered.open();
  try {
    const state = await recovered.getState(f.agentId);
    assert.equal(state.run?.status, 'interrupted');
    assert.equal((await store.followSnapshot(f.agentId, abandoned.runId, 0)).live, null);
  } finally { await recovered.close(); }
});

test('HTTP accepts input only, streams synchronization and run end, reports busy and bad cursors', { timeout: 15_000 }, async () => {
  const f = await fixture();
  const server = createAgentServer(f.runtime, config, workspaces, teamFor(f.runtime));
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
  const runtime = new AgentRuntime(store, staticConfig, fixedPolicy(model), async function* () {
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

test('run finalization waits for cancelled tool effects and exposes finalizer failures', { timeout: 15_000 }, async () => {
  const entered = new Queue<boolean>();
  const order: string[] = [];
  const tool: RuntimeTool = {
    definition: { name: 'delayed_stop', description: 'Stops a pending file effect after cancellation', parameters: Type.Object({}) },
    execute: async (_args, scope) => {
      entered.push(true);
      await new Promise<void>(resolve => scope.signal.addEventListener('abort', () => setTimeout(() => { order.push('effect stopped'); resolve(); }, 30), { once: true }));
      return { content: [], isError: false };
    },
  };
  const policy = { ...fixedPolicy(model, [tool]), afterRun: async () => { order.push('checkpoint'); } };
  const f = await fixture({ policy });
  try {
    const run = await f.runtime.start(f.agentId, 'work');
    answer((await f.requests.next()).events, fauxAssistantMessage([{ type: 'toolCall', id: 'delayed', name: 'delayed_stop', arguments: {} }], { stopReason: 'toolUse' }));
    await entered.next();
    await f.runtime.cancel(f.agentId, run.runId);
    assert.equal((await f.runtime.finished(f.agentId, run.runId)).status, 'cancelled');
    assert.deepEqual(order, ['effect stopped', 'checkpoint']);
  } finally { await f.runtime.close(); }
  const bad = await fixture({ policy: { ...fixedPolicy(model), afterRun: async () => { throw new Error('checkpoint unavailable'); } } });
  try {
    const run = await bad.runtime.start(bad.agentId, 'work');
    answer((await bad.requests.next()).events);
    const result = await bad.runtime.finished(bad.agentId, run.runId);
    assert.equal(result.status, 'failed');
    assert.match(result.error!.message, /checkpoint unavailable/);
  } finally { await bad.runtime.close(); }
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

test('provider and agent config snapshots survive edits while each next run resolves again', { timeout: 20_000 }, async () => {
  const models = builtinModels();
  const firstModel = models.getModels()[0]!;
  const service = new ConfigService(store, models, [], testEncryptionKey);
  const { agentId } = await store.createAgent();
  const connectionId = `connection-${randomUUID()}`;
  const connectionValue = { label: 'First connection', provider: firstModel.provider, baseUrl: firstModel.baseUrl, api: 'openai-completions', apiKey: 'first-key' };
  const connection = await service.createConnection(connectionId, connectionValue);
  assert.equal(connection.value.keyConfigured, true);
  assert.equal(JSON.stringify(connection).includes('first-key'), false);
  assert.ok((await service.modelChoices(connectionId)).some(item => item.modelId === firstModel.id));
  await assert.rejects(service.updateConnection(connectionId, 10, connectionValue), /revision changed/);
  const requests = new Queue<{ request: ModelRequest; events: Queue<AssistantMessageEvent> }>();
  const runtime = new AgentRuntime(store, service, { ...configuredPolicy(), shouldContinue: scope => scope.step === 1 }, request => {
    const events = new Queue<AssistantMessageEvent>(); requests.push({ request, events }); return events;
  });
  await runtime.open();
  try {
    await assert.rejects(runtime.start(agentId, 'invalid'), /Select a provider and model/);
    assert.equal((await store.getState(agentId)).historyPosition, 0);
    const empty = await service.getAgent(agentId);
    assert.deepEqual(empty.issues, unconfigured);
    const settings = { name: 'Snapshot agent', connectionId, modelId: firstModel.id, toolOptionIds: [], prompt: 'Original instructions', promptOptionIds: [], modelOptions: [{ connectionId, modelId: firstModel.id, temperature: 0.4, contextBudget: 1024 }] };
    const saved = await service.updateAgent(agentId, empty.revision, settings);
    assert.deepEqual(saved.issues, []);
    assert.equal((await service.resolveForRun(agentId)).contextBudget, 1024);
    const first = await runtime.start(agentId, 'first');
    const step1 = await requests.next();
    assert.equal(step1.request.model.id, firstModel.id);
    assert.equal(step1.request.options?.apiKey, 'first-key');
    assert.equal(step1.request.context.systemPrompt, 'Original instructions');
    assert.equal(step1.request.options?.temperature, 0.4);
    const changedConnection = await service.updateConnection(connectionId, connection.revision, { ...connectionValue, baseUrl: 'https://example.com/v1', apiKey: 'second-key' });
    await service.updateAgent(agentId, saved.revision, { ...settings, prompt: 'Changed instructions', modelOptions: [{ connectionId, modelId: firstModel.id, temperature: 0.8 }] });
    answer(step1.events);
    const step2 = await requests.next();
    assert.equal(step2.request.options?.apiKey, 'first-key');
    assert.equal(step2.request.model.baseUrl, firstModel.baseUrl);
    assert.equal(step2.request.context.systemPrompt, 'Original instructions');
    assert.equal(step2.request.options?.temperature, 0.4);
    answer(step2.events);
    await collect(runtime.follow(agentId, { runId: first.runId }));
    const next = await runtime.start(agentId, 'second');
    const nextStep = await requests.next();
    assert.equal(nextStep.request.model.baseUrl, 'https://example.com/v1');
    assert.equal(nextStep.request.options?.apiKey, 'second-key');
    assert.equal(nextStep.request.context.systemPrompt, 'Changed instructions');
    assert.equal(nextStep.request.options?.temperature, 0.8);
    await service.deleteConnection(connectionId, changedConnection.revision);
    answer(nextStep.events);
    const lastStep = await requests.next();
    assert.equal(lastStep.request.model.id, firstModel.id);
    answer(lastStep.events);
    await collect(runtime.follow(agentId, { runId: next.runId }));
    await assert.rejects(runtime.start(agentId, 'third'), /Selected provider connection is unavailable/);
  } finally { await runtime.close(); }
});

test('config initialization is repeatable and supplies incomplete records for existing agents', async () => {
  const { agentId } = await store.createAgent();
  const service = new ConfigService(store, builtinModels());
  const original = await service.getAgent(agentId);
  await service.deleteAgent(agentId, original.revision);
  assert.equal((await service.listAgents()).find(item => item.agentId === agentId)?.ready, false);
  await service.initialize();
  await service.initialize();
  const restored = await service.getAgent(agentId);
  assert.equal(restored.revision, 0);
  assert.deepEqual(restored.issues, unconfigured);
});

test('initialization migrates an existing agent model selection to provider and model', async () => {
  const models = builtinModels();
  const model = models.getModel('openai', 'gpt-5');
  assert.ok(model);
  const id = `old-model-${randomUUID()}`;
  const { agentId } = await store.createAgent();
  await store.createConfig('catalog', id, { kind: 'model', label: 'Old model', provider: model.provider, modelId: model.id,
    allowedReasoning: [], allowTemperature: true, allowMaxTokens: true });
  const initial = await store.getConfig<Record<string, unknown>>('agent', agentId);
  await store.updateConfig('agent', agentId, initial.revision, { name: 'Legacy', modelOptionId: id, toolOptionIds: [], prompt: '', promptOptionIds: [], callOptions: {} });
  const service = new ConfigService(store, models);
  await service.initialize();
  await service.initialize();
  const migrated = await service.getAgent(agentId);
  assert.equal(migrated.value.modelId, model.id);
  assert.ok(migrated.value.connectionId);
  assert.equal((await service.getConnection(migrated.value.connectionId)).value.baseUrl, model.baseUrl);
  assert.deepEqual(migrated.issues, []);
  assert.equal((await service.listCatalog()).some(item => item.id === id), false);
});

test('initialization preserves a legacy discovered endpoint model as a selectable choice', async () => {
  const models = builtinModels();
  const service = new ConfigService(store, models);
  const connectionId = `legacy-endpoint-${randomUUID()}`;
  await service.createConnection(connectionId, { label: 'Legacy endpoint', provider: 'legacy-custom', baseUrl: 'http://127.0.0.1:9999/v1', api: 'openai-completions' });
  const profileId = `legacy-profile-${randomUUID()}`;
  await store.createConfig('catalog', profileId, { kind: 'model', label: 'Legacy discovered', connectionId, provider: 'legacy-custom',
    modelId: 'endpoint-model', api: 'openai-completions', source: 'endpoint', maxTokens: 2048, reasoning: false,
    allowedReasoning: [], allowTemperature: true, allowMaxTokens: true });
  const { agentId } = await store.createAgent();
  const initial = await store.getConfig<Record<string, unknown>>('agent', agentId);
  await store.updateConfig('agent', agentId, initial.revision, { name: '', modelOptionId: profileId, toolOptionIds: [], prompt: '', promptOptionIds: [], callOptions: {} });
  await service.initialize();
  await service.initialize();
  const migrated = await service.getAgent(agentId);
  assert.equal(migrated.value.modelId, 'endpoint-model');
  assert.deepEqual(migrated.issues, []);
  assert.equal((await service.modelChoices(connectionId))[0]?.verified, false);
});

test('configured requests use selected prompt, registered tool and permitted reasoning', { timeout: 15_000 }, async () => {
  const models = builtinModels();
  const choice = models.getModel('openai', 'gpt-5');
  assert.ok(choice?.reasoning);
  const tool: RuntimeTool = {
    definition: { name: 'echo', description: 'Echo text', parameters: Type.Object({ text: Type.String() }) },
    execute: async args => ({ content: [{ type: 'text', text: String(args.text) }], isError: false }),
  };
  const service = new ConfigService(store, models, [tool]);
  const { agentId } = await store.createAgent();
  const suffix = randomUUID();
  const connectionId = `connection-${suffix}`;
  const toolId = `tool-${suffix}`;
  const promptId = `prompt-${suffix}`;
  await service.createConnection(connectionId, { label: 'OpenAI', provider: 'openai', baseUrl: choice.baseUrl, api: 'openai-responses' });
  await service.createCatalog(toolId, { kind: 'tool', label: 'Echo', toolName: 'echo' });
  await service.createCatalog(promptId, { kind: 'prompt', label: 'Shared instructions', text: 'Shared prompt' });
  await assert.rejects(service.createCatalog(`missing-${suffix}`, { kind: 'tool', label: 'Unavailable', toolName: 'missing' }), /not registered/);
  const empty = await service.getAgent(agentId);
  await service.updateAgent(agentId, empty.revision, {
    name: 'Configured', connectionId, modelId: 'gpt-5', toolOptionIds: [toolId], prompt: 'Agent prompt', promptOptionIds: [promptId], modelOptions: [{ connectionId, modelId: 'gpt-5', reasoning: 'high', maxTokens: 100 }],
  });
  const requests = new Queue<{ request: ModelRequest; events: Queue<AssistantMessageEvent> }>();
  const runtime = new AgentRuntime(store, service, configuredPolicy(), request => {
    const events = new Queue<AssistantMessageEvent>();
    requests.push({ request, events });
    return events;
  });
  await runtime.open();
  try {
    const run = await runtime.start(agentId, 'hello');
    const step = await requests.next();
    assert.equal(step.request.model.id, 'gpt-5');
    assert.equal(step.request.context.systemPrompt, 'Shared prompt\n\nAgent prompt');
    assert.deepEqual(step.request.context.tools?.map(item => item.name), ['echo']);
    assert.equal(step.request.tools[0], tool);
    assert.equal(step.request.options?.reasoning, 'high');
    assert.equal(step.request.options?.maxTokens, 100);
    answer(step.events);
    await collect(runtime.follow(agentId, { runId: run.runId }));
  } finally { await runtime.close(); }
});

test('agent model-call settings are kept per model and only the selected entry is used', async () => {
  const models = builtinModels();
  const service = new ConfigService(store, models);
  const suffix = randomUUID();
  const openai = `openai-${suffix}`;
  const deepseek = `deepseek-${suffix}`;
  await service.createConnection(openai, { label: 'OpenAI', provider: 'openai', baseUrl: models.getModel('openai', 'gpt-5')!.baseUrl, api: 'openai-responses' });
  await service.createConnection(deepseek, { label: 'DeepSeek', provider: 'deepseek', baseUrl: models.getModel('deepseek', 'deepseek-v4-pro')!.baseUrl, api: 'openai-completions' });
  const gpt = (await service.modelChoices(openai)).find(item => item.modelId === 'gpt-5');
  assert.deepEqual(gpt?.reasoningLevels, ['off', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(gpt?.defaultReasoning, 'off');
  assert.deepEqual(gpt?.reasoningSentAs, { off: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'high' });
  const plain = (await service.modelChoices(openai)).find(item => item.modelId === 'gpt-4o-mini');
  assert.deepEqual(plain?.reasoningLevels, []);
  assert.equal(plain?.defaultReasoning, null);
  assert.deepEqual(plain?.reasoningSentAs, {});

  const { agentId } = await store.createAgent();
  const raw = await store.getConfig<Record<string, unknown>>('agent', agentId);
  await store.updateConfig('agent', agentId, raw.revision, { name: '', connectionId: openai, modelId: 'gpt-5', toolOptionIds: [], prompt: '', promptOptionIds: [], callOptions: { reasoning: 'max' } });
  const legacy = await service.getAgent(agentId);
  assert.deepEqual(legacy.value.modelOptions, []);
  assert.equal('callOptions' in legacy.value, false);
  assert.deepEqual(legacy.issues, []);
  assert.equal((await service.resolveForRun(agentId)).options.reasoning, 'minimal');
  await assert.rejects(service.updateAgent(agentId, legacy.revision, { ...legacy.value, callOptions: {} }), /Unknown config field: callOptions/);
  const twice = { connectionId: openai, modelId: 'gpt-5' };
  await assert.rejects(service.updateAgent(agentId, legacy.revision, { ...legacy.value, modelOptions: [twice, twice] }), /duplicate/);
  for (const level of ['minimal', 'max']) await assert.rejects(service.updateAgent(agentId, legacy.revision, { ...legacy.value, modelOptions: [{ ...twice, reasoning: level }] }), /Invalid reasoning level/);

  const entryA = { connectionId: openai, modelId: 'gpt-5', reasoning: 'high', maxTokens: 64_000 };
  const onA = await service.updateAgent(agentId, legacy.revision, { ...legacy.value, modelOptions: [entryA] });
  const onB = await service.updateAgent(agentId, onA.revision, { ...onA.value, connectionId: deepseek, modelId: 'deepseek-v4-pro' });
  assert.deepEqual(onB.issues, []);
  let resolved = await service.resolveForRun(agentId);
  assert.equal(resolved.options.reasoning, undefined);
  assert.equal(resolved.options.maxTokens, undefined);
  const withB = await service.updateAgent(agentId, onB.revision, { ...onB.value, modelOptions: [entryA, { connectionId: deepseek, modelId: 'deepseek-v4-pro', reasoning: 'xhigh' }] });
  assert.equal((await service.resolveForRun(agentId)).options.reasoning, 'max');
  const mediumB = await service.updateAgent(agentId, withB.revision, { ...withB.value, modelOptions: [entryA, { connectionId: deepseek, modelId: 'deepseek-v4-pro', reasoning: 'medium' }] });
  assert.deepEqual(mediumB.issues, []);
  assert.equal((await service.resolveForRun(agentId)).options.reasoning, 'high');
  const backToA = await service.updateAgent(agentId, mediumB.revision, { ...mediumB.value, connectionId: openai, modelId: 'gpt-5' });
  resolved = await service.resolveForRun(agentId);
  assert.equal(resolved.options.reasoning, 'high');
  assert.equal(resolved.options.maxTokens, 64_000);
  assert.deepEqual(backToA.value.modelOptions.length, 2);

  const other = await store.createAgent();
  const otherInitial = await service.getAgent(other.agentId);
  await service.updateAgent(other.agentId, otherInitial.revision, { ...otherInitial.value, connectionId: openai, modelId: 'gpt-5' });
  assert.equal((await service.resolveForRun(other.agentId)).options.reasoning, 'minimal');

  const offB = await service.updateAgent(agentId, backToA.revision, { ...backToA.value, connectionId: deepseek, modelId: 'deepseek-v4-pro',
    modelOptions: [{ ...entryA, reasoning: 'xhigh', maxTokens: 999_999 }, { connectionId: deepseek, modelId: 'deepseek-v4-pro', reasoning: 'off' }] });
  assert.deepEqual(offB.issues, []);
  assert.equal((await service.resolveForRun(agentId)).options.reasoning, undefined);
  const misfit = await service.updateAgent(agentId, offB.revision, { ...offB.value, connectionId: openai, modelId: 'gpt-5' });
  assert.deepEqual(misfit.issues, ['Maximum output tokens exceed this model limit']);
  await assert.rejects(service.resolveForRun(agentId), /Maximum output tokens exceed/);
  const xhighOnGpt = await service.updateAgent(agentId, misfit.revision, { ...misfit.value, modelOptions: [{ connectionId: openai, modelId: 'gpt-5', reasoning: 'xhigh' }] });
  assert.deepEqual(xhighOnGpt.issues, []);
  assert.equal((await service.resolveForRun(agentId)).options.reasoning, 'high');
  const onPlain = await service.updateAgent(agentId, xhighOnGpt.revision, { ...xhighOnGpt.value, modelId: 'gpt-4o-mini', modelOptions: [{ connectionId: openai, modelId: 'gpt-4o-mini', reasoning: 'low' }] });
  assert.deepEqual(onPlain.issues, ['Reasoning level is unavailable for this model']);

  // A level stored before the shared scale existed reads as unset; the entry's other values remain.
  await store.updateConfig('agent', agentId, onPlain.revision, { ...onPlain.value, modelId: 'gpt-5', modelOptions: [{ ...twice, reasoning: 'max', temperature: 1 }] });
  const dropped = await service.getAgent(agentId);
  assert.deepEqual(dropped.value.modelOptions, [{ ...twice, temperature: 1 }]);
  assert.deepEqual(dropped.issues, []);
});

test('an agent config has no workspace, and one stored by the earlier binding is ignored', async () => {
  const service = new ConfigService(store, builtinModels());
  const { agentId } = await store.createAgent();
  const empty = await service.getAgent(agentId);
  assert.equal('workspaceId' in empty.value, false);
  assert.deepEqual(empty.issues, unconfigured);
  await assert.rejects(service.updateAgent(agentId, empty.revision, { ...empty.value, workspaceId: 'w1' }), /Unknown config field: workspaceId/);
  const created = await store.createAgent();
  await store.deleteConfig('agent', created.agentId, 0);
  await assert.rejects(service.createAgentConfig(created.agentId, { ...empty.value, workspaceId: 'w1' }), /Unknown config field: workspaceId/);

  const old = await store.createAgent();
  const stored = await store.getConfig<Record<string, unknown>>('agent', old.agentId);
  await store.updateConfig('agent', old.agentId, stored.revision, { ...empty.value, name: 'Earlier', workspaceId: 'gone' });
  const read = await service.getAgent(old.agentId);
  assert.equal(read.value.name, 'Earlier');
  assert.equal('workspaceId' in read.value, false);
  assert.equal((await service.updateAgent(old.agentId, read.revision, { ...read.value, name: 'Later' })).value.name, 'Later');
});

test('team members are stored with their conversation and kept out of the agent list', async () => {
  const directory = join(await mkdtemp(join(tmpdir(), 'members-')), 'project');
  const { workspaceId } = await workspaces.create({ name: 'Members', directory, models: testModels(), adopt: false });
  try {
    const record = (name: string, lead = false) => ({ workspaceId, name, role: 'developer', responsibility: '', harness: emptyHarness(), lead, settings: { connectionId: null, modelId: null, toolOptionIds: [], prompt: '', promptOptionIds: [], modelOptions: [] }, createdAt: 1, retiredAt: null });
    const add = (name: string, lead = false) => store.createMember({ id: randomUUID(), workspaceId, lead, nameKey: name.toLowerCase(), value: record(name, lead) });
    // Creating the workspace created its lead, in the same transaction.
    const [lead] = await store.listMembers(workspaceId);
    assert.deepEqual([lead?.value.name, lead?.value.lead], ['Lead', true]);
    const backend = await add('Backend');
    await assert.rejects(add('Second lead', true), code('lead_exists'));
    await assert.rejects(add('backend'), code('member_exists'));
    await assert.rejects(add('lead'), code('member_exists'));
    assert.deepEqual((await store.listMembers(workspaceId)).map(member => member.value.name), ['Lead', 'Backend']);
    assert.equal((await store.getMember(backend.id))?.revision, 0);
    assert.equal(await store.getMember('missing'), null);

    // A member's conversation is an agent for the runtime, but not an agent in the list and not one with a config.
    assert.equal((await store.getState(backend.id)).historyPosition, 0);
    assert.equal((await store.listAgents()).includes(backend.id), false);
    await assert.rejects(store.createConfig('agent', backend.id, {}), code('not_found'));
    await assert.rejects(new ConfigService(store, builtinModels()).getAgent(backend.id), code('not_found'));

    await assert.rejects(store.updateMember(backend.id, 5, 'backend', backend.value), code('config_conflict'));
    await assert.rejects(store.updateMember(backend.id, 0, 'lead', backend.value), code('member_exists'), 'a name an active member has is refused');
    await assert.rejects(store.updateMember('missing', 0, 'x', backend.value), code('not_found'));
    const retired = await store.updateMember(backend.id, 0, null, { ...backend.value, retiredAt: 2 });
    assert.equal(retired.revision, 1);
    assert.equal((await add('Backend')).revision, 0, 'a retired member frees its name');
    assert.equal((await store.getMember(lead!.id))?.value.lead, true);
    assert.equal((await store.configBundle(null)).agent, null);
  } finally { await rm(join(directory, '..'), { recursive: true, force: true }); }
});

test('backend discovers a custom model ID and calls its endpoint through Pi with a stored key', { timeout: 20_000 }, async () => {
  const seen: { authorization?: string; model?: string } = {};
  let failDiscovery = false;
  const endpoint = createHttpServer((request, response) => {
    seen.authorization = request.headers.authorization;
    if (request.url === '/v1/models' && request.method === 'GET') {
      if (failDiscovery) { response.writeHead(503); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'server-owned-model', name: 'Discovered model' }] }));
      return;
    }
    if (request.url === '/v1/chat/completions' && request.method === 'POST') {
      void (async () => {
        let body = '';
        for await (const chunk of request) body += chunk;
        seen.model = JSON.parse(body).model;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: {"id":"reply","object":"chat.completion.chunk","created":1,"model":"server-owned-model","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\n');
        response.write('data: {"id":"reply","object":"chat.completion.chunk","created":1,"model":"server-owned-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
        response.end('data: [DONE]\n\n');
      })();
      return;
    }
    response.writeHead(404); response.end();
  });
  endpoint.listen(0, '127.0.0.1');
  await once(endpoint, 'listening');
  const address = endpoint.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const models = builtinModels();
  const service = new ConfigService(store, models, [], testEncryptionKey);
  const connectionId = `custom-${randomUUID()}`;
  const connection = await service.createConnection(connectionId, { label: 'Local custom', provider: 'local-custom', baseUrl, api: 'openai-completions', apiKey: 'custom-secret' });
  let runtime: AgentRuntime | undefined;
  try {
    const choices = await service.modelChoices(connectionId, true);
    assert.deepEqual(choices.map(item => item.label), ['Discovered model']);
    assert.equal(seen.authorization, 'Bearer custom-secret');
    assert.equal(JSON.stringify(connection).includes('custom-secret'), false);
    assert.equal(JSON.stringify(await store.getConfig('connection', connectionId)).includes('custom-secret'), false);
    assert.equal(choices[0]?.verified, false);
    assert.equal((await service.modelChoices(connectionId))[0]?.modelId, 'server-owned-model');
    failDiscovery = true;
    await assert.rejects(service.modelChoices(connectionId, true), /Could not discover/);
    assert.equal((await service.modelChoices(connectionId))[0]?.modelId, 'server-owned-model');
    failDiscovery = false;
    const { agentId } = await store.createAgent();
    const initial = await service.getAgent(agentId);
    await service.updateAgent(agentId, initial.revision, { ...initial.value, connectionId, modelId: choices[0]!.modelId });
    runtime = new AgentRuntime(store, service, configuredPolicy(), piModelStream(models));
    await runtime.open();
    const run = await runtime.start(agentId, 'Hello');
    const events = await collect(runtime.follow(agentId, { runId: run.runId }));
    const assistant = events.find(item => item.type === 'message' && item.record.message.role === 'assistant');
    assert.ok(assistant && assistant.type === 'message');
    assert.equal(seen.model, 'server-owned-model');
    assert.equal(seen.authorization, 'Bearer custom-secret');
    assert.equal(events.at(-1)?.type, 'end');
    const changed = await service.updateConnection(connectionId, connection.revision, { label: 'Local custom', provider: 'local-custom', baseUrl: `${baseUrl}/new`, api: 'openai-completions' });
    assert.deepEqual(await service.modelChoices(connectionId), []);
    await service.updateConnection(connectionId, changed.revision, { label: 'Local custom', provider: 'local-custom', baseUrl, api: 'openai-completions' });
    assert.deepEqual(await service.modelChoices(connectionId), []);
  } finally {
    await runtime?.close();
    endpoint.closeAllConnections();
    await new Promise<void>(resolve => endpoint.close(() => resolve()));
  }
});

test('Anthropic Messages connection discovers paged models and streams through Pi', { timeout: 20_000 }, async () => {
  const seen: { key?: string; version?: string; model?: string; requests: string[] } = { requests: [] };
  const endpoint = createHttpServer((request, response) => {
    seen.requests.push(request.url ?? '');
    seen.key = request.headers['x-api-key'] as string | undefined;
    seen.version = request.headers['anthropic-version'] as string | undefined;
    if (request.url?.startsWith('/v1/models') && request.method === 'GET') {
      const after = new URL(request.url, 'http://localhost').searchParams.get('after_id');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(after
        ? { data: [{ id: 'custom-claude-b', display_name: 'Custom Claude B' }], has_more: false, last_id: 'custom-claude-b' }
        : { data: [{ id: 'custom-claude-a', display_name: 'Custom Claude A' }], has_more: true, last_id: 'custom-claude-a' }));
      return;
    }
    if (request.url?.startsWith('/v1/messages') && request.method === 'POST') {
      void (async () => {
        let body = '';
        for await (const chunk of request) body += chunk;
        seen.model = (JSON.parse(body) as { model: string }).model;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const events = [
          { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'custom-claude-b', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Anthropic reply' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
          { type: 'message_stop' },
        ];
        for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        response.end();
      })();
      return;
    }
    response.writeHead(404); response.end();
  });
  endpoint.listen(0, '127.0.0.1');
  await once(endpoint, 'listening');
  const address = endpoint.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const models = builtinModels();
  const service = new ConfigService(store, models, [], testEncryptionKey);
  const connectionId = `anthropic-custom-${randomUUID()}`;
  let runtime: AgentRuntime | undefined;
  try {
    await service.createConnection(connectionId, { label: 'Anthropic-compatible', provider: 'custom-anthropic', baseUrl, api: 'anthropic-messages', apiKey: 'anthropic-test-key' });
    const choices = await service.modelChoices(connectionId, true);
    assert.deepEqual(choices.map(item => item.label), ['Custom Claude A', 'Custom Claude B']);
    assert.equal(choices[1]?.api, 'anthropic-messages');
    assert.equal(seen.key, 'anthropic-test-key');
    assert.equal(seen.version, '2023-06-01');
    assert.ok(seen.requests.includes('/v1/models?after_id=custom-claude-a'));
    assert.equal((await service.modelChoices(connectionId)).length, 2);
    const { agentId } = await store.createAgent();
    const initial = await service.getAgent(agentId);
    await service.updateAgent(agentId, initial.revision, { ...initial.value, connectionId, modelId: 'custom-claude-b' });
    runtime = new AgentRuntime(store, service, configuredPolicy(), piModelStream(models));
    await runtime.open();
    const run = await runtime.start(agentId, 'Hello');
    const events = await collect(runtime.follow(agentId, { runId: run.runId }));
    assert.equal(seen.model, 'custom-claude-b');
    assert.ok(events.some(item => item.type === 'message' && item.record.message.role === 'assistant'));
    assert.equal(events.at(-1)?.type, 'end');
  } finally {
    await runtime?.close();
    endpoint.closeAllConnections();
    await new Promise<void>(resolve => endpoint.close(() => resolve()));
  }
});

test('known DeepSeek model follows the connection protocol instead of its Pi default', { timeout: 20_000 }, async () => {
  const seen: { requests: string[]; model?: string; key?: string; thinking?: unknown } = { requests: [] };
  const endpoint = createHttpServer((request, response) => {
    seen.requests.push(request.url ?? '');
    if (request.url?.startsWith('/anthropic/v1/messages') && request.method === 'POST') {
      void (async () => {
        let body = '';
        for await (const chunk of request) body += chunk;
        const input = JSON.parse(body) as { model: string; thinking?: unknown };
        seen.model = input.model;
        seen.thinking = input.thinking;
        seen.key = request.headers['x-api-key'] as string | undefined;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const events = [
          { type: 'message_start', message: { id: 'msg_deepseek', type: 'message', role: 'assistant', content: [], model: 'deepseek-v4-pro', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'DeepSeek reply' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
          { type: 'message_stop' },
        ];
        for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        response.end();
      })();
      return;
    }
    response.writeHead(404); response.end();
  });
  endpoint.listen(0, '127.0.0.1');
  await once(endpoint, 'listening');
  const address = endpoint.address();
  assert.ok(address && typeof address === 'object');
  const models = builtinModels();
  const service = new ConfigService(store, models, [], testEncryptionKey);
  const connectionId = `deepseek-anthropic-${randomUUID()}`;
  let runtime: AgentRuntime | undefined;
  try {
    await service.createConnection(connectionId, { label: 'DeepSeek via Anthropic', provider: 'deepseek',
      baseUrl: `http://127.0.0.1:${address.port}/anthropic`, api: 'anthropic-messages', apiKey: 'deepseek-test-key' });
    const choice = (await service.modelChoices(connectionId)).find(item => item.modelId === 'deepseek-v4-pro');
    assert.equal(choice?.api, 'anthropic-messages');
    assert.equal(choice?.reasoning, true);
    assert.deepEqual(choice?.reasoningLevels, ['off', 'low', 'medium', 'high', 'xhigh']);
    assert.equal(choice?.defaultReasoning, 'off');
    assert.deepEqual(choice?.reasoningSentAs, { off: 'off', low: 'high', medium: 'high', high: 'high', xhigh: 'max' });
    const { agentId } = await store.createAgent();
    const initial = await service.getAgent(agentId);
    await service.updateAgent(agentId, initial.revision, { ...initial.value, connectionId, modelId: 'deepseek-v4-pro', modelOptions: [{ connectionId, modelId: 'deepseek-v4-pro', reasoning: 'high' }] });
    runtime = new AgentRuntime(store, service, configuredPolicy(), piModelStream(models));
    await runtime.open();
    const run = await runtime.start(agentId, 'Hello');
    const events = await collect(runtime.follow(agentId, { runId: run.runId }));
    assert.equal(seen.model, 'deepseek-v4-pro');
    assert.equal(seen.key, 'deepseek-test-key');
    assert.ok(seen.thinking);
    assert.ok(events.some(item => item.type === 'message' && item.record.message.role === 'assistant'));
    assert.equal(events.at(-1)?.type, 'end');
    assert.ok(seen.requests.every(path => path.startsWith('/anthropic/v1/messages')));
  } finally {
    await runtime?.close();
    endpoint.closeAllConnections();
    await new Promise<void>(resolve => endpoint.close(() => resolve()));
  }
});

test('config HTTP exposes app, catalog and agent edits without accepting invalid run input', { timeout: 20_000 }, async () => {
  const models = builtinModels();
  const service = new ConfigService(store, models, [], testEncryptionKey);
  const runtime = new AgentRuntime(store, service, configuredPolicy(), async function* () { yield { type: 'done', reason: 'stop', message: message() }; });
  await runtime.open();
  const server = createAgentServer(runtime, service, workspaces, teamFor(runtime));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, method = 'GET', data?: unknown) => fetch(base + path, data === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    const app = await (await request('/config/app')).json() as { revision: number; value: { title: string; maxInputBytes: number; allowAgentCreation: boolean } };
    assert.equal(app.value.title, 'RSI Agent');
    assert.ok((await (await request('/config/capabilities')).json() as { models: unknown[] }).models.length > 0);
    const agent = await (await request('/agents', 'POST', {})).json() as { agentId: string };
    assert.equal((await request(`/agents/${agent.agentId}/runs`, 'POST', { input: 'no model' })).status, 409);
    const configResponse = await (await request(`/agents/${agent.agentId}/config`)).json() as { revision: number; value: Record<string, unknown>; issues: string[] };
    assert.deepEqual(configResponse.issues, unconfigured);
    const modelChoice = models.getModels()[0]!;
    const connectionId = `http-connection-${randomUUID()}`;
    const createdConnection = await request('/config/connections', 'POST', { id: connectionId, value: { label: 'HTTP connection', provider: modelChoice.provider, baseUrl: modelChoice.baseUrl, api: 'openai-completions', apiKey: 'http-private-key' } });
    assert.equal(createdConnection.status, 201);
    const connectionBody = await createdConnection.text();
    assert.equal(connectionBody.includes('http-private-key'), false);
    assert.equal((await request('/config/connections')).status, 200);
    assert.equal((await request(`/config/connections/${connectionId}/models`)).status, 200);
    assert.equal((await request(`/config/connections/${connectionId}/models/refresh`, 'POST')).status, 415);
    assert.equal((await request(`/agents/${agent.agentId}/config`, 'PUT', { revision: configResponse.revision, value: { ...configResponse.value, workspaceId: 'w1' } })).status, 400);
    const value = { ...configResponse.value, connectionId, modelId: modelChoice.id };
    assert.equal((await request('/config/catalog', 'POST', { id: `invalid-${randomUUID()}`, value: { kind: 'model', label: 'Unsupported' } })).status, 400);
    const updated = await request(`/agents/${agent.agentId}/config`, 'PUT', { revision: configResponse.revision, value });
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json() as { issues: string[] }).issues, []);
    assert.equal((await request(`/agents/${agent.agentId}/config`, 'PUT', { revision: configResponse.revision, value })).status, 409);
    assert.ok((await (await request('/agents')).json() as { agentId: string }[]).some(item => item.agentId === agent.agentId));
    assert.equal((await request(`/config/connections/${connectionId}`, 'DELETE', { revision: 0 })).status, 200);
    assert.equal((await request(`/agents/${agent.agentId}/runs`, 'POST', { input: 'deleted provider' })).status, 409);
    const changedApp = await request('/config/app', 'PUT', { revision: app.revision, value: { ...app.value, allowAgentCreation: false } });
    assert.equal(changedApp.status, 200);
    assert.equal((await request('/agents', 'POST', {})).status, 409);
    await request('/config/app', 'PUT', { revision: app.revision + 1, value: app.value });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await runtime.close();
  }
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

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

test('member harnesses edit in isolated worktrees, checkpoint runs and separate agent commits from user design acceptance', { timeout: 30_000 }, async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'harness-prototype-')));
  const workspaceService = new WorkspaceService(store, { issuesFor: settings => service.issuesFor(settings) });
  const service = new ConfigService(store, builtinModels());
  const team = new TeamSystem(store, workspaceService, service);
  const requests = new Queue<{ request: ModelRequest; events: Queue<AssistantMessageEvent> }>();
  const runtime = new AgentRuntime(store, team.runConfig, team.policy(configuredPolicy()), request => {
    const events = new Queue<AssistantMessageEvent>();
    requests.push({ request, events });
    return events;
  });
  team.attach(runtime);
  const call = (name: string, args: JsonObject) => fauxAssistantMessage([{ type: 'toolCall', id: randomUUID(), name, arguments: args }], { stopReason: 'toolUse' });
  try {
    const connectionId = `harness-test-${randomUUID()}`;
    await service.createConnection(connectionId, { label: 'Test model', provider: 'openai', baseUrl: 'https://api.openai.com/v1', api: 'openai-responses' });
    const { workspaceId } = await workspaceService.create({ name: 'Harness prototype', directory: join(folder, 'project'), models: testModels(connectionId, 'gpt-4.1-mini'), adopt: false });
    const base = await workspaceService.context(workspaceId);
    const design = { content: 'Create src/result.txt with Done.', implementation: ['src/result.txt'] };
    await base.save('user/design.json', JSON.stringify(design), null, 'Initial accepted design');
    const first = (await team.team(workspaceId)).members[0]!;
    const lead = await team.update(workspaceId, first.memberId, first.revision, {
      name: first.name, role: first.role, responsibility: first.responsibility, harness: { designScope: first.harness.designScope, allowedCommands: [] },
      settings: { ...first.settings, connectionId, modelId: 'gpt-4.1-mini' },
    });
    await team.create(workspaceId, { name: 'Backend', role: 'developer', responsibility: 'Implement result', settings: { prompt: 'Keep the result concise.' }, harness: { designScope: { working: ['user/design.json'], dependencies: [] }, allowedCommands: [{ kind: 'executable', executable: 'bash' }] } });
    await runtime.open();
    const accepted = await team.runner.postUser(workspaceId, 'Propose a design refinement and ask Backend to implement the accepted design.');
    const run = accepted.runs[0]!;
    const firstStep = await requests.next();
    assert.ok(!firstStep.request.tools.some(tool => tool.definition.name === 'save_design'));
    assert.match(firstStep.request.context.systemPrompt!, /user approval/);
    answer(firstStep.events, call('write', { path: '.context/user/design.json', content: JSON.stringify({ ...design, content: 'Pending design refinement' }) }));
    const secondStep = await requests.next();
    answer(secondStep.events, call('bash', { command: 'git add . && git commit -m "Cannot self-approve"', metadata: { git: { scope: 'design' } } }));
    const thirdStep = await requests.next();
    assert.match(JSON.stringify(thirdStep.request.context.messages), /approval_required/);
    const manifest = { name: 'Pending new member', role: 'developer', responsibility: 'Future member', settings: {}, promptFiles: ['prompts/member.md'], designScope: { working: ['user/design.json'], dependencies: [] } };
    answer(thirdStep.events, call('write', { path: '.team/members/pending/prompts/member.md', content: 'Pending prompt.' }));
    const manifestStep = await requests.next();
    answer(manifestStep.events, call('write', { path: '.team/members/pending/member.json', content: JSON.stringify(manifest) }));
    const fourthStep = await requests.next();
    assert.equal((await team.team(workspaceId)).members.length, 2, 'file changes do not activate members');
    assert.ok(!fourthStep.request.tools.some(t => t.definition.name === 'submit_member_config'));
    answer(fourthStep.events, message('@Backend Implement the accepted design.'));
    const workerStep = await requests.next();
    assert.match(workerStep.request.context.systemPrompt!, /You are Backend/);
    assert.match(workerStep.request.context.systemPrompt!, /Keep the result concise/);
    const activeWorker = (await team.service.byName(workspaceId, 'Backend'))!;
    await assert.rejects(store.updateMember(activeWorker.id, activeWorker.revision, 'backend', activeWorker.value, true), code('member_busy'));
    const storedBundle = (await store.getMember(activeWorker.id))!.value.configuration!;
    assert.equal(storedBundle.files['prompts/member.md'], 'Keep the result concise.');
    assert.deepEqual(JSON.parse(storedBundle.files['member.json']!).designScope, { working: ['user/design.json'], dependencies: [] });
    const leadFiles = await team.harness.files(lead.memberId);
    await writeFile(join(leadFiles.root, '.team/members/pending/prompts/member.md'), 'UNSUBMITTED prompt');
    assert.equal((await team.configuration.accepted(workspaceId, activeWorker.id)).digest, storedBundle.digest);
    assert.ok(!workerStep.request.tools.some(tool => ['read_design', 'save_design', 'assign_member', 'create_member'].includes(tool.definition.name)));
    assert.match(workerStep.request.context.systemPrompt!, /Create src\/result.txt with Done/);
    assert.doesNotMatch(workerStep.request.context.systemPrompt!, /Pending design refinement/);
    answer(workerStep.events, call('write', { path: 'src/result.txt', content: 'Done' }));
    const workerCommit = await requests.next();
    answer(workerCommit.events, call('bash', { command: 'git add . && git commit -m "Implement the requested result file"', metadata: { git: { scope: 'implementation' } } }));
    const workerCommand = await requests.next();
    answer(workerCommand.events, call('bash', { command: 'cat src/result.txt' }));
    const workerFinish = await requests.next();
    const commandResult = workerFinish.request.context.messages.findLast(item => item.role === 'toolResult' && item.toolName === 'bash');
    assert.ok(commandResult?.role === 'toolResult' && commandResult.content[0]?.type === 'text');
    if (commandResult?.role === 'toolResult' && commandResult.content[0]?.type === 'text') assert.equal(JSON.parse(commandResult.content[0].text).stdout, 'Done');
    answer(workerFinish.events, message('@Lead Implemented src/result.txt and committed implementation.'));
    const leadFinish = await requests.next();
    const secondLeadRun = (await runtime.getState(lead.memberId)).run!;
    answer(leadFinish.events, message('Implementation is committed; design refinement awaits user approval.'));
    assert.equal((await runtime.finished(lead.memberId, secondLeadRun.runId)).status, 'completed');
    const backend = (await team.team(workspaceId)).members.find(m => m.name === 'Backend')!;
    const env = await team.harness.environment(backend.memberId);
    assert.equal(await readFile(join(env.root, 'src/result.txt'), 'utf8'), 'Done');
    await assert.rejects(stat(join(folder, 'project/src/result.txt')), code('ENOENT'));
    assert.ok((await team.harness.history(backend.memberId, 'implementation')).some(r => r.kind === 'commit' && r.actor.type === 'agent'));
    const review = await team.harness.inspect(lead.memberId);
    const pending = review.parts.find(p => p.state.part.id === 'design')!;
    assert.match(pending.diff, /Pending design refinement/);
    const committed = await team.harness.commit(lead.memberId, 'design', 'User accepted refinement', { type: 'user', memberId: lead.memberId }, pending.revision, pending.state.committed);
    assert.equal(committed.actor.type, 'user');
    assert.ok((await team.harness.history(lead.memberId, 'design')).some(r => r.actor.runId === run.runId && r.actor.type === 'harness'));
    const followed = await collect(runtime.follow(lead.memberId, { runId: run.runId }));
    assert.equal(followed.at(-1)?.type, 'end');
    assert.equal((await team.runner.snapshot(workspaceId)).messages.length, 4);
  } finally {
    await runtime.close();
    await team.runner.close();
    await workspaceService.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('workspace registry refuses duplicates; context commits reload with history and refuse a stale sequence', { timeout: 15_000 }, async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'workspace-')));
  const reopened = new MySqlStore(databaseUrl!);
  try {
    const directory = join(folder, 'project');
    const { workspaceId } = await workspaces.create({ name: 'Integration', directory, models: testModels(), adopt: false });
    const record = (await store.getWorkspace(workspaceId))!;
    assert.equal(record.directory, directory);
    assert.ok((await store.listWorkspaces()).some(item => item.workspaceId === workspaceId));
    const created = (await store.listMembers(workspaceId)).filter(member => member.value.lead);
    assert.equal(created.length, 1, 'a workspace is created with its lead');
    const duplicateId = randomUUID();
    const rival = newLead(duplicateId);
    await assert.rejects(store.createWorkspace({ ...record, workspaceId: duplicateId }, sha256(directory.toLowerCase()), rival), code('workspace_exists'));
    assert.equal(await store.getMember(rival.id), null, 'a refused workspace leaves no lead');
    await assert.rejects(store.getState(rival.id), code('not_found'));
    await assert.rejects(store.createWorkspace(record, sha256(randomUUID()), newLead(workspaceId)), code('workspace_exists'));
    assert.equal((await store.listMembers(workspaceId)).length, 1, 'a refused workspace adds no second lead');
    await assert.rejects(workspaces.create({ name: 'Inner', directory: join(directory, 'inner'), models: testModels(), adopt: false }), code('workspace_exists'));

    const context = await workspaces.context(workspaceId);
    const saved = await context.save('user/a.md', 'alpha', null, 'first');
    await context.move('user/a.md', 'user/b.md', saved.revision, 'rename');
    const loaded = await reopened.loadContext(workspaceId);
    assert.equal(loaded.seq, 2);
    assert.deepEqual(loaded.files.map(file => [file.path, file.size, file.author, file.reason]), [['user/b.md', 5, { type: 'user' }, 'rename']]);
    const file = loaded.files[0]!;
    assert.deepEqual((await reopened.history(workspaceId, file.fileId, null, 10)).map(version => [version.seq, version.action, version.path, version.fromPath]), [[2, 'move', 'user/b.md', 'user/a.md'], [1, 'create', 'user/a.md', null]]);
    assert.deepEqual((await reopened.history(workspaceId, file.fileId, 2, 10)).map(version => version.revision), [saved.revision]);
    assert.equal(await reopened.blob(workspaceId, file.hash), 'alpha');
    assert.equal((await reopened.version(workspaceId, saved.revision))?.path, 'user/a.md');
    assert.equal(await reopened.lastFileId(workspaceId, 'user/a.md'), file.fileId);
    assert.deepEqual((await reopened.records(workspaceId, 0, 10)).map(item => [item.seq, item.author, item.reason, item.files]), [
      [1, { type: 'user' }, 'first', [{ action: 'create', path: 'user/a.md', fromPath: null, revision: saved.revision }]],
      [2, { type: 'user' }, 'rename', [{ action: 'move', path: 'user/b.md', fromPath: 'user/a.md', revision: file.revision }]],
    ]);

    // A second process reloads the index and finds nothing to record.
    const service = new WorkspaceService(reopened, testModelValidator);
    try {
      assert.equal((await service.get(workspaceId)).context.seq, 2);
      assert.equal((await (await service.context(workspaceId)).read({ path: 'user/b.md' })).content, 'alpha');
    } finally { await service.close(); }

    // Another process stores change 3; this process's next change, also built on 2, is refused and undone on disk.
    const time = Date.now();
    const fileId = randomUUID();
    const revision = randomUUID();
    const hash = sha256('other');
    const external = { type: 'external' } as const;
    const other: ContextCommit = {
      seq: 3,
      blobs: [{ hash, content: 'other', size: 5 }],
      versions: [{ fileId, seq: 3, revision, action: 'create', path: 'user/c.md', fromPath: null, hash, size: 5, time, author: external, reason: null }],
      removeKeys: ['user/c.md'],
      files: [{ path: 'user/c.md', fileId, revision, hash, size: 5, mtimeMs: time, updatedAt: time, author: external, reason: null }],
      record: { seq: 3, time, author: external, reason: null, files: [{ action: 'create', path: 'user/c.md', fromPath: null, revision }] },
    };
    await reopened.commitContext(workspaceId, 2, other);
    await assert.rejects(context.save('user/d.md', 'mine', null, null), code('backend_error'));
    await assert.rejects(stat(join(directory, '.context', 'user', 'd.md')), code('ENOENT'));
    await assert.rejects(reopened.commitContext(workspaceId, 2, { ...other, versions: [], files: [], removeKeys: [] }), code('backend_error'));
    assert.deepEqual((await reopened.records(workspaceId, 0, 10)).map(item => item.seq), [1, 2, 3]);
    assert.deepEqual((await reopened.loadContext(workspaceId)).files.map(item => item.path).sort(), ['user/b.md', 'user/c.md']);
  } finally {
    await reopened.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('workspace model SQL persistence initializes leads atomically and default edits preserve assigned members', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'workspace-models-')));
  const service = new ConfigService(store, builtinModels());
  const workspaceService = new WorkspaceService(store, service);
  const team = new TeamSystem(store, workspaceService, service);
  const connectionId = `workspace-models-${randomUUID()}`;
  try {
    await service.createConnection(connectionId, { label: 'Workspace models', provider: 'openai', baseUrl: 'https://api.openai.com/v1', api: 'openai-responses' });
    const first = { connectionId, modelId: 'gpt-4.1-mini', maxTokens: 100 };
    const second = { connectionId, modelId: 'gpt-4.1' };
    const pool = { models: [first, second], defaultModel: { connectionId, modelId: first.modelId } };
    const created = await workspaceService.create({ name: 'Models', directory: join(folder, 'project'), adopt: false, models: pool });
    const lead = (await team.service.active(created.workspaceId))[0]!;
    assert.equal(lead.value.settings.modelId, first.modelId);
    assert.equal(lead.value.settings.modelOptions[0]?.maxTokens, 100);
    const initial = await workspaceService.models(created.workspaceId);
    const raced = await Promise.allSettled([
      workspaceService.updateModels(created.workspaceId, initial.revision, { ...pool, defaultModel: second }),
      workspaceService.updateModels(created.workspaceId, initial.revision, { ...pool, defaultModel: second }),
    ]);
    assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(raced.filter(r => r.status === 'rejected' && code('config_conflict')(r.reason)).length, 1);
    assert.deepEqual(await team.service.find(lead.id), lead);
    const member = await team.service.create(created.workspaceId, { name: 'Worker', role: 'developer' });
    assert.equal(member.settings.modelId, second.modelId);
    const reopened = new MySqlStore(databaseUrl!);
    try { assert.deepEqual(await reopened.getWorkspaceModels(created.workspaceId), { revision: initial.revision + 1, value: { ...pool, defaultModel: second } }); }
    finally { await reopened.close(); }
    const legacyId = randomUUID();
    await store.createWorkspace({ workspaceId: legacyId, name: 'Legacy', directory: join(folder, 'legacy'), createdAt: Date.now() }, sha256(legacyId), newLead(legacyId));
    const saved = await workspaceService.updateModels(legacyId, 0, pool);
    const legacyLead = (await team.service.active(legacyId))[0]!;
    assert.equal(legacyLead.value.settings.modelId, first.modelId);
    assert.equal(JSON.parse(legacyLead.value.configuration!.files['member.json']!).settings.modelId, first.modelId);
    await workspaceService.updateModels(legacyId, saved.revision, { ...pool, defaultModel: second });
    assert.deepEqual(await team.service.find(legacyLead.id), legacyLead);
    const failedId = randomUUID();
    const collision = { ...newLead(failedId), id: lead.id };
    await assert.rejects(store.createWorkspace({ workspaceId: failedId, name: 'Fail', directory: join(folder, 'fail'), createdAt: Date.now() }, sha256(failedId), collision, pool));
    assert.equal(await store.getWorkspace(failedId), null);
    assert.equal(await store.getWorkspaceModels(failedId), null);
    await assert.rejects(workspaceService.create({ name: 'Bad provider', directory: join(folder, 'bad'), adopt: false, models: testModels('missing', 'missing') }), code('invalid_config'));
    await assert.rejects(stat(join(folder, 'bad')), code('ENOENT'));
  } finally { await team.runner.close(); await workspaceService.close(); await rm(folder, { recursive: true, force: true }); }
});

async function groupFixture() {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'group-chat-')));
  const workspaceService = new WorkspaceService(store, { issuesFor: settings => service.issuesFor(settings) });
  const service = new ConfigService(store, builtinModels());
  const team = new TeamSystem(store, workspaceService, service);
  const requests = new Queue<{ request: ModelRequest; events: Queue<AssistantMessageEvent> }>();
  const runtime = new AgentRuntime(store, team.runConfig, team.policy(configuredPolicy()), request => {
    const events = new Queue<AssistantMessageEvent>(); requests.push({ request, events }); return events;
  });
  team.attach(runtime);
  const connectionId = `group-${randomUUID()}`;
  await service.createConnection(connectionId, { label: 'Group test', provider: 'openai', baseUrl: 'https://api.openai.com/v1', api: 'openai-responses' });
  const { workspaceId } = await workspaceService.create({ name: 'Group', directory: join(folder, 'project'), models: testModels(connectionId, 'gpt-4.1-mini'), adopt: false });
  const first = (await team.team(workspaceId)).members[0]!;
  const lead = await team.update(workspaceId, first.memberId, first.revision, { name: first.name, role: first.role, responsibility: first.responsibility, harness: { designScope: first.harness.designScope, allowedCommands: first.harness.allowedCommands }, settings: { ...first.settings, connectionId, modelId: 'gpt-4.1-mini' } });
  await team.designs.save(workspaceId, 'user/design.json', { content: 'Shared test design', implementation: ['.'] }, null, 'Test', { type: 'lead', memberId: lead.memberId, runId: 'fixture' });
  const harness = { designScope: { working: ['user/design.json'], dependencies: [] }, allowedCommands: [] };
  const backend = await team.create(workspaceId, { name: 'Backend', role: 'developer', harness });
  const frontend = await team.create(workspaceId, { name: 'Frontend', role: 'developer', harness });
  await runtime.open();
  return { workspaceId, lead, backend, frontend, team, runtime, requests, async close() { await runtime.close(); team.runner.close(); await workspaceService.close(); await rm(folder, { recursive: true, force: true }); } };
}

test('native commentary continues; stored ordinary final text streams and pins exact final blocks', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, 'Inspect model');
    const first = await f.requests.next();
    const signature = (phase: string) => JSON.stringify({ v: 1, id: `native-${phase}`, phase });
    answer(first.events, fauxAssistantMessage([{ type: 'text', text: 'Let me check the available models.', textSignature: signature('commentary') }]));
    const second = await f.requests.next();
    assert.equal((await store.chatSnapshot(f.workspaceId)).position, 1);
    assert.ok(!second.request.tools.some(tool => tool.definition.name === 'final_response'));
    assert.ok(!second.request.context.messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('private working output')));
    const final = fauxAssistantMessage([
      { type: 'text', text: 'I checked the configuration.', textSignature: signature('commentary') },
      { type: 'thinking', thinking: 'Hidden model reasoning' },
      { type: 'text', text: 'Model answer', textSignature: signature('final_answer') },
    ]);
    second.events.push({ type: 'start', partial: { ...final, content: [], stopReason: 'pending' } });
    const partial = { ...final, content: [{ type: 'text' as const, text: 'Model' }], stopReason: 'pending' as const };
    second.events.push({ type: 'text_delta', contentIndex: 0, delta: 'Model', partial });
    const stream = f.runtime.follow(f.lead.memberId, { runId: accepted.runs[0]!.runId })[Symbol.asyncIterator]();
    let chunk = await until(stream, 'chunk');
    while (chunk.type !== 'chunk' || chunk.event.type !== 'text_delta') chunk = await until(stream, 'chunk');
    assert.equal(chunk.event.partial.content[0]?.type, 'text');
    assert.equal('output' in chunk, false, 'raw stored blocks need no separate response annotation');
    assert.ok((await store.followSnapshot(f.lead.memberId, accepted.runs[0]!.runId, 0)).live?.chunks.some(c => c.event.type === 'text_delta'));
    assert.equal((await store.chatSnapshot(f.workspaceId)).position, 1, 'streaming text is not yet shared');
    second.events.push({ type: 'done', reason: 'stop', message: final });
    assert.equal((await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId)).status, 'completed');
    const entry = (await store.chatTimeline(f.workspaceId)).changes.at(-1)!.entry;
    if (entry.kind !== 'member') throw new Error('Missing member entry');
    assert.equal(entry.text, 'Model answer');
    assert.deepEqual(entry.finalRef?.contentIndices, [2]);
    assert.equal(entry.finalRef!.position, entry.working.through);
    assert.equal(entry.finalRef?.toolCallId, undefined);
    assert.deepEqual((await store.chatSnapshot(f.workspaceId)).messages.map(m => m.text), ['Inspect model', 'Model answer']);
    await stream.return?.(undefined);
  } finally { await f.close(); }
});

test('plain streamed commentary followed by tools stays private until a later natural answer', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, 'Check models');
    const first = await f.requests.next();
    const response = fauxAssistantMessage([{ type: 'text', text: 'Let me check.' }, { type: 'toolCall', id: 'models', name: 'list_models', arguments: {} }], { stopReason: 'toolUse' });
    answer(first.events, response);
    const second = await f.requests.next();
    assert.equal((await store.chatSnapshot(f.workspaceId)).position, 1);
    assert.ok(second.request.context.messages.some(m => m.role === 'toolResult' && m.toolCallId === 'models'));
    answer(second.events, message('Available models checked.'));
    assert.equal((await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId)).status, 'completed');
    assert.deepEqual((await store.chatSnapshot(f.workspaceId)).messages.map(m => m.text), ['Check models', 'Available models checked.']);
  } finally { await f.close(); }
});

test('truncated member text remains private and ends with an explicit incomplete status', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, 'Write report');
    answer((await f.requests.next()).events, fauxAssistantMessage('Unfinished report', { stopReason: 'length' }));
    const finished = await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId);
    assert.equal(finished.status, 'failed');
    assert.equal(finished.error?.code, 'incomplete_response');
    assert.equal((await store.chatSnapshot(f.workspaceId)).position, 1);
    const entry = (await store.chatTimeline(f.workspaceId)).changes.at(-1)!.entry;
    if (entry.kind !== 'member') throw new Error('Missing member entry');
    assert.equal(entry.finalRef, null);
  } finally { await f.close(); }
});

test('group chat SQL/runtime: parallel work, private refusal feedback, deferred interleaving, and durable public-only history', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const start = await f.team.runner.postUser(f.workspaceId, '@Backend @Frontend build');
    const first = await f.requests.next(); const second = await f.requests.next();
    const backendStep = /You are Backend,/.test(first.request.context.systemPrompt!) ? first : second;
    const frontendStep = backendStep === first ? second : first;
    assert.match(frontendStep.request.context.systemPrompt!, /You are Frontend,/);
    const backendRun = start.runs.find(run => run.agentId === f.backend.memberId)!;
    const frontendRun = start.runs.find(run => run.agentId === f.frontend.memberId)!;
    assert.equal((await f.runtime.getState(f.backend.memberId)).run?.status, 'running');
    assert.equal((await f.runtime.getState(f.frontend.memberId)).run?.status, 'running');
    assert.equal((await store.getContext(f.lead.memberId)).entries.length, 1);
    const user = await f.team.runner.postUser(f.workspaceId, '@Lead discuss');
    const leadStep = await f.requests.next();
    assert.match(leadStep.request.context.systemPrompt!, /You are Lead,/);
    assert.equal((await store.getContext(f.backend.memberId)).entries.length, 1, 'busy member receives no mid-work insertion');
    answer(backendStep.events, message('@Lead PRIVATE CANDIDATE: please review'));
    const revision = await f.requests.next();
    assert.match(revision.request.context.systemPrompt!, /You are Backend,/);
    assert.ok(revision.request.context.messages.some(item => item.role === 'user' && typeof item.content === 'string' && item.content.includes('Group publication refused (member_busy)')));
    assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 2);
    assert.equal((await store.getContext(f.frontend.memberId)).entries.length, 1);
    answer(revision.events, message('Backend finished without mentions.'));
    await f.runtime.finished(f.backend.memberId, backendRun.runId);
    const entries = (await store.getContext(f.backend.memberId)).entries;
    assert.deepEqual(entries.map(entry => entry.metadata.groupPosition ?? entry.metadata.source ?? entry.message.role), [1, 'assistant', 'publication-feedback', 'assistant', 2, 3]);
    assert.deepEqual((await store.runMessages(f.backend.memberId, backendRun.runId)).map(record => record.metadata.source ?? record.message.role), ['assistant', 'publication-feedback', 'assistant']);
    assert.equal((await store.getContext(f.frontend.memberId)).entries.length, 1);
    answer(frontendStep.events, message('Frontend finished.'));
    await f.runtime.finished(f.frontend.memberId, frontendRun.runId);
    answer(leadStep.events, message('Lead finished.'));
    await f.runtime.finished(f.lead.memberId, user.runs[0]!.runId);
    const transcript = await f.team.runner.snapshot(f.workspaceId);
    assert.equal(transcript.position, 5);
    assert.ok(!transcript.messages.some(item => item.text.includes('PRIVATE CANDIDATE')));
    const frontendContext = (await store.getContext(f.frontend.memberId)).entries;
    assert.ok(!frontendContext.some(entry => entry.metadata.source === 'publication-feedback'));
    assert.deepEqual(frontendContext.filter(entry => entry.metadata.groupPosition).map(entry => entry.metadata.groupPosition), [1, 2, 3, 4, 5]);
    const originalHistory = await store.runMessages(f.backend.memberId, backendRun.runId);
    const context = await store.getContext(f.backend.memberId);
    await store.replaceContext(f.backend.memberId, context.revision, [{ messageId: 'compacted-group', message: { role: 'user', content: 'Summary of my work', timestamp: 1 }, metadata: {} }]);
    assert.deepEqual(await store.runMessages(f.backend.memberId, backendRun.runId), originalHistory);
    assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 5);
    const next = await f.team.runner.postUser(f.workspaceId, '@Backend continue');
    const nextStep = await f.requests.next();
    assert.deepEqual(nextStep.request.context.messages.map(item => item.role === 'user' ? item.content : item.role), ['Summary of my work', '[Group message 6 from User]\n@Backend continue']);
    answer(nextStep.events, message('Continued.'));
    await f.runtime.finished(f.backend.memberId, next.runs[0]!.runId);
    const newcomer = await f.team.create(f.workspaceId, { name: 'New Member', role: 'developer' });
    assert.equal((await store.getContext(newcomer.memberId)).entries.length, 7);
    const reopened = new MySqlStore(databaseUrl!);
    try { assert.deepEqual(await reopened.chatSnapshot(f.workspaceId), await store.chatSnapshot(f.workspaceId)); }
    finally { await reopened.close(); }
    // History query needs neither a running member nor a model call.
    assert.equal((await f.team.runner.snapshot(f.workspaceId, 5, 1)).messages[0]?.position, 6);
  } finally { await f.close(); }
});

test('group harness checkpoints failed and cancelled runs and refuses publication when checkpointing fails', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    for (const outcome of ['cancelled', 'failed'] as const) {
      const accepted = await f.team.runner.postUser(f.workspaceId, '@Backend write partial implementation');
      const run = accepted.runs[0]!;
      const write = await f.requests.next();
      answer(write.events, fauxAssistantMessage([{ type: 'toolCall', id: randomUUID(), name: 'write', arguments: { path: 'partial.txt', content: outcome } }], { stopReason: 'toolUse' }));
      const pending = await f.requests.next();
      if (outcome === 'cancelled') await f.runtime.cancel(f.backend.memberId, run.runId);
      else pending.events.push({ type: 'error', reason: 'error', error: { ...message(), stopReason: 'error', errorMessage: 'Provider failed after write' } });
      assert.equal((await f.runtime.finished(f.backend.memberId, run.runId)).status, outcome);
      const history = await f.team.harness.history(f.backend.memberId, 'implementation');
      assert.ok(history.some(r => r.actor.type === 'harness' && r.actor.runId === run.runId));
      assert.ok(!history.some(r => r.kind === 'commit'));
    }
    const checkpoint = f.team.harness.checkpoint.bind(f.team.harness);
    f.team.harness.checkpoint = async () => { throw new Error('Git unavailable'); };
    try {
      const accepted = await f.team.runner.postUser(f.workspaceId, '@Backend report');
      const pending = await f.requests.next();
      answer(pending.events, message('Must not be shared without checkpoint'));
      assert.equal((await f.runtime.finished(f.backend.memberId, accepted.runs[0]!.runId)).status, 'failed');
      assert.ok(!(await f.team.runner.snapshot(f.workspaceId)).messages.some(m => m.text === 'Must not be shared without checkpoint'));
    } finally { f.team.harness.checkpoint = checkpoint; }
  } finally { await f.close(); }
});

test('group SQL publication is atomic under competing mentions and budgets; restart flushes pending delivery without replay', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    await f.team.runner.configure(f.workspaceId, 1);
    await assert.rejects(f.team.runner.postUser(f.workspaceId, '@Backend @Frontend work'), code('mention_limit'));
    assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 0);
    const [counts] = await store.pool.execute<any[]>('SELECT COUNT(*) AS count FROM chat_exchanges WHERE workspace_id = ?', [f.workspaceId]);
    assert.equal(counts[0].count, 0, 'failed publication creates no exchange');
    await f.team.runner.configure(f.workspaceId, 32);
    const results = await Promise.allSettled([f.team.runner.postUser(f.workspaceId, '@Backend one'), f.team.runner.postUser(f.workspaceId, '@Backend two')]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 1);
    const step = await f.requests.next();
    assert.match(step.request.context.systemPrompt!, /You are Backend,/);
    await f.team.runner.stop(f.workspaceId);
    const activity = (await f.team.runner.snapshot(f.workspaceId)).runs[0]!;
    await f.runtime.finished(f.backend.memberId, activity.run.runId);
    assert.equal((await f.team.runner.snapshot(f.workspaceId)).runs[0]!.run.status, 'cancelled');
    await f.runtime.close();
    // Simulate a crash after durable acceptance, before the model worker launches.
    const abandoned = await store.publishChat({ workspaceId: f.workspaceId, author: { type: 'user' }, text: '@Backend abandoned', recipients: [f.backend.memberId] });
    await store.publishChat({ workspaceId: f.workspaceId, author: { type: 'user' }, text: 'Shared while Backend is working', recipients: [] });
    assert.equal((await store.getContext(f.backend.memberId)).entries.at(-1)!.metadata.groupPosition, 2);
    let recoveredCheckpoint = false;
    const recoveryPolicy = f.team.policy(configuredPolicy());
    const recovery = new AgentRuntime(store, f.team.runConfig, { ...recoveryPolicy, afterRun: async run => {
      assert.equal(run.status, 'interrupted');
      assert.equal((await store.getState(run.agentId)).run?.status, 'running');
      await recoveryPolicy.afterRun!(run);
      recoveredCheckpoint = true;
    } }, () => { throw new Error('Restart must not replay a model call'); });
    await recovery.open();
    try {
      assert.equal((await recovery.getState(f.backend.memberId)).run?.status, 'interrupted');
      assert.equal(recoveredCheckpoint, true);
      assert.equal((await store.getContext(f.backend.memberId)).entries.at(-1)!.metadata.groupPosition, 3);
      assert.equal((await store.runMessages(f.backend.memberId, abandoned.runs[0]!.runId)).length, 0);
      assert.equal((await store.chatSnapshot(f.workspaceId)).position, 3);
    } finally { await recovery.close(); }
    const retained = await store.getContext(f.backend.memberId);
    await f.team.service.retire(f.workspaceId, f.backend.memberId, f.backend.revision);
    await store.publishChat({ workspaceId: f.workspaceId, author: { type: 'user' }, text: 'After Backend retired', recipients: [] });
    await store.syncChatMember(f.backend.memberId);
    assert.deepEqual(await store.getContext(f.backend.memberId), retained, 'retirement excludes later messages even on explicit delivery');
    assert.equal((await store.getContext(f.frontend.memberId)).entries.at(-1)!.metadata.groupPosition, 4);
  } finally { await f.close(); }
});


test('shutdown waits for in-flight solo input acceptance, registers its run, then cancels it durably', { timeout: 15_000 }, async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const preparing = new Promise<void>(resolve => { entered = resolve; });
  const runtime = new AgentRuntime(store, { resolveForRun: async () => { entered(); await gate; return staticConfig.resolveForRun(); } }, fixedPolicy(model), async function* () {
    await new Promise<void>(() => undefined);
    yield { type: 'done', reason: 'stop', message: message('unreachable') };
  });
  await runtime.open();
  try {
    const { agentId } = await store.createAgent();
    const acceptance = runtime.start(agentId, 'accepted before shutdown');
    await preparing;
    const shutdown = runtime.close();
    release();
    const run = await acceptance;
    await shutdown;
    assert.equal((await store.getState(agentId)).run?.status, 'cancelled');
    assert.equal((await store.runMessages(agentId, run.runId)).length, 1);
  } finally { release(); await runtime.close(); }
});

test('group timeline reserves deterministic positions, pins final references and ranges, and replays older entry updates', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, '@Backend @Frontend build');
    const first = await f.requests.next(); const second = await f.requests.next();
    const backendStep = /You are Backend,/.test(first.request.context.systemPrompt!) ? first : second;
    const frontendStep = backendStep === first ? second : first;
    assert.deepEqual(accepted.entries.map(entry => entry.kind === 'member' ? entry.name : 'User'), ['User', 'Backend', 'Frontend']);
    const cursor = (await store.chatTimeline(f.workspaceId)).cursor;
    const later = await f.team.runner.postUser(f.workspaceId, '@Lead discuss'); const leadStep = await f.requests.next();
    answer(frontendStep.events, message('Frontend final first'));
    await f.runtime.finished(f.frontend.memberId, accepted.runs[1]!.runId);
    answer(backendStep.events, message('Backend final second'));
    await f.runtime.finished(f.backend.memberId, accepted.runs[0]!.runId);
    answer(leadStep.events, message('Lead final'));
    await f.runtime.finished(f.lead.memberId, later.runs[0]!.runId);
    const snapshot = await store.chatTimeline(f.workspaceId);
    const current = new Map(snapshot.changes.map(change => [change.entry.entryId, change.entry]));
    const ordered = [...current.values()].sort((a, b) => a.position - b.position);
    assert.deepEqual(ordered.map(entry => entry.kind === 'member' ? entry.name : 'User'), ['User', 'Backend', 'Frontend', 'User', 'Lead']);
    const backend = ordered[1]!;
    assert.equal(backend.kind, 'member');
    if (backend.kind !== 'member') throw new Error('member missing');
    assert.equal(backend.text, 'Backend final second');
    const records = await store.runMessages(f.backend.memberId, accepted.runs[0]!.runId);
    assert.equal(backend.finalRef!.messageId, records.at(-1)!.messageId);
    assert.equal(backend.working.through, records.at(-1)!.position);
    const context = await store.getContext(f.backend.memberId);
    await store.replaceContext(f.backend.memberId, context.revision, []);
    await f.team.runner.retire(f.workspaceId, f.backend.memberId, f.backend.revision);
    assert.deepEqual(await store.chatTimeline(f.workspaceId), snapshot, 'retirement/compaction preserve pinned history');
    const changes = await store.chatTimeline(f.workspaceId, cursor, 1);
    assert.equal(changes.changes.length, 1); assert.equal(changes.more, true);
    assert.ok(snapshot.changes.filter(change => change.cursor > cursor).some(change => change.entry.position === 2), 'new cursor carries older response completion');
    const [publicRows] = await store.pool.execute<any[]>('SELECT entry FROM chat_messages WHERE workspace_id = ?', [f.workspaceId]);
    const storedFinals = publicRows.map(row => typeof row.entry === 'string' ? JSON.parse(row.entry).data : row.entry.data).filter(entry => entry.author.type === 'member');
    assert.ok(storedFinals.every(entry => entry.finalRef && entry.text === undefined), 'public history stores references, not duplicate final text');
    const reopened = new MySqlStore(databaseUrl!);
    try { await reopened.migrate(); assert.deepEqual(await reopened.chatTimeline(f.workspaceId), snapshot); } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test('group timeline refusal creates no reservation, and cancellation/restart finalize retained entries without a final', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, '@Backend work'); await f.requests.next();
    const before = await store.chatTimeline(f.workspaceId);
    await assert.rejects(f.team.runner.postUser(f.workspaceId, '@Backend @Frontend again'), (error: unknown) => (error as { code: string }).code === 'member_busy');
    assert.deepEqual(await store.chatTimeline(f.workspaceId), before);
    await assert.rejects(store.publishChat({ workspaceId: f.workspaceId, author: { type: 'member', memberId: f.backend.memberId, name: 'Backend', runId: accepted.runs[0]!.runId }, exchangeId: accepted.message.exchangeId, text: 'fake', recipients: [], finalMessageId: 'wrong' }));
    assert.deepEqual(await store.chatTimeline(f.workspaceId), before);
    await f.team.runner.stop(f.workspaceId);
    await f.runtime.finished(f.backend.memberId, accepted.runs[0]!.runId);
    const entry = (await store.chatTimeline(f.workspaceId)).changes.at(-1)!.entry;
    assert.equal(entry.kind, 'member');
    if (entry.kind === 'member') { assert.equal(entry.run.status, 'cancelled'); assert.equal(entry.finalRef, null); assert.equal(entry.position, 2); assert.equal(entry.working.through, 0); }
    const input = await store.publishChat({ workspaceId: f.workspaceId, author: { type: 'user' }, text: 'abandoned work', recipients: [f.frontend.memberId] });
    await f.runtime.close(); // Persisted but unlaunched work remains abandoned until recovery.
    const reopened = new AgentRuntime(store, teamFor(f.runtime).runConfig, configuredPolicy(), () => { throw new Error('Recovery must not run a model'); });
    await reopened.open();
    try {
      const recovered = (await store.chatTimeline(f.workspaceId)).changes.at(-1)!.entry;
      assert.equal(recovered.entryId, input.runs[0]!.runId);
      if (recovered.kind === 'member') { assert.equal(recovered.run.status, 'interrupted'); assert.equal(recovered.finalRef, null); assert.equal(recovered.working.through, recovered.run.endPosition); }
    } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test('old prototype group history imports once in publication order using the old terminal history bound', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await store.publishChat({workspaceId:f.workspaceId,author:{type:'user'},text:'work',recipients:[f.lead.memberId]});
    const run=accepted.runs[0]!;
    const messageId=randomUUID();
    await store.beginMessage(f.lead.memberId,run.runId,messageId,1);
    await store.commitMessage(f.lead.memberId,run.runId,{messageId,message:message('Existing prototype final'),metadata:{}});
    await store.publishChat({workspaceId:f.workspaceId,author:{type:'member',memberId:f.lead.memberId,name:'Lead',runId:run.runId},exchangeId:accepted.message.exchangeId,text:'Existing prototype final',recipients:[],finalMessageId:messageId});
    const history = await store.chatSnapshot(f.workspaceId);
    const record = history.messages[1]!;
    // Recreate the immediately previous committed storage format in this disposable workspace.
    await store.pool.execute('UPDATE chat_messages SET entry = ? WHERE workspace_id = ? AND position = ?', [JSON.stringify({ version: 1, data: { workspaceId: record.workspaceId, messageId: record.messageId, position: record.position, exchangeId: record.exchangeId, author: record.author, text: record.text, recipients: record.recipients, time: record.time } }), f.workspaceId, record.position]);
    for (const table of ['chat_changes', 'chat_entries', 'chat_clock']) await store.pool.execute(`DELETE FROM ${table} WHERE workspace_id = ?`, [f.workspaceId]);
    await store.migrate();
    const imported = await store.chatTimeline(f.workspaceId);
    assert.deepEqual(imported.changes.map(change => change.entry.kind), ['user', 'member']);
    const final = imported.changes[1]!.entry;
    if (final.kind === 'member') { assert.equal(final.text, 'Existing prototype final'); assert.equal(final.finalRef!.position, final.run.endPosition); }
    await store.migrate(); assert.deepEqual(await store.chatTimeline(f.workspaceId), imported, 'upgrade is repeatable');
    assert.deepEqual((await store.chatSnapshot(f.workspaceId)).messages.map(message => message.text), history.messages.map(message => message.text));
  } finally { await f.close(); }
});

test('member file activation atomically replaces/updates the team, retains history and leaves pending bytes inactive', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, '@Backend establish history');
    answer((await f.requests.next()).events, message('Established shared history.'));
    await f.runtime.finished(f.backend.memberId, accepted.runs[0]!.runId);
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    const oldContext = await store.getContext(f.backend.memberId);
    await f.team.configuration.materialize(f.lead.memberId);
    const files = await f.team.harness.files(f.lead.memberId);
    const backendSource = await f.team.configuration.accepted(f.workspaceId, f.backend.memberId);
    const frontendSource = await f.team.configuration.accepted(f.workspaceId, f.frontend.memberId);
    const { dirname, join: pathJoin } = await import('node:path');
    await rm(pathJoin(files.root, backendSource.path));
    await files.write.writeFile(pathJoin(files.root, frontendSource.path), JSON.stringify({ ...JSON.parse(frontendSource.files['member.json']!), responsibility: 'Updated atomically' }));
    await files.write.mkdir(pathJoin(files.root, '.team/members/replacement/prompts'));
    const manifest = { name:'Backend',role:'developer',responsibility:'Replacement',settings:{},promptFiles:['prompts/member.md'],designScope:{working:['user/design.json'],dependencies:[]},execute:{allowedCommands:[]} };
    await files.write.writeFile(pathJoin(files.root, '.team/members/replacement/member.json'), JSON.stringify(manifest));
    await files.write.writeFile(pathJoin(files.root, '.team/members/replacement/prompts/member.md'), 'Accepted prompt');
    const pending = await f.team.configuration.validate(f.lead.memberId, '.team/members'); assert.equal(pending.valid, true, JSON.stringify(pending.issues));
    const part = (await f.team.harness.inspect(f.lead.memberId)).parts.find(p => p.state.part.id === 'member-config')!;
    await f.team.harness.commit(f.lead.memberId, 'member-config', 'User accepts team replacement', {type:'user',memberId:f.lead.memberId}, part.revision, part.state.committed);
    const review = await f.team.reviewConfiguration(f.workspaceId);
    assert.deepEqual(review.changes.map(c => c.type).sort(), ['create','delete','update']);
    await files.write.writeFile(pathJoin(files.root, '.team/members/replacement/prompts/member.md'), 'Pending after commit');
    await f.team.activateConfiguration(f.workspaceId, review.revision, review.digest);
    const replacement = (await f.team.service.byName(f.workspaceId, 'Backend'))!;
    const marker = await store.getMemberActivation(f.workspaceId);
    assert.equal(marker!.revision, review.revision);
    const reopenedStore = new MySqlStore(databaseUrl!);
    try { assert.deepEqual(await reopenedStore.getMemberActivation(f.workspaceId), marker); }
    finally { await reopenedStore.close(); }
    assert.notEqual(replacement.id, f.backend.memberId); assert.equal(replacement.value.settings.prompt, 'Accepted prompt');
    assert.equal((await f.team.member(f.workspaceId, f.frontend.memberId)).responsibility, 'Updated atomically');
    assert.ok((await store.getMember(f.backend.memberId))!.value.retiredAt !== null);
    assert.deepEqual(await store.getContext(f.backend.memberId), oldContext);
    assert.equal((await store.getContext(replacement.id)).entries.length, (await f.team.runner.snapshot(f.workspaceId)).messages.length);
    assert.equal((await f.team.runner.snapshot(f.workspaceId)).runs.length, 1, 'activation starts no runs');
    const reopened = new TeamSystem(store, workspaces, config); reopened.attach(f.runtime);
    try { assert.equal((await reopened.configuration.accepted(f.workspaceId, replacement.id)).acceptedRevision, review.revision); }
    finally { await reopened.runner.close(); }
  } finally { await f.close(); }
});

test('member activation store rejects busy/stale state and rolls back earlier member updates on insertion failure', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const active = await f.team.service.active(f.workspaceId), before = await store.getMember(f.frontend.memberId);
    const modelsRevision = (await f.team.service.models(f.workspaceId)).revision;
    const expected = active.map(m => ({id:m.id,revision:m.revision}));
    const update = { ...before!,revision:before!.revision+1,value:{...before!.value,responsibility:'Must roll back'} };
    const duplicate = { id:randomUUID(),workspaceId:f.workspaceId,lead:false,nameKey:'frontend',value:{...before!.value,lead:false} };
    await assert.rejects(store.activateMembers(f.workspaceId,{expectedActivation:null,activation:{revision:'test',time:0},expected,modelsRevision,create:[duplicate],update:[update]}),code('member_exists'));
    assert.equal(await store.getMemberActivation(f.workspaceId), null, 'activation marker rolls back with roster changes');
    assert.deepEqual(await store.getMember(f.frontend.memberId),before);
    await assert.rejects(store.activateMembers(f.workspaceId,{expectedActivation:null,activation:{revision:'test',time:0},expected:[],modelsRevision,create:[],update:[]}),code('config_conflict'));
    const accepted = await f.team.runner.postUser(f.workspaceId,'@Backend work');
    const response = await f.requests.next();
    await assert.rejects(store.activateMembers(f.workspaceId,{expectedActivation:null,activation:{revision:'test',time:0},expected,modelsRevision,create:[],update:[update]}),code('workspace_busy'));
    assert.deepEqual(await store.getMember(f.frontend.memberId),before);
    answer(response.events,message('Done.')); await f.runtime.finished(f.backend.memberId,accepted.runs[0]!.runId);
  } finally { await f.close(); }
});
