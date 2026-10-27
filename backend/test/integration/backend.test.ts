import { harnessPrompt } from '../../src/core/harness/harness-prompts.js';
import { compactionInput, validateCompactionState, type CompactionSettings, type CompactionState } from '../../src/core/agent/data/compaction.js';
import { AgentMessageContext } from '../../src/core/agent/data/context.js';
import { decode, encode } from '../../src/core/codec.js';
import { MySqlStorage } from '../../src/storage/mysql.js';
import { acceptFiles,initGit,waitApproval } from '../git-fixture.js';
import { gitText } from '../../src/core/workspace/workspace-git.js';
import { seedDesign } from '../design-fixture.js';
import { testModels, testModelValidator } from '../memory-store.js';
import { emptyHarness } from '../../src/core/harness/data/config.js';
import { closeBashRuntime } from '../../src/core/harness/harness-command.js';
import type { JsonObject } from '@earendil-works/pi-ai';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createModels, fauxAssistantMessage, fauxProvider, Type, type AssistantMessageEvent, type Message } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { CoreData } from '../../src/core/data.js';
import { ConfigService, emptyRunSettings } from '../../src/core/team/data/config.js';
import { createBackendModels } from '../../src/core/agent/providers.js';
import { AgentRuntime, configuredPolicy, fixedPolicy, piModelStream, type ModelRequest, type RuntimePolicy, type RuntimeTool } from '../../src/core/agent/runtime.js';
import { createAgentServer } from '../../src/api/http.js';
import { TeamSystem } from '../../src/core/team/team-system.js';
import { webTools } from '../../src/core/harness/web-tools.js';
import { newLead } from '../../src/core/team/data/members.js';
import { WorkspaceService } from '../../src/core/workspace/workspace.js';
import type { ContextCommit } from '../../src/core/workspace/data/context-base.js';
import { sha256 } from '../../src/core/text.js';
import type { ContextEntry, FollowEvent } from '../../src/core/agent/data/model.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to a disposable MySQL 8.4 database (see README)');
const store = new CoreData(new MySqlStorage(databaseUrl));
const config = new ConfigService(store.config, createModels());
const workspaces = new WorkspaceService(store.workspaces, testModelValidator);
const testEncryptionKey = Buffer.alloc(32, 7).toString('base64');
before(async () => {
  await store.migrate();
  await config.initialize();
});
after(async () => { await closeBashRuntime(); await workspaces.close(); await store.close(); });
const unconfigured = ['Select a provider and model'];
/** A team over the store for an HTTP server whose runtime is `runtime`. */
function teamFor(runtime: AgentRuntime): TeamSystem {
  const team = new TeamSystem(store.team, workspaces, config);
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

async function fixture(options: { policy?: RuntimePolicy; progressCapacity?: number; maxSteps?: number } = {}) {
  const requests = new Queue<{ request: ModelRequest; events: Queue<AssistantMessageEvent> }>();
  const runtime = new AgentRuntime(store.agents, staticConfig, options.policy ?? fixedPolicy(model), request => {
    const events = new Queue<AssistantMessageEvent>();
    requests.push({ request, events });
    return events;
  }, options);
  await runtime.open();
  const agentId = randomUUID();
  await store.agents.createAgent(agentId);
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
  const { agentId } = await store.agents.createAgent();
  const attempts = await Promise.allSettled([store.agents.startRun(agentId, user), store.agents.startRun(agentId, user)]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  const run = attempts.find(item => item.status === 'fulfilled')!;
  assert.equal(run.status, 'fulfilled');
  if (run.status !== 'fulfilled') return;
  const original = await store.agents.followSnapshot(agentId, run.value.runId, 0);
  assert.equal(original.history.length, 1);
  const context = await store.agents.getContext(agentId);
  await store.agents.replaceContext(agentId, context.revision, [{ messageId: 'summary', message: { role: 'system', content: 'summary', timestamp: 2 }, metadata: { revision: 1 } }]);
  await assert.rejects(store.agents.replaceContext(agentId, context.revision, []), /revision changed/);
  assert.deepEqual((await store.agents.followSnapshot(agentId, run.value.runId, 0)).history, original.history);
  await assert.rejects(store.agents.commitMessage(agentId, run.value.runId, { ...original.history[0]!, message: { role: 'toolResult', toolCallId: 'x', toolName: 'x', content: [], isError: false, timestamp: 1 } }), /exists/);
  assert.equal((await store.agents.getContext(agentId)).entries.length, 1);
  await store.agents.finishRun(agentId, run.value.runId, 'completed');
});

test('MySQL stores completed messages and run markers without transient chunk tables', { timeout: 15_000 }, async () => {
  const { agentId } = await store.agents.createAgent();
  const run = await store.agents.startRun(agentId, user), id = randomUUID();
  assert.equal(await store.agents.beginMessage(agentId, run.runId, id, 1), 1);
  const preserved = await store.agents.followSnapshot(agentId, run.runId, 0);
  await store.pool.query('CREATE TABLE live_messages (id VARCHAR(64) PRIMARY KEY)');
  await store.pool.query('CREATE TABLE chunks (message_id VARCHAR(64), FOREIGN KEY (message_id) REFERENCES live_messages(id))');
  await store.pool.query("INSERT INTO live_messages VALUES ('obsolete')");
  await store.pool.query("INSERT INTO chunks VALUES ('obsolete')");
  await store.migrate();
  assert.deepEqual(await store.agents.followSnapshot(agentId, run.runId, 0), preserved, 'transient migration preserves stable history and run state');
  const [tables] = await store.pool.query("SHOW TABLES LIKE 'chunks'");
  assert.deepEqual(tables, []);
  const [live] = await store.pool.query("SHOW TABLES LIKE 'live_messages'");
  assert.deepEqual(live, []);
  const before = await store.agents.followSnapshot(agentId, run.runId, 0);
  assert.equal(before.state.run?.activeMessageId, id);
  assert.equal(before.history.length, 1);
  await store.agents.commitMessage(agentId, run.runId, { messageId: id, message: message('whole'), metadata: { kept: true } });
  const snapshot = await store.agents.followSnapshot(agentId, run.runId, 0);
  assert.equal(snapshot.state.run?.activeMessageId, null);
  assert.equal(snapshot.history[1]?.messageId, id);
  await store.agents.finishRun(agentId, run.runId, 'completed');
});

test('real Pi provider collection drives shared loop, validates and executes tool, uses in-memory compaction with caller persistence', { timeout: 15_000 }, async () => {
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
  const runtime = new AgentRuntime(store.agents, staticConfig, {
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
  const readContext = store.agents.getContext; let contextReads = 0;
  store.agents.getContext = async agentId => { contextReads++; return readContext.call(store.agents, agentId); };
  try {
    const { agentId } = await store.agents.createAgent();
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
    assert.equal(contextReads, 1, 'Agent loads resident context once and maintains later model context in memory');
    assert.deepEqual((await store.agents.getContext(agentId)).entries.map(entry => entry.message.role), ['user', 'assistant']);
  } finally { store.agents.getContext = readContext; await runtime.close(); }
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
  const f = await fixture({ progressCapacity: 0 });
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    const { events } = await f.requests.next();
    const stream = f.runtime.follow(f.agentId, { runId: run.runId });
    await until(stream, 'sync');
    events.push({ type: 'start', partial: message('partial') });
    const gap = await until(stream, 'gap');
    assert.equal(gap.type, 'gap');
    events.push({ type: 'text_start', contentIndex: 0, partial: message('partialtail') });
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

test('model errors fail runs while invalid tool arguments return results for the model to handle', { timeout: 15_000 }, async () => {
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
    const recovery = await f.requests.next();
    const invalid = recovery.request.context.messages.find(m => m.role === 'toolResult' && m.toolCallId === 'bad-call');
    assert.ok(invalid?.role === 'toolResult' && invalid.isError);
    answer(recovery.events, message('The request needs a value; please provide it.'));
    const result = await collect(f.runtime.follow(f.agentId, { runId: second.runId }));
    assert.equal((await f.runtime.getState(f.agentId)).run?.status, 'completed');
    const tool = result.find(event => event.type === 'message' && event.record.message.role === 'toolResult');
    assert.ok(tool && tool.type === 'message' && tool.record.message.role === 'toolResult' && tool.record.message.isError);
  } finally { await f.runtime.close(); }
});

test('web tool Markdown and metadata persist independently of context and replay through the frontend follow API', { timeout: 15_000 }, async () => {
  let unavailable = false;
  const key = 'integration-web-key-not-a-real-credential';
  const tools = webTools(key, async url => unavailable ? new Response(key, { status: 429 }) : Response.json(String(url).endsWith('/search')
    ? { results: [{ title: 'Example', url: 'https://example.com', summary: 'Verbose summary must stay out.', snippet: 'Search snippet.' }] }
    : { title: 'Example', content: '# Page\n\nFetched Markdown.' }));
  const f = await fixture({ policy: fixedPolicy(model, tools) });
  const team = teamFor(f.runtime);
  const server = createAgentServer(f.runtime, config, workspaces, team);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const call = (name: string, args: JsonObject) => fauxAssistantMessage([{ type: 'toolCall', id: randomUUID(), name, arguments: args }], { stopReason: 'toolUse' });
  const follow = async (runId: string) => {
    const response = await fetch(`http://127.0.0.1:${port}/agents/${f.agentId}/follow?runId=${runId}&after=0`);
    assert.equal(response.status, 200);
    return [...(await response.text()).matchAll(/^data: (.*)$/gm)].map(match => JSON.parse(match[1]!) as FollowEvent);
  };
  try {
    const run = await f.runtime.start(f.agentId, 'Search and read');
    answer((await f.requests.next()).events, call('web_search', { query: 'example site:example.com' }));
    const second = await f.requests.next();
    assert.ok(second.request.context.messages.some(m => m.role === 'toolResult' && m.toolName === 'web_search'));
    answer(second.events, call('web_fetch', { url: 'https://example.com' }));
    answer((await f.requests.next()).events, message('Read the source.'));
    assert.equal((await f.runtime.finished(f.agentId, run.runId)).status, 'completed');
    const before = await follow(run.runId);
    const records = before.filter(event => event.type === 'message').map(event => event.record);
    const results = records.filter(record => record.message.role === 'toolResult');
    assert.equal(results.length, 2);
    assert.match(JSON.stringify(results[0]!.message), /Search snippet/);
    assert.match(JSON.stringify(results[1]!.message), /Fetched Markdown/);
    for (const record of results) {
      assert.equal(record.message.role, 'toolResult');
      if (record.message.role !== 'toolResult') continue;
      assert.equal(record.message.isError, false);
      assert.ok(record.message.content.some(part => part.type === 'text' && part.text.includes('<metadata>') && part.text.endsWith('</metadata>')));
      assert.ok(!JSON.stringify(record).includes(key));
    }
    const context = await store.agents.getContext(f.agentId);
    await store.agents.replaceContext(f.agentId, context.revision, [{ messageId: 'web-summary', message: { role: 'user', content: 'Compacted source context.', timestamp: 1 }, metadata: {} }]);
    assert.deepEqual((await follow(run.runId)).filter(event => event.type === 'message').map(event => event.record), records, 'frontend reads stable database history after model context changes');

    unavailable = true;
    const failure = await f.runtime.start(f.agentId, 'Try unavailable web provider');
    answer((await f.requests.next()).events, call('web_fetch', { url: 'https://example.com' }));
    const recovery = await f.requests.next();
    const errorResult = recovery.request.context.messages.find(m => m.role === 'toolResult' && m.toolName === 'web_fetch');
    assert.ok(errorResult?.role === 'toolResult' && errorResult.isError);
    assert.match(JSON.stringify(errorResult), /web_rate_limited/);
    answer(recovery.events, message('The provider is rate limited; here is what I can conclude without that page.'));
    assert.equal((await f.runtime.finished(f.agentId, failure.runId)).status, 'completed');
    const events = await follow(failure.runId);
    const failed = events.find(event => event.type === 'message' && event.record.runId === failure.runId && event.record.message.role === 'toolResult');
    assert.ok(failed && failed.type === 'message' && failed.record.message.role === 'toolResult' && failed.record.message.isError);
    assert.match(JSON.stringify(failed), /web_rate_limited/);
    assert.ok(!JSON.stringify(events).includes(key));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await team.runner.close();
    await f.runtime.close();
  }
});

test('database commit failure is never announced as completed and terminal failure is observable', { timeout: 15_000 }, async () => {
  const f = await fixture();
  const original = store.agents.commitMessage.bind(store.agents);
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    store.agents.commitMessage = async () => { throw new Error('simulated write outage'); };
    answer((await f.requests.next()).events);
    const events = await collect(f.runtime.follow(f.agentId, { runId: run.runId }));
    assert.equal(events.filter(event => event.type === 'message').length, 1);
    assert.equal((await f.runtime.getState(f.agentId)).run?.status, 'failed');
  } finally { store.agents.commitMessage = original; await f.runtime.close(); }
});

test('runtime owner lock excludes second owner and startup recovers abandoned runs', { timeout: 15_000 }, async () => {
  const other = new CoreData(new MySqlStorage(databaseUrl!));
  const f = await fixture();
  try {
    await assert.rejects(other.agents.acquireRuntime(() => {}), /Another runtime/);
  } finally { await other.close(); await f.runtime.close(); }
  const abandoned = await store.agents.startRun(f.agentId, user);
  await store.agents.beginMessage(f.agentId, abandoned.runId, randomUUID(), 1);
  const recovered = new AgentRuntime(store.agents, staticConfig, fixedPolicy(model), () => new Queue());
  await recovered.open();
  try {
    const state = await recovered.getState(f.agentId);
    assert.equal(state.run?.status, 'interrupted');
    assert.equal((await store.agents.followSnapshot(f.agentId, abandoned.runId, 0)).state.run?.activeMessageId, null);
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
  const runtime = new AgentRuntime(store.agents, staticConfig, fixedPolicy(model), async function* () {
    yield { type: 'start', partial: message() };
  });
  await runtime.open();
  try {
    const { agentId } = await store.agents.createAgent();
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
  const original = store.agents.finishRun.bind(store.agents);
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    store.agents.finishRun = async () => { throw new Error('terminal write unavailable'); };
    answer((await f.requests.next()).events);
    await assert.rejects(collect(f.runtime.follow(f.agentId, { runId: run.runId })), /terminal state could not be persisted/);
    await assert.rejects(f.runtime.getState(f.agentId), /terminal state could not be persisted/);
  } finally {
    store.agents.finishRun = original;
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
  const service = new ConfigService(store.config, models, [], testEncryptionKey);
  const { agentId } = await store.agents.createAgent();
  const connectionId = `connection-${randomUUID()}`;
  const connectionValue = { label: 'First connection', provider: firstModel.provider, baseUrl: firstModel.baseUrl, api: 'openai-completions', apiKey: 'first-key' };
  const connection = await service.createConnection(connectionId, connectionValue);
  assert.equal(connection.value.keyConfigured, true);
  assert.equal(JSON.stringify(connection).includes('first-key'), false);
  assert.ok((await service.modelChoices(connectionId)).some(item => item.modelId === firstModel.id));
  await assert.rejects(service.updateConnection(connectionId, 10, connectionValue), /revision changed/);
  const requests = new Queue<{ request: ModelRequest; events: Queue<AssistantMessageEvent> }>();
  const runtime = new AgentRuntime(store.agents, service, { ...configuredPolicy(), shouldContinue: scope => scope.step === 1 }, request => {
    const events = new Queue<AssistantMessageEvent>(); requests.push({ request, events }); return events;
  });
  await runtime.open();
  try {
    await assert.rejects(runtime.start(agentId, 'invalid'), /Select a provider and model/);
    assert.equal((await store.agents.getState(agentId)).historyPosition, 0);
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
  const { agentId } = await store.agents.createAgent();
  const service = new ConfigService(store.config, builtinModels());
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
  const { agentId } = await store.agents.createAgent();
  await store.config.createConfig('catalog', id, { kind: 'model', label: 'Old model', provider: model.provider, modelId: model.id,
    allowedReasoning: [], allowTemperature: true, allowMaxTokens: true });
  const initial = await store.config.getConfig<Record<string, unknown>>('agent', agentId);
  await store.config.updateConfig('agent', agentId, initial.revision, { name: 'Legacy', modelOptionId: id, toolOptionIds: [], prompt: '', promptOptionIds: [], callOptions: {} });
  const service = new ConfigService(store.config, models);
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
  const service = new ConfigService(store.config, models);
  const connectionId = `legacy-endpoint-${randomUUID()}`;
  await service.createConnection(connectionId, { label: 'Legacy endpoint', provider: 'legacy-custom', baseUrl: 'http://127.0.0.1:9999/v1', api: 'openai-completions' });
  const profileId = `legacy-profile-${randomUUID()}`;
  await store.config.createConfig('catalog', profileId, { kind: 'model', label: 'Legacy discovered', connectionId, provider: 'legacy-custom',
    modelId: 'endpoint-model', api: 'openai-completions', source: 'endpoint', maxTokens: 2048, reasoning: false,
    allowedReasoning: [], allowTemperature: true, allowMaxTokens: true });
  const { agentId } = await store.agents.createAgent();
  const initial = await store.config.getConfig<Record<string, unknown>>('agent', agentId);
  await store.config.updateConfig('agent', agentId, initial.revision, { name: '', modelOptionId: profileId, toolOptionIds: [], prompt: '', promptOptionIds: [], callOptions: {} });
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
  const service = new ConfigService(store.config, models, [tool]);
  const { agentId } = await store.agents.createAgent();
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
  const runtime = new AgentRuntime(store.agents, service, configuredPolicy(), request => {
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
  const service = new ConfigService(store.config, models);
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

  const { agentId } = await store.agents.createAgent();
  const raw = await store.config.getConfig<Record<string, unknown>>('agent', agentId);
  await store.config.updateConfig('agent', agentId, raw.revision, { name: '', connectionId: openai, modelId: 'gpt-5', toolOptionIds: [], prompt: '', promptOptionIds: [], callOptions: { reasoning: 'max' } });
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

  const other = await store.agents.createAgent();
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
  await store.config.updateConfig('agent', agentId, onPlain.revision, { ...onPlain.value, modelId: 'gpt-5', modelOptions: [{ ...twice, reasoning: 'max', temperature: 1 }] });
  const dropped = await service.getAgent(agentId);
  assert.deepEqual(dropped.value.modelOptions, [{ ...twice, temperature: 1 }]);
  assert.deepEqual(dropped.issues, []);
});

test('an agent config has no workspace, and one stored by the earlier binding is ignored', async () => {
  const service = new ConfigService(store.config, builtinModels());
  const { agentId } = await store.agents.createAgent();
  const empty = await service.getAgent(agentId);
  assert.equal('workspaceId' in empty.value, false);
  assert.deepEqual(empty.issues, unconfigured);
  await assert.rejects(service.updateAgent(agentId, empty.revision, { ...empty.value, workspaceId: 'w1' }), /Unknown config field: workspaceId/);
  const created = await store.agents.createAgent();
  await store.config.deleteConfig('agent', created.agentId, 0);
  await assert.rejects(service.createAgentConfig(created.agentId, { ...empty.value, workspaceId: 'w1' }), /Unknown config field: workspaceId/);

  const old = await store.agents.createAgent();
  const stored = await store.config.getConfig<Record<string, unknown>>('agent', old.agentId);
  await store.config.updateConfig('agent', old.agentId, stored.revision, { ...empty.value, name: 'Earlier', workspaceId: 'gone' });
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
    const add = (name: string, lead = false) => store.team.createMember({ id: randomUUID(), workspaceId, lead, nameKey: name.toLowerCase(), value: record(name, lead) });
    // Creating the workspace created its lead, in the same transaction.
    const [lead] = await store.team.listMembers(workspaceId);
    assert.deepEqual([lead?.value.name, lead?.value.lead], ['Lead', true]);
    const backend = await add('Backend');
    await assert.rejects(add('Second lead', true), code('lead_exists'));
    await assert.rejects(add('backend'), code('member_exists'));
    await assert.rejects(add('lead'), code('member_exists'));
    assert.deepEqual((await store.team.listMembers(workspaceId)).map(member => member.value.name), ['Lead', 'Backend']);
    assert.equal((await store.team.getMember(backend.id))?.revision, 0);
    assert.equal(await store.team.getMember('missing'), null);

    // A member's conversation is an agent for the runtime, but not an agent in the list and not one with a config.
    assert.equal((await store.agents.getState(backend.id)).historyPosition, 0);
    assert.equal((await store.config.listAgents()).includes(backend.id), false);
    await assert.rejects(store.config.createConfig('agent', backend.id, {}), code('not_found'));
    await assert.rejects(new ConfigService(store.config, builtinModels()).getAgent(backend.id), code('not_found'));

    await assert.rejects(store.team.updateMember(backend.id, 5, 'backend', backend.value), code('config_conflict'));
    await assert.rejects(store.team.updateMember(backend.id, 0, 'lead', backend.value), code('member_exists'), 'a name an active member has is refused');
    await assert.rejects(store.team.updateMember('missing', 0, 'x', backend.value), code('not_found'));
    const retired = await store.team.updateMember(backend.id, 0, null, { ...backend.value, retiredAt: 2 });
    assert.equal(retired.revision, 1);
    assert.equal((await add('Backend')).revision, 0, 'a retired member frees its name');
    assert.equal((await store.team.getMember(lead!.id))?.value.lead, true);
    assert.equal((await store.config.configBundle(null)).agent, null);
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
  const service = new ConfigService(store.config, models, [], testEncryptionKey);
  const connectionId = `custom-${randomUUID()}`;
  const connection = await service.createConnection(connectionId, { label: 'Local custom', provider: 'local-custom', baseUrl, api: 'openai-completions', apiKey: 'custom-secret' });
  let runtime: AgentRuntime | undefined;
  try {
    const choices = await service.modelChoices(connectionId, true);
    assert.deepEqual(choices.map(item => item.label), ['Discovered model']);
    assert.equal(seen.authorization, 'Bearer custom-secret');
    assert.equal(JSON.stringify(connection).includes('custom-secret'), false);
    assert.equal(JSON.stringify(await store.config.getConfig('connection', connectionId)).includes('custom-secret'), false);
    assert.equal(choices[0]?.verified, false);
    assert.equal((await service.modelChoices(connectionId))[0]?.modelId, 'server-owned-model');
    failDiscovery = true;
    await assert.rejects(service.modelChoices(connectionId, true), /Could not discover/);
    assert.equal((await service.modelChoices(connectionId))[0]?.modelId, 'server-owned-model');
    failDiscovery = false;
    const { agentId } = await store.agents.createAgent();
    const initial = await service.getAgent(agentId);
    await service.updateAgent(agentId, initial.revision, { ...initial.value, connectionId, modelId: choices[0]!.modelId });
    runtime = new AgentRuntime(store.agents, service, configuredPolicy(), piModelStream(models));
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
  const service = new ConfigService(store.config, models, [], testEncryptionKey);
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
    const { agentId } = await store.agents.createAgent();
    const initial = await service.getAgent(agentId);
    await service.updateAgent(agentId, initial.revision, { ...initial.value, connectionId, modelId: 'custom-claude-b' });
    runtime = new AgentRuntime(store.agents, service, configuredPolicy(), piModelStream(models));
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
  const service = new ConfigService(store.config, models, [], testEncryptionKey);
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
    const { agentId } = await store.agents.createAgent();
    const initial = await service.getAgent(agentId);
    await service.updateAgent(agentId, initial.revision, { ...initial.value, connectionId, modelId: 'deepseek-v4-pro', modelOptions: [{ connectionId, modelId: 'deepseek-v4-pro', reasoning: 'high' }] });
    runtime = new AgentRuntime(store.agents, service, configuredPolicy(), piModelStream(models));
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
  const service = new ConfigService(store.config, models, [], testEncryptionKey);
  const runtime = new AgentRuntime(store.agents, service, configuredPolicy(), async function* () { yield { type: 'done', reason: 'stop', message: message() }; });
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
  const { agentId } = await store.agents.createAgent();
  await store.agents.replaceContext(agentId, 0, [{ messageId: 'opaque', message: user, metadata: { hidden: true, nested: [1, 'x'] } }]);
  const reopened = new CoreData(new MySqlStorage(databaseUrl!));
  try {
    assert.deepEqual(await reopened.agents.getContext(agentId), await store.agents.getContext(agentId));
    await reopened.pool.execute('UPDATE agent_context_entries SET entry = ? WHERE agent_id = ?', ['{"version":999,"data":[]}', agentId]);
    await assert.rejects(reopened.agents.getContext(agentId), /schema version/);
  } finally { await reopened.close(); }
});

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

test('members edit the shared project, checkpoint runs and separate project commits from user design acceptance', { timeout: 60_000 }, async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'harness-prototype-')));
  const workspaceService = new WorkspaceService(store.workspaces, { issuesFor: settings => service.issuesFor(settings) });
  const service = new ConfigService(store.config, builtinModels());
  const team = new TeamSystem(store.team, workspaceService, service);
  const requests = new Queue<{ request: ModelRequest; events: Queue<AssistantMessageEvent> }>();
  const runtime = new AgentRuntime(store.agents, team.runConfig, team.policy(configuredPolicy()), request => {
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
    await seedDesign(workspaceService,workspaceId,'metadata.json',design);
    const first = (await team.team(workspaceId)).members[0]!;
    const lead = await team.update(workspaceId, first.memberId, first.revision, {
      name: first.name, role: first.role, responsibility: first.responsibility, harness: { designScope: first.harness.designScope, allowedCommands: [] },
      settings: { ...first.settings, connectionId, modelId: 'gpt-4.1-mini' },
    });
    await team.create(workspaceId, { name: 'Backend', role: 'developer', responsibility: 'Implement result', settings: { prompt: 'Keep the result concise.' }, harness: { designScope: { working: ['metadata.json'], dependencies: [] }, allowedCommands: [{ kind: 'executable', executable: 'bash' }] } });
    await runtime.open();
    const accepted = await team.runner.postUser(workspaceId, 'Propose a design refinement and ask Backend to implement the accepted design.');
    const run = accepted.runs[0]!;
    const firstStep = await requests.next();
    assert.ok(!firstStep.request.tools.some(tool => tool.definition.name === 'save_design'));
    assert.match(firstStep.request.context.systemPrompt!, /user approval/);
    answer(firstStep.events,fauxAssistantMessage([
      {type:'toolCall',id:randomUUID(),name:'write',arguments:{path:'.rsi/context/design/metadata.json',content:JSON.stringify({implementation:design.implementation})}},
      {type:'toolCall',id:randomUUID(),name:'write',arguments:{path:'.rsi/context/design/design.md',content:'Pending design refinement'}},
    ],{stopReason:'toolUse'}));
    const secondStep = await requests.next();
    await initGit({team,workspaceId,lead});
    answer(secondStep.events, call('bash', { command: 'git add -f .rsi/context/design && git commit -m "Requires user approval"' }));
    const approval=await waitApproval({team,workspaceId,lead});team.harness.approvals.decide(workspaceId,approval.id,'deny','Revise first');
    const thirdStep = await requests.next();
    assert.match(JSON.stringify(thirdStep.request.context.messages), /User denied/);
    const manifest = { name: 'Pending new member', role: 'developer', responsibility: 'Future member', settings: {}, promptFiles: ['prompts/member.md'], designScope: { working: ['metadata.json'], dependencies: [] } };
    answer(thirdStep.events, call('write', { path: '.rsi/members/pending/prompts/member.md', content: 'Pending prompt.' }));
    const manifestStep = await requests.next();
    answer(manifestStep.events, call('write', { path: '.rsi/members/pending/member.json', content: JSON.stringify(manifest) }));
    const fourthStep = await requests.next();
    assert.equal((await team.team(workspaceId)).members.length, 2, 'file changes do not activate members');
    assert.ok(!fourthStep.request.tools.some(t => t.definition.name === 'submit_member_config'));
    answer(fourthStep.events, message('<mentions>["Backend"]</mentions>\n\nImplement the accepted design.'));
    const workerStep = await requests.next();
    assert.match(workerStep.request.context.systemPrompt!, /You are Backend/);
    assert.match(workerStep.request.context.systemPrompt!, /Keep the result concise/);
    const activeWorker = (await team.service.byName(workspaceId, 'Backend'))!;
    await assert.rejects(store.team.updateMember(activeWorker.id, activeWorker.revision, 'backend', activeWorker.value, true), code('member_busy'));
    const storedBundle = (await store.team.getMember(activeWorker.id))!.value.configuration!;
    assert.equal(storedBundle.files['prompts/member.md'], 'Keep the result concise.');
    assert.deepEqual(JSON.parse(storedBundle.files['member.json']!).designScope, { working: ['metadata.json'], dependencies: [] });
    const leadFiles = await team.harness.files(lead.memberId);
    await writeFile(join(leadFiles.root, '.rsi/members/pending/prompts/member.md'), 'UNSUBMITTED prompt');
    assert.equal((await team.configuration.accepted(workspaceId, activeWorker.id)).digest, storedBundle.digest);
    assert.ok(!workerStep.request.tools.some(tool => ['read_design', 'save_design', 'assign_member', 'create_member'].includes(tool.definition.name)));
    assert.match(workerStep.request.context.systemPrompt!, /Create src\/result.txt with Done/);
    assert.doesNotMatch(workerStep.request.context.systemPrompt!, /Pending design refinement/);
    answer(workerStep.events, call('write', { path: 'src/result.txt', content: 'Done' }));
    const workerCommit = await requests.next();
    answer(workerCommit.events, call('bash', { command: 'git reset && git add src && git commit -m "Implement the requested result file"' }));
    const workerCommand = await requests.next();
    const commitResult = workerCommand.request.context.messages.findLast(item=>item.role==='toolResult' && item.toolName==='bash');
    assert.match(JSON.stringify(commitResult), /Implement the requested result file/, JSON.stringify(commitResult));
    answer(workerCommand.events, call('bash', { command: 'cat src/result.txt' }));
    const workerFinish = await requests.next();
    const commandResult = workerFinish.request.context.messages.findLast(item => item.role === 'toolResult' && item.toolName === 'bash');
    assert.ok(commandResult?.role === 'toolResult' && commandResult.content[0]?.type === 'text');
    // Combined output can include shell diagnostics before the command's stdout.
    if (commandResult?.role === 'toolResult' && commandResult.content[0]?.type === 'text') assert.match(commandResult.content[0].text, /(?:^|\n)Done\n\n<metadata>[\s\S]*exit_code: 0/);
    answer(workerFinish.events, message('<mentions>["Lead"]</mentions>\n\nImplemented src/result.txt and committed implementation.'));
    const leadFinish = await requests.next();
    const secondLeadRun = (await runtime.getState(lead.memberId)).run!;
    answer(leadFinish.events, message('Implementation is committed; design refinement awaits user approval.'));
    assert.equal((await runtime.finished(lead.memberId, secondLeadRun.runId)).status, 'completed');
    const backend = (await team.team(workspaceId)).members.find(m => m.name === 'Backend')!;
    const env = await team.harness.environment(backend.memberId);
    assert.equal(await readFile(join(env.root, 'src/result.txt'), 'utf8'), 'Done');
    assert.equal(await readFile(join(folder, 'project/src/result.txt'),'utf8'),'Done');
    assert.match(await gitText(env.root,['log','--oneline']),/Implement/);
    const pending=await team.changes(workspaceId);assert.match(pending.design.changes.map(c=>c.patch).join('\n'),/Pending design refinement/);
    await gitText(env.root,['reset']);await acceptFiles({team,workspaceId,lead},'.rsi/context/design','User accepted refinement');
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
  const reopened = new CoreData(new MySqlStorage(databaseUrl!));
  try {
    const directory = join(folder, 'project');
    const { workspaceId } = await workspaces.create({ name: 'Integration', directory, models: testModels(), adopt: false });
    const record = (await store.workspaces.getWorkspace(workspaceId))!;
    assert.equal(record.directory, directory);
    assert.ok((await store.workspaces.listWorkspaces()).some(item => item.workspaceId === workspaceId));
    const created = (await store.team.listMembers(workspaceId)).filter(member => member.value.lead);
    assert.equal(created.length, 1, 'a workspace is created with its lead');
    const duplicateId = randomUUID();
    const rival = newLead(duplicateId);
    await assert.rejects(store.workspaces.createWorkspace({ ...record, workspaceId: duplicateId }, sha256(directory.toLowerCase()), rival), code('workspace_exists'));
    assert.equal(await store.team.getMember(rival.id), null, 'a refused workspace leaves no lead');
    await assert.rejects(store.agents.getState(rival.id), code('not_found'));
    await assert.rejects(store.workspaces.createWorkspace(record, sha256(randomUUID()), newLead(workspaceId)), code('workspace_exists'));
    assert.equal((await store.team.listMembers(workspaceId)).length, 1, 'a refused workspace adds no second lead');
    await assert.rejects(workspaces.create({ name: 'Inner', directory: join(directory, 'inner'), models: testModels(), adopt: false }), code('workspace_exists'));

    const context = await workspaces.context(workspaceId);
    const saved = await context.save('user/a.md', 'alpha', null, 'first');
    await context.move('user/a.md', 'user/b.md', saved.revision, 'rename');
    const loaded = await reopened.workspaces.loadContext(workspaceId);
    assert.equal(loaded.seq, 3);
    assert.deepEqual(loaded.files.filter(file=>!['design/metadata.json','design/design.md','implement/impl/README.md'].includes(file.path)).map(file => [file.path, file.size, file.author, file.reason]), [['user/b.md', 5, { type: 'user' }, 'rename']]);
    const file = loaded.files.find(file=>file.path==='user/b.md')!;
    assert.deepEqual((await reopened.workspaces.history(workspaceId, file.fileId, null, 10)).map(version => [version.seq, version.action, version.path, version.fromPath]), [[3, 'move', 'user/b.md', 'user/a.md'], [2, 'create', 'user/a.md', null]]);
    assert.deepEqual((await reopened.workspaces.history(workspaceId, file.fileId, 3, 10)).map(version => version.revision), [saved.revision]);
    assert.equal(await reopened.workspaces.blob(workspaceId, file.hash), 'alpha');
    assert.equal((await reopened.workspaces.version(workspaceId, saved.revision))?.path, 'user/a.md');
    assert.equal(await reopened.workspaces.lastFileId(workspaceId, 'user/a.md'), file.fileId);
    assert.deepEqual((await reopened.workspaces.records(workspaceId, 1, 10)).map(item => [item.seq, item.author, item.reason, item.files]), [
      [2, { type: 'user' }, 'first', [{ action: 'create', path: 'user/a.md', fromPath: null, revision: saved.revision }]],
      [3, { type: 'user' }, 'rename', [{ action: 'move', path: 'user/b.md', fromPath: 'user/a.md', revision: file.revision }]],
    ]);

    // A second process reloads the index and finds nothing to record.
    const service = new WorkspaceService(reopened.workspaces, testModelValidator);
    try {
      assert.equal((await service.get(workspaceId)).context.seq, 3);
      assert.equal((await (await service.context(workspaceId)).read({ path: 'user/b.md' })).content, 'alpha');
    } finally { await service.close(); }

    // Another process stores change 4; this process's next change, also built on 3, is refused and undone on disk.
    const time = Date.now();
    const fileId = randomUUID();
    const revision = randomUUID();
    const hash = sha256('other');
    const external = { type: 'external' } as const;
    const other: ContextCommit = {
      seq: 4,
      blobs: [{ hash, content: 'other', size: 5 }],
      versions: [{ fileId, seq: 4, revision, action: 'create', path: 'user/c.md', fromPath: null, hash, size: 5, time, author: external, reason: null }],
      removeKeys: ['user/c.md'],
      files: [{ path: 'user/c.md', fileId, revision, hash, size: 5, mtimeMs: time, updatedAt: time, author: external, reason: null }],
      record: { seq: 4, time, author: external, reason: null, files: [{ action: 'create', path: 'user/c.md', fromPath: null, revision }] },
    };
    await reopened.workspaces.commitContext(workspaceId, 3, other);
    await assert.rejects(context.save('user/d.md', 'mine', null, null), code('backend_error'));
    await assert.rejects(stat(join(directory, '.rsi/context', 'user', 'd.md')), code('ENOENT'));
    await assert.rejects(reopened.workspaces.commitContext(workspaceId, 3, { ...other, versions: [], files: [], removeKeys: [] }), code('backend_error'));
    assert.deepEqual((await reopened.workspaces.records(workspaceId, 0, 10)).map(item => item.seq), [1, 2, 3, 4]);
    assert.deepEqual((await reopened.workspaces.loadContext(workspaceId)).files.map(item => item.path).sort(), ['design/design.md','design/metadata.json','implement/impl/README.md','user/b.md','user/c.md']);
  } finally {
    await reopened.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('workspace model SQL persistence initializes leads atomically and default edits preserve assigned members', async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'workspace-models-')));
  const service = new ConfigService(store.config, builtinModels());
  const workspaceService = new WorkspaceService(store.workspaces, service);
  const team = new TeamSystem(store.team, workspaceService, service);
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
    const reopened = new CoreData(new MySqlStorage(databaseUrl!));
    try { assert.deepEqual(await reopened.workspaces.getWorkspaceModels(created.workspaceId), { revision: initial.revision + 1, value: { ...pool, defaultModel: second } }); }
    finally { await reopened.close(); }
    const legacyId = randomUUID();
    await store.workspaces.createWorkspace({ workspaceId: legacyId, name: 'Legacy', directory: join(folder, 'legacy'), createdAt: Date.now() }, sha256(legacyId), newLead(legacyId));
    const saved = await workspaceService.updateModels(legacyId, 0, pool);
    const legacyLead = (await team.service.active(legacyId))[0]!;
    assert.equal(legacyLead.value.settings.modelId, first.modelId);
    assert.equal(JSON.parse(legacyLead.value.configuration!.files['member.json']!).settings.modelId, first.modelId);
    await workspaceService.updateModels(legacyId, saved.revision, { ...pool, defaultModel: second });
    assert.deepEqual(await team.service.find(legacyLead.id), legacyLead);
    const failedId = randomUUID();
    const collision = { ...newLead(failedId), id: lead.id };
    await assert.rejects(store.workspaces.createWorkspace({ workspaceId: failedId, name: 'Fail', directory: join(folder, 'fail'), createdAt: Date.now() }, sha256(failedId), collision, pool));
    assert.equal(await store.workspaces.getWorkspace(failedId), null);
    assert.equal(await store.workspaces.getWorkspaceModels(failedId), null);
    await assert.rejects(workspaceService.create({ name: 'Bad provider', directory: join(folder, 'bad'), adopt: false, models: testModels('missing', 'missing') }), code('invalid_config'));
    await assert.rejects(stat(join(folder, 'bad')), code('ENOENT'));
  } finally { await team.runner.close(); await workspaceService.close(); await rm(folder, { recursive: true, force: true }); }
});

async function groupFixture(basePolicy: RuntimePolicy = configuredPolicy(), options: {compaction?:CompactionSettings} = {}) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'group-chat-')));
  const workspaceService = new WorkspaceService(store.workspaces, { issuesFor: settings => service.issuesFor(settings) });
  const service = new ConfigService(store.config, builtinModels());
  const team = new TeamSystem(store.team, workspaceService, service);
  const requests = new Queue<{ request: ModelRequest; events: Queue<AssistantMessageEvent> }>();
  const runtime = new AgentRuntime(store.agents, team.runConfig, team.policy(basePolicy), request => {
    const events = new Queue<AssistantMessageEvent>(); requests.push({ request, events }); return events;
  }, options);
  team.attach(runtime);
  const connectionId = `group-${randomUUID()}`;
  await service.createConnection(connectionId, { label: 'Group test', provider: 'openai', baseUrl: 'https://api.openai.com/v1', api: 'openai-responses' });
  const { workspaceId } = await workspaceService.create({ name: 'Group', directory: join(folder, 'project'), models: testModels(connectionId, 'gpt-4.1-mini'), adopt: false });
  const first = (await team.team(workspaceId)).members[0]!;
  const lead = await team.update(workspaceId, first.memberId, first.revision, { name: first.name, role: first.role, responsibility: first.responsibility, harness: { designScope: first.harness.designScope, allowedCommands: first.harness.allowedCommands }, settings: { ...first.settings, connectionId, modelId: 'gpt-4.1-mini' } });
  await seedDesign(workspaceService, workspaceId, 'metadata.json', { content: 'Shared test design', implementation: ['.'] });
  const harness = { designScope: { working: ['metadata.json'], dependencies: [] }, allowedCommands: [] };
  const backend = await team.create(workspaceId, { name: 'Backend', role: 'developer', harness });
  const frontend = await team.create(workspaceId, { name: 'Frontend', role: 'developer', harness });
  await runtime.open();
  return { workspaceId, lead, backend, frontend, team, runtime, requests, async close() { await runtime.close(); team.runner.close(); await workspaceService.close(); await rm(folder, { recursive: true, force: true }); } };
}

test('scoped package references produce one accepted report without private publication retries', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, 'Review @joplin/lib and @types/node');
    assert.equal(accepted.runs.length, 1);
    assert.equal(accepted.runs[0]!.agentId, f.lead.memberId);
    const report = 'Use `@joplin/lib`, @types/node and @Backend/package. Complete report.';
    answer((await f.requests.next()).events, message(report));
    const finished = await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId);
    assert.equal(finished.status, 'completed');
    assert.equal(finished.step, 1);
    const history = await store.agents.followSnapshot(f.lead.memberId, finished.runId, 0);
    assert.equal(history.history.filter(record => record.message.role === 'assistant').length, 1);
    assert.ok(!history.history.some(record => record.metadata.source === 'publication-feedback'));
    const chat = await store.team.chatSnapshot(f.workspaceId);
    assert.equal(chat.messages.length, 2);
    assert.equal(chat.messages[1]!.text, report);
    assert.deepEqual(chat.messages[1]!.recipients, []);
    const entry = (await store.team.chatTimeline(f.workspaceId)).changes.at(-1)!.entry;
    assert.ok(entry.kind === 'member' && entry.finalRef);
    if (entry.kind !== 'member') return;
    assert.equal(entry.text, report);
    assert.deepEqual(entry.finalRef!.contentIndices, [0]);
    assert.equal((await f.runtime.getState(f.backend.memberId)).run, null);
  } finally { await f.close(); }
});

test('agent headers route atomically and persist only the referenced body while raw private replies survive reload', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    await f.team.runner.configure(f.workspaceId, 3);
    const accepted = await f.team.runner.postUser(f.workspaceId, 'Delegate with a structured header');
    const first = await f.requests.next();
    assert.match(first.request.context.systemPrompt!, /When nobody should run, omit the entire block/);
    answer(first.events, message('<mentions>["Backend",]</mentions>\n\nUnpublished candidate.'));
    const retry = await f.requests.next();
    assert.ok(retry.request.context.messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('invalid_mentions')));
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).position, 1);
    assert.equal((await f.runtime.getState(f.backend.memberId)).run, null);
    answer(retry.events, message('<mentions>["Missing"]</mentions>\n\nAnother private candidate.'));
    const corrected = await f.requests.next();
    assert.ok(corrected.request.context.messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('No active member named "Missing"')));
    const body = '# Work\n\n@Lead @Nobody @joplin/lib @{unfinished\n<mentions>ordinary body example</mentions>';
    const raw = '<mentions>\n["Backend", "backend"]\n</mentions>\n\n' + body;
    answer(corrected.events, message(raw));
    const left = await f.requests.next();
    assert.equal((await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId)).status, 'completed');
    const shared = (await store.team.chatSnapshot(f.workspaceId)).messages.at(-1)!;
    assert.equal(shared.text, body);
    assert.deepEqual(shared.recipients, [f.backend.memberId]);
    const entry = (await store.team.chatTimeline(f.workspaceId)).changes.filter(change => change.entry.entryId === accepted.runs[0]!.runId).at(-1)!.entry;
    assert.ok(entry.kind === 'member');
    if (entry.kind !== 'member') return;
    assert.equal(entry.text, body);
    assert.equal(entry.finalRef!.bodyOffset, raw.length - body.length);
    assert.deepEqual(entry.finalRef!.contentIndices, [0]);
    const history = await store.agents.runMessages(f.lead.memberId, accepted.runs[0]!.runId);
    assert.ok(history.some(record => record.message.role === 'assistant' && record.message.content.some(part => part.type === 'text' && part.text === raw)));
    assert.equal(history.filter(record => record.metadata.source === 'publication-feedback').length, 2);
    for (const step of [left]) assert.ok(step.request.context.messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.endsWith(body) && !m.content.includes('["Backend"')));
    const context = await store.agents.getContext(f.lead.memberId);
    await store.agents.replaceContext(f.lead.memberId, context.revision, [{ messageId: 'header-summary', message: { role: 'user', content: 'Compacted context.', timestamp: 1 }, metadata: {} }]);
    assert.deepEqual(await store.agents.runMessages(f.lead.memberId, accepted.runs[0]!.runId), history);
    const reopened = new CoreData(new MySqlStorage(databaseUrl!));
    try { assert.equal((await reopened.team.chatSnapshot(f.workspaceId)).messages.at(-1)!.text, body); }
    finally { await reopened.close(); }
    answer(left.events, message('<mentions>\n</mentions>\n\nFinished @Lead @Nobody'));
    for (const member of [f.backend]) {
      const run = (await f.runtime.getState(member.memberId)).run!;
      assert.equal((await f.runtime.finished(member.memberId, run.runId)).status, 'completed');
    }
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).position, 3);
    assert.equal((await f.runtime.getState(f.lead.memberId)).run!.runId, accepted.runs[0]!.runId, 'body mentions trigger no successor');
  } finally { await f.close(); }
});

test('native commentary continues; stored ordinary final text streams and pins exact final blocks', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, 'Inspect model');
    const first = await f.requests.next();
    const signature = (phase: string) => JSON.stringify({ v: 1, id: `native-${phase}`, phase });
    answer(first.events, fauxAssistantMessage([{ type: 'text', text: 'Let me check the available models.', textSignature: signature('commentary') }]));
    const second = await f.requests.next();
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).position, 1);
    assert.ok(!second.request.tools.some(tool => tool.definition.name === 'final_response'));
    assert.ok(!second.request.context.messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('private working output')));
    const final = fauxAssistantMessage([
      { type: 'text', text: 'I checked the configuration.', textSignature: signature('commentary') },
      { type: 'thinking', thinking: 'Hidden model reasoning' },
      { type: 'text', text: '<mentions>\n[]\n</mentions>', textSignature: signature('final_answer') },
      { type: 'text', text: 'Model answer', textSignature: signature('final_answer') },
    ]);
    second.events.push({ type: 'start', partial: { ...final, content: [], stopReason: 'pending' } });
    const partial = { ...final, content: [{ type: 'text' as const, text: 'Model' }], stopReason: 'pending' as const };
    second.events.push({ type: 'text_start', contentIndex: 0, partial: { ...partial, content: [{ type: 'text', text: '' }] } });
    second.events.push({ type: 'text_delta', contentIndex: 0, delta: 'Model', partial });
    const stream = f.runtime.follow(f.lead.memberId, { runId: accepted.runs[0]!.runId })[Symbol.asyncIterator]();
    let chunk = await until(stream, 'chunk');
    while (chunk.type !== 'chunk' || chunk.event.type !== 'text_delta') chunk = await until(stream, 'chunk');
    assert.equal(chunk.event.delta, 'Model');
    assert.equal('partial' in chunk.event, false);
    assert.equal('output' in chunk, false, 'raw stored blocks need no separate response annotation');
    assert.ok(f.runtime.progress.read(f.lead.memberId, accepted.runs[0]!.runId, chunk.messageId)?.chunks.some(c => c.event.type === 'text_delta'));
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).position, 1, 'streaming text is not yet shared');
    second.events.push({ type: 'done', reason: 'stop', message: final });
    assert.equal((await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId)).status, 'completed');
    const entry = (await store.team.chatTimeline(f.workspaceId)).changes.at(-1)!.entry;
    if (entry.kind !== 'member') throw new Error('Missing member entry');
    assert.equal(entry.text, 'Model answer');
    assert.deepEqual(entry.finalRef?.contentIndices, [2, 3]);
    assert.equal(entry.finalRef?.bodyOffset, '<mentions>\n[]\n</mentions>\n'.length);
    assert.equal(entry.finalRef!.position, entry.working.through);
    assert.equal(entry.finalRef?.toolCallId, undefined);
    assert.deepEqual((await store.team.chatSnapshot(f.workspaceId)).messages.map(m => m.text), ['Inspect model', 'Model answer']);
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
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).position, 1);
    assert.ok(second.request.context.messages.some(m => m.role === 'toolResult' && m.toolCallId === 'models'));
    answer(second.events, message('Available models checked.'));
    assert.equal((await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId)).status, 'completed');
    assert.deepEqual((await store.team.chatSnapshot(f.workspaceId)).messages.map(m => m.text), ['Check models', 'Available models checked.']);
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
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).position, 1);
    const entry = (await store.team.chatTimeline(f.workspaceId)).changes.at(-1)!.entry;
    if (entry.kind !== 'member') throw new Error('Missing member entry');
    assert.equal(entry.finalRef, null);
  } finally { await f.close(); }
});

test('group chat SQL/runtime: sequential execution, private feedback and continuous context with stable history', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const start = await f.team.runner.postUser(f.workspaceId, '@Backend @Frontend build');
    const backendStep = await f.requests.next();
    assert.match(backendStep.request.context.systemPrompt!, /You are Backend,/);
    const backendRun = start.runs.find(run => run.agentId === f.backend.memberId)!;
    const frontendRun = start.runs.find(run => run.agentId === f.frontend.memberId)!;
    assert.equal((await f.runtime.getState(f.backend.memberId)).run?.status, 'running');
    assert.equal((await f.runtime.getState(f.frontend.memberId)).run?.status, 'running');
    assert.equal((await store.agents.getContext(f.lead.memberId)).entries.length, 1, 'idle Lead synchronized without a run');
    const user = await f.team.runner.postUser(f.workspaceId, '@Lead discuss');
    assert.equal((await store.agents.getContext(f.backend.memberId)).entries.length, 1, 'only admitted shared input is incorporated during work');
    answer(backendStep.events, message('<mentions>["Lead"]</mentions>\n\nPRIVATE CANDIDATE: please review'));
    const revision = await f.requests.next();
    assert.match(revision.request.context.systemPrompt!, /You are Backend,/);
    assert.ok(revision.request.context.messages.some(item => item.role === 'user' && typeof item.content === 'string' && item.content.includes('Group publication refused (member_busy)')));
    assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 2);
    assert.equal((await store.agents.getContext(f.frontend.memberId)).entries.length, 0, 'waiting runs have not constructed context');
    answer(revision.events, message('Backend finished without mentions.'));
    await f.runtime.finished(f.backend.memberId, backendRun.runId);
    const entries = (await store.agents.getContext(f.backend.memberId)).entries;
    assert.match(JSON.stringify(entries), /PRIVATE CANDIDATE/);
    assert.match(JSON.stringify(entries), /@Lead discuss/);
    assert.equal(JSON.stringify(entries).split('Backend finished without mentions.').length - 1, 1, 'sender sees its accepted final once');
    assert.deepEqual((await store.agents.runMessages(f.backend.memberId, backendRun.runId)).map(record => record.metadata.source ?? record.message.role), ['assistant', 'publication-feedback', 'assistant']);
    const frontendStep = await f.requests.next();
    assert.match(frontendStep.request.context.systemPrompt!, /You are Frontend,/);
    assert.match(JSON.stringify(frontendStep.request.context.messages), /Backend finished without mentions/);
    assert.match(JSON.stringify(frontendStep.request.context.messages), /@Lead discuss/, 'queued member chooses current shared input itself');
    answer(frontendStep.events, message('Frontend finished.'));
    await f.runtime.finished(f.frontend.memberId, frontendRun.runId);
    const leadStep = await f.requests.next();
    assert.match(leadStep.request.context.systemPrompt!, /You are Lead,/);
    answer(leadStep.events, message('Lead finished.'));
    await f.runtime.finished(f.lead.memberId, user.runs[0]!.runId);
    const transcript = await f.team.runner.snapshot(f.workspaceId);
    assert.equal(transcript.position, 5);
    assert.ok(!transcript.messages.some(item => item.text.includes('PRIVATE CANDIDATE')));
    const frontendContext = (await store.agents.getContext(f.frontend.memberId)).entries;
    assert.ok(!frontendContext.some(entry => entry.metadata.source === 'publication-feedback'));
    assert.equal(frontendContext.filter(entry => entry.metadata.groupContextId === f.workspaceId).length, 5, 'idle members catch up without another activation');
    const originalHistory = await store.agents.runMessages(f.backend.memberId, backendRun.runId);
    assert.deepEqual(await store.agents.runMessages(f.backend.memberId, backendRun.runId), originalHistory);
    assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 5);
    const next = await f.team.runner.postUser(f.workspaceId, '@Backend continue');
    const nextStep = await f.requests.next();
    assert.ok(JSON.stringify(nextStep.request.context.messages).includes('PRIVATE CANDIDATE'), 'private work survives successful completion');
    assert.ok(JSON.stringify(nextStep.request.context.messages).includes('@Backend continue'));
    assert.ok(JSON.stringify(nextStep.request.context.messages).includes('Backend finished without mentions.'));
    answer(nextStep.events, message('Continued.'));
    await f.runtime.finished(f.backend.memberId, next.runs[0]!.runId);
    const newcomer = await f.team.create(f.workspaceId, { name: 'New Member', role: 'developer' });
    assert.equal((await store.agents.getContext(newcomer.memberId)).entries.length, 0);
    const reopened = new CoreData(new MySqlStorage(databaseUrl!));
    try { assert.deepEqual(await reopened.team.chatSnapshot(f.workspaceId), await store.team.chatSnapshot(f.workspaceId)); }
    finally { await reopened.close(); }
    // History query needs neither a running member nor a model call.
    assert.equal((await f.team.runner.snapshot(f.workspaceId, 5, 1)).messages[0]?.position, 6);
  } finally { await f.close(); }
});

test('group runs preserve failed/cancelled edits and publish without Git checkpoints', { timeout: 30_000 }, async () => {
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
      const directory=(await f.team.harness.environment(f.backend.memberId)).root;
      assert.equal(await readFile(join(directory,'partial.txt'),'utf8'),outcome);
    }
    const accepted=await f.team.runner.postUser(f.workspaceId,'@Backend report');
    answer((await f.requests.next()).events,message('Published without a Git checkpoint'));
    assert.equal((await f.runtime.finished(f.backend.memberId,accepted.runs[0]!.runId)).status,'completed');
  } finally { await f.close(); }
});

test('group SQL publication is atomic; restart preserves shared history without fanout or replay', { timeout: 30_000 }, async () => {
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
    const abandoned = await store.team.publishChat({ workspaceId: f.workspaceId, author: { type: 'user' }, text: '@Backend abandoned', recipients: [f.backend.memberId] });
    await store.team.publishChat({ workspaceId: f.workspaceId, author: { type: 'user' }, text: 'Shared while Backend is working', recipients: [] });
    assert.equal((await store.agents.getContext(f.backend.memberId)).entries.length, 1, 'recorded context survives cancellation');
    let recoveredFinalization = false;
    const recoveryPolicy = f.team.policy(configuredPolicy());
    const recovery = new AgentRuntime(store.agents, f.team.runConfig, { ...recoveryPolicy, afterRun: async run => {
      assert.equal(run.status, 'interrupted');
      assert.equal((await store.agents.getState(run.agentId)).run?.status, 'running');
      await recoveryPolicy.afterRun?.(run);
      recoveredFinalization = true;
    } }, () => { throw new Error('Restart must not replay a model call'); });
    await recovery.open();
    try {
      assert.equal((await recovery.getState(f.backend.memberId)).run?.status, 'interrupted');
      assert.equal(recoveredFinalization, true);
      assert.equal((await store.agents.getContext(f.backend.memberId)).entries.length, 1, 'startup does not reconstruct context');
      await recovery.syncGroupContext(f.backend.memberId);
      assert.equal((await store.agents.getContext(f.backend.memberId)).entries.length, 3, 'Agent-owned idle synchronization catches up without model execution');
      assert.equal((await store.agents.runMessages(f.backend.memberId, abandoned.runs[0]!.runId)).length, 0);
      assert.equal((await store.team.chatSnapshot(f.workspaceId)).position, 3);
    } finally { await recovery.close(); }
    const retained = await store.agents.getContext(f.backend.memberId);
    await f.team.service.retire(f.workspaceId, f.backend.memberId, f.backend.revision);
    await store.team.publishChat({ workspaceId: f.workspaceId, author: { type: 'user' }, text: 'After Backend retired', recipients: [] });
    assert.deepEqual(await store.agents.getContext(f.backend.memberId), retained, 'retirement excludes later messages even on explicit delivery');
    assert.equal((await store.agents.getContext(f.frontend.memberId)).entries.length, 1, 'direct SQL publication does not run member synchronization');
  } finally { await f.close(); }
});


test('shutdown waits for in-flight solo input acceptance, registers its run, then cancels it durably', { timeout: 15_000 }, async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const preparing = new Promise<void>(resolve => { entered = resolve; });
  const runtime = new AgentRuntime(store.agents, { resolveForRun: async () => { entered(); await gate; return staticConfig.resolveForRun(); } }, fixedPolicy(model), async function* () {
    await new Promise<void>(() => undefined);
    yield { type: 'done', reason: 'stop', message: message('unreachable') };
  });
  await runtime.open();
  try {
    const { agentId } = await store.agents.createAgent();
    const acceptance = runtime.start(agentId, 'accepted before shutdown');
    await preparing;
    const shutdown = runtime.close();
    release();
    const run = await acceptance;
    await shutdown;
    assert.equal((await store.agents.getState(agentId)).run?.status, 'cancelled');
    assert.equal((await store.agents.runMessages(agentId, run.runId)).length, 1);
  } finally { release(); await runtime.close(); }
});

test('group timeline reserves deterministic positions, pins final references and ranges, and replays older entry updates', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, '@Backend @Frontend build');
    const backendStep = await f.requests.next();
    assert.deepEqual(accepted.entries.map(entry => entry.kind === 'member' ? entry.name : 'User'), ['User', 'Backend', 'Frontend']);
    const cursor = (await store.team.chatTimeline(f.workspaceId)).cursor;
    const later = await f.team.runner.postUser(f.workspaceId, '@Lead discuss');
    answer(backendStep.events, message('Backend final second'));
    await f.runtime.finished(f.backend.memberId, accepted.runs[0]!.runId);
    const frontendStep = await f.requests.next();
    answer(frontendStep.events, message('Frontend final first'));
    await f.runtime.finished(f.frontend.memberId, accepted.runs[1]!.runId);
    const leadStep = await f.requests.next();
    answer(leadStep.events, message('Lead final'));
    await f.runtime.finished(f.lead.memberId, later.runs[0]!.runId);
    const snapshot = await store.team.chatTimeline(f.workspaceId);
    const current = new Map(snapshot.changes.map(change => [change.entry.entryId, change.entry]));
    const ordered = [...current.values()].sort((a, b) => a.position - b.position);
    assert.deepEqual(ordered.map(entry => entry.kind === 'member' ? entry.name : 'User'), ['User', 'Backend', 'Frontend', 'User', 'Lead']);
    const backend = ordered[1]!;
    assert.equal(backend.kind, 'member');
    if (backend.kind !== 'member') throw new Error('member missing');
    assert.equal(backend.text, 'Backend final second');
    const records = await store.agents.runMessages(f.backend.memberId, accepted.runs[0]!.runId);
    assert.equal(backend.finalRef!.messageId, records.at(-1)!.messageId);
    assert.equal(backend.working.through, records.at(-1)!.position);
    const context = await store.agents.getContext(f.backend.memberId);
    await store.agents.replaceContext(f.backend.memberId, context.revision, []);
    await f.team.runner.retire(f.workspaceId, f.backend.memberId, f.backend.revision);
    assert.deepEqual(await store.team.chatTimeline(f.workspaceId), snapshot, 'retirement/compaction preserve pinned history');
    const changes = await store.team.chatTimeline(f.workspaceId, cursor, 1);
    assert.equal(changes.changes.length, 1); assert.equal(changes.more, true);
    assert.ok(snapshot.changes.filter(change => change.cursor > cursor).some(change => change.entry.position === 2), 'new cursor carries older response completion');
    const [publicRows] = await store.pool.execute<any[]>('SELECT entry FROM chat_messages WHERE workspace_id = ?', [f.workspaceId]);
    const storedFinals = publicRows.map(row => typeof row.entry === 'string' ? JSON.parse(row.entry).data : row.entry.data).filter(entry => entry.author.type === 'member');
    assert.ok(storedFinals.every(entry => entry.finalRef && entry.text === undefined), 'public history stores references, not duplicate final text');
    const reopened = new CoreData(new MySqlStorage(databaseUrl!));
    try { await reopened.migrate(); assert.deepEqual(await reopened.team.chatTimeline(f.workspaceId), snapshot); } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test('group timeline refusal creates no reservation, and cancellation/restart finalize retained entries without a final', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, '@Backend work'); await f.requests.next();
    const before = await store.team.chatTimeline(f.workspaceId);
    await assert.rejects(f.team.runner.postUser(f.workspaceId, '@Backend @Frontend again'), (error: unknown) => (error as { code: string }).code === 'member_busy');
    assert.deepEqual(await store.team.chatTimeline(f.workspaceId), before);
    await assert.rejects(store.team.publishChat({ workspaceId: f.workspaceId, author: { type: 'member', memberId: f.backend.memberId, name: 'Backend', runId: accepted.runs[0]!.runId }, exchangeId: accepted.message.exchangeId, text: 'fake', recipients: [], finalMessageId: 'wrong' }));
    assert.deepEqual(await store.team.chatTimeline(f.workspaceId), before);
    await f.team.runner.stop(f.workspaceId);
    await f.runtime.finished(f.backend.memberId, accepted.runs[0]!.runId);
    const entry = (await store.team.chatTimeline(f.workspaceId)).changes.at(-1)!.entry;
    assert.equal(entry.kind, 'member');
    if (entry.kind === 'member') { assert.equal(entry.run.status, 'cancelled'); assert.equal(entry.finalRef, null); assert.equal(entry.position, 2); assert.equal(entry.working.through, 0); }
    const input = await store.team.publishChat({ workspaceId: f.workspaceId, author: { type: 'user' }, text: 'abandoned work', recipients: [f.frontend.memberId] });
    await f.runtime.close(); // Persisted but unlaunched work remains abandoned until recovery.
    const reopened = new AgentRuntime(store.agents, teamFor(f.runtime).runConfig, configuredPolicy(), () => { throw new Error('Recovery must not run a model'); });
    await reopened.open();
    try {
      const recovered = (await store.team.chatTimeline(f.workspaceId)).changes.at(-1)!.entry;
      assert.equal(recovered.entryId, input.runs[0]!.runId);
      if (recovered.kind === 'member') { assert.equal(recovered.run.status, 'interrupted'); assert.equal(recovered.finalRef, null); assert.equal(recovered.working.through, recovered.run.endPosition); }
    } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test('old prototype group history imports once in publication order using the old terminal history bound', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await store.team.publishChat({workspaceId:f.workspaceId,author:{type:'user'},text:'work',recipients:[f.lead.memberId]});
    const run=accepted.runs[0]!;
    const messageId=randomUUID();
    await store.agents.beginMessage(f.lead.memberId,run.runId,messageId,1);
    await store.agents.commitMessage(f.lead.memberId,run.runId,{messageId,message:message('Existing prototype final'),metadata:{}});
    await store.team.publishChat({workspaceId:f.workspaceId,author:{type:'member',memberId:f.lead.memberId,name:'Lead',runId:run.runId},exchangeId:accepted.message.exchangeId,text:'Existing prototype final',recipients:[],finalMessageId:messageId});
    const history = await store.team.chatSnapshot(f.workspaceId);
    const record = history.messages[1]!;
    // Recreate the immediately previous committed storage format in this disposable workspace.
    await store.pool.execute('UPDATE chat_messages SET entry = ? WHERE workspace_id = ? AND position = ?', [JSON.stringify({ version: 1, data: { workspaceId: record.workspaceId, messageId: record.messageId, position: record.position, exchangeId: record.exchangeId, author: record.author, text: record.text, recipients: record.recipients, time: record.time } }), f.workspaceId, record.position]);
    for (const table of ['chat_changes', 'chat_entries', 'chat_clock']) await store.pool.execute(`DELETE FROM ${table} WHERE workspace_id = ?`, [f.workspaceId]);
    await store.migrate();
    const imported = await store.team.chatTimeline(f.workspaceId);
    assert.deepEqual(imported.changes.map(change => change.entry.kind), ['user', 'member']);
    const final = imported.changes[1]!.entry;
    if (final.kind === 'member') { assert.equal(final.text, 'Existing prototype final'); assert.equal(final.finalRef!.position, final.run.endPosition); }
    await store.migrate(); assert.deepEqual(await store.team.chatTimeline(f.workspaceId), imported, 'upgrade is repeatable');
    assert.deepEqual((await store.team.chatSnapshot(f.workspaceId)).messages.map(message => message.text), history.messages.map(message => message.text));
  } finally { await f.close(); }
});

test('member file activation atomically replaces/updates the team, retains history and leaves pending bytes inactive', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, '@Backend establish history');
    answer((await f.requests.next()).events, message('Established shared history.'));
    await f.runtime.finished(f.backend.memberId, accepted.runs[0]!.runId);
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    const oldContext = await store.agents.getContext(f.backend.memberId);
    const files = await f.team.harness.files(f.lead.memberId);
    const backendSource = await f.team.configuration.accepted(f.workspaceId, f.backend.memberId);
    const frontendSource = await f.team.configuration.accepted(f.workspaceId, f.frontend.memberId);
    const { dirname, join: pathJoin } = await import('node:path');
    await rm(pathJoin(files.root, backendSource.path));
    await files.write.writeFile(pathJoin(files.root, frontendSource.path), JSON.stringify({ ...JSON.parse(frontendSource.files['member.json']!), responsibility: 'Updated atomically' }));
    await files.write.mkdir(pathJoin(files.root, '.rsi/members/Replacement/prompts'));
    const manifest = { name:'Replacement',role:'developer',responsibility:'Replacement',settings:{},promptFiles:['prompts/member.md'],designScope:{working:['metadata.json'],dependencies:[]},execute:{allowedCommands:[]} };
    await files.write.writeFile(pathJoin(files.root, '.rsi/members/Replacement/member.json'), JSON.stringify(manifest));
    await files.write.writeFile(pathJoin(files.root, '.rsi/members/Replacement/prompts/member.md'), 'Accepted prompt');
    const pending = await f.team.configuration.validate(f.lead.memberId, '.rsi/members'); assert.equal(pending.valid, true, JSON.stringify(pending.issues));
    await acceptFiles(f);
    const review = await f.team.reviewConfiguration(f.workspaceId);
    assert.deepEqual(review.changes.map(c => c.type).sort(), ['create','delete','update']);
    await files.write.writeFile(pathJoin(files.root, '.rsi/members/Replacement/prompts/member.md'), 'Pending after commit');
    await f.team.activateConfiguration(f.workspaceId, review.revision, review.digest);
    const replacement = (await f.team.service.byName(f.workspaceId, 'Replacement'))!;
    const marker = await store.team.getMemberActivation(f.workspaceId);
    assert.equal(marker!.revision, review.revision);
    const reopenedStore = new CoreData(new MySqlStorage(databaseUrl!));
    try { assert.deepEqual(await reopenedStore.team.getMemberActivation(f.workspaceId), marker); }
    finally { await reopenedStore.close(); }
    assert.notEqual(replacement.id, f.backend.memberId); assert.equal(replacement.value.settings.prompt, 'Accepted prompt');
    assert.equal((await f.team.member(f.workspaceId, f.frontend.memberId)).responsibility, 'Updated atomically');
    assert.ok((await store.team.getMember(f.backend.memberId))!.value.retiredAt !== null);
    assert.deepEqual(await store.agents.getContext(f.backend.memberId), oldContext);
    assert.equal((await store.agents.getContext(replacement.id)).entries.length, 0);
    assert.equal((await f.team.runner.snapshot(f.workspaceId)).runs.length, 1, 'activation starts no runs');
    const reopened = new TeamSystem(store.team, workspaces, config); reopened.attach(f.runtime);
    try { assert.equal((await reopened.configuration.accepted(f.workspaceId, replacement.id)).acceptedRevision, review.revision); }
    finally { await reopened.runner.close(); }
  } finally { await f.close(); }
});

test('member activation store rejects busy/stale state and rolls back earlier member updates on insertion failure', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const active = await f.team.service.active(f.workspaceId), before = await store.team.getMember(f.frontend.memberId);
    const marker = await store.team.getMemberActivation(f.workspaceId);
    const modelsRevision = (await f.team.service.models(f.workspaceId)).revision;
    const expected = active.map(m => ({id:m.id,revision:m.revision}));
    const update = { ...before!,revision:before!.revision+1,value:{...before!.value,responsibility:'Must roll back'} };
    const duplicate = { id:randomUUID(),workspaceId:f.workspaceId,lead:false,nameKey:'frontend',value:{...before!.value,lead:false} };
    await assert.rejects(store.team.activateMembers(f.workspaceId,{expectedActivation:marker,activation:{revision:'test',time:0},expected,modelsRevision,create:[duplicate],update:[update]}),code('member_exists'));
    assert.deepEqual(await store.team.getMemberActivation(f.workspaceId), marker, 'activation marker rolls back with roster changes');
    assert.deepEqual(await store.team.getMember(f.frontend.memberId),before);
    await assert.rejects(store.team.activateMembers(f.workspaceId,{expectedActivation:marker,activation:{revision:'test',time:0},expected:[],modelsRevision,create:[],update:[]}),code('config_conflict'));
    const accepted = await f.team.runner.postUser(f.workspaceId,'@Backend work');
    const response = await f.requests.next();
    await assert.rejects(store.team.activateMembers(f.workspaceId,{expectedActivation:marker,activation:{revision:'test',time:0},expected,modelsRevision,create:[],update:[update]}),code('workspace_busy'));
    assert.deepEqual(await store.team.getMember(f.frontend.memberId),before);
    answer(response.events,message('Done.')); await f.runtime.finished(f.backend.memberId,accepted.runs[0]!.runId);
  } finally { await f.close(); }
});

test('fresh bootstrap and administrative reset persist atomic baselines, preserve providers/files and roll back failed cleanup', {timeout:30_000}, async () => {
  const database = `bootstrap_${randomUUID().replaceAll('-','')}`, url = new URL(databaseUrl!); url.pathname = `/${database}`;
  await store.pool.query(`CREATE DATABASE ${database}`);
  const isolated = new CoreData(new MySqlStorage(url.toString())), service = new WorkspaceService(isolated.workspaces,testModelValidator);
  const folder = await mkdtemp(join(tmpdir(),'bootstrap-reset-'));
  const {mkdir,readdir} = await import('node:fs/promises');
  const {resetWorkspaceData} = await import('../../src/core/workspace-reset.js');
  try {
    await isolated.migrate();
    await isolated.config.createConfig('connection','provider',{label:'Keep',encryptedKey:'opaque-ciphertext'});
    await isolated.config.createConfig('app','settings',{title:'Keep settings'});
    await isolated.agents.createAgent('stale-solo');
    const before = await isolated.pool.query('SELECT scope,id,revision,data FROM config_records WHERE scope <> ? ORDER BY scope,id',['agent']);
    const directory = join(folder,'project'); await mkdir(directory); await writeFile(join(directory,'code.ts'),'implementation');
    const workspace = await service.create({workspaceId:'fresh',name:'Fresh',directory,adopt:true,models:testModels()});
    assert.equal(workspace.context.seq,1); assert.equal(workspace.context.files,3);
    const lead = (await isolated.team.listMembers('fresh'))[0]!;
    assert.deepEqual(lead.value.harness.designScope.working,['metadata.json']);
    assert.equal((await isolated.team.getMemberActivation('fresh'))!.revision,lead.value.configuration!.acceptedRevision);
    const reopened = new CoreData(new MySqlStorage(url.toString()));
    try { assert.deepEqual(await reopened.team.getMemberActivation('fresh'),await isolated.team.getMemberActivation('fresh')); assert.deepEqual((await reopened.workspaces.loadContext('fresh')).files.map(f=>f.path).sort(),['design/design.md','design/metadata.json','implement/impl/README.md']);
      const changes = await reopened.workspaces.records('fresh',0,10);
      assert.equal(changes.length,1); assert.equal(changes[0]!.files.length,3);
      const context = await service.context('fresh');
      assert.match((await context.read({path:'implement/impl/README.md'})).content,/### Usage examples/); }
    finally {await reopened.close();}
    const original = isolated.workspaces.createWorkspace.bind(isolated.workspaces);
    isolated.workspaces.createWorkspace = async (record,key,member,models,bootstrap) => { bootstrap!.context.files.push(bootstrap!.context.files[0]!); return original(record,key,member,models,bootstrap); };
    const failed = join(folder,'failed'); await mkdir(failed); await writeFile(join(failed,'code.ts'),'kept');
    await assert.rejects(service.create({workspaceId:'failed',name:'Failed',directory:failed,adopt:true,models:testModels()}));
    assert.equal(await isolated.workspaces.getWorkspace('failed'),null); assert.equal(await isolated.team.getMemberActivation('failed'),null);
    assert.deepEqual(await isolated.team.listMembers('failed'),[]); assert.deepEqual(await readdir(failed),['code.ts']); isolated.workspaces.createWorkspace = original;
    await service.close();
    const blocker = new CoreData(new MySqlStorage(url.toString())); await blocker.agents.acquireRuntime(()=>{});
    try {await assert.rejects(resetWorkspaceData(isolated),code('runtime_conflict'));} finally {await blocker.close();}
    await isolated.pool.query('CREATE TABLE reset_failure (workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin, FOREIGN KEY (workspace_id) REFERENCES workspaces(id))');
    await isolated.pool.query("INSERT INTO reset_failure VALUES ('fresh')");
    await assert.rejects(resetWorkspaceData(isolated));
    assert.ok(await isolated.workspaces.getWorkspace('fresh')); assert.ok((await readdir(directory)).includes('.rsi'));
    await isolated.pool.query('DROP TABLE reset_failure');
    const result = await resetWorkspaceData(isolated); assert.equal(result.workspaces,1);
    assert.deepEqual(await isolated.workspaces.listWorkspaces(),[]); assert.deepEqual(await isolated.config.listAgents(),[]);
    const [remaining] = await isolated.pool.query("SELECT scope,id,revision,data FROM config_records WHERE scope <> ? ORDER BY scope,id",['agent']);
    assert.deepEqual(remaining,before[0]); assert.equal(await readFile(join(directory,'code.ts'),'utf8'),'implementation'); assert.deepEqual(await readdir(directory),['code.ts']);
  } finally { await service.close(); await isolated.close(); await rm(folder,{recursive:true,force:true}); await store.pool.query(`DROP DATABASE ${database}`); }
});

test('member model preferences persist in MySQL, drive prepared runs and survive reopening without changing active source', { timeout: 15_000 }, async () => {
  const models = builtinModels();
  const service = new ConfigService(store.config, models);
  const connectionId = `member-model-${randomUUID()}`;
  await service.createConnection(connectionId, { label: 'Member model test', provider: 'deepseek', baseUrl: models.getModel('deepseek','deepseek-v4-pro')!.baseUrl, api: 'openai-completions' });
  const folder = await realpath(await mkdtemp(join(tmpdir(),'rsi-member-model-')));
  const team = new TeamSystem(store.team,workspaces,service);
  let reopened: TeamSystem | undefined;
  try {
    const workspace = await workspaces.create({name:'Member model test',directory:join(folder,'project'),models:testModels(),adopt:false});
    const lead = (await team.service.team(workspace.workspaceId)).members[0]!;
    const source = (await team.service.find(lead.memberId))!.value.configuration;
    const value = {connectionId,modelId:'deepseek-v4-pro',modelOptions:[{connectionId,modelId:'deepseek-v4-pro',reasoning:'high',temperature:0.4,maxTokens:128,contextBudget:4000}]};
    const saved = await team.updateModelSettings(workspace.workspaceId,lead.memberId,lead.revision,value);
    const prepared = await team.runConfig.resolveForRun(lead.memberId);
    assert.equal(prepared.options.reasoning,'high'); assert.equal(prepared.options.temperature,0.4); assert.equal(prepared.options.maxTokens,128); assert.equal(prepared.contextBudget,4000);
    assert.equal(prepared.source.agentRevision,saved.revision);
    await assert.rejects(team.updateModelSettings(workspace.workspaceId,lead.memberId,saved.revision,{...value,modelId:'nonexistent'}), /Selected model is unavailable/);
    await assert.rejects(team.updateModelSettings(workspace.workspaceId,lead.memberId,saved.revision,{...value,modelOptions:[{connectionId,modelId:'deepseek-v4-pro',maxTokens:999999999}]}), /exceed/);
    await team.updateModelSettings(workspace.workspaceId,lead.memberId,saved.revision,{...value,modelOptions:[{connectionId,modelId:'deepseek-v4-pro',reasoning:'xhigh'}]});
    assert.equal(prepared.options.reasoning,'high','prepared snapshot is unchanged');
    assert.equal((await team.runConfig.resolveForRun(lead.memberId)).options.reasoning,'max');
    reopened = new TeamSystem(store.team,workspaces,service); await reopened.initialize();
    assert.equal((await reopened.service.get(workspace.workspaceId,lead.memberId)).settings.modelOptions[0]!.reasoning,'xhigh');
    assert.deepEqual((await reopened.service.find(lead.memberId))!.value.configuration,source);
  } finally {
    team.runner.close(); reopened?.runner.close();
    await rm(folder,{recursive:true,force:true});
  }
});

test('reset boundary migration upgrades existing chat settings without changing history or settings', { timeout: 15_000 }, async () => {
  const [before] = await store.pool.query('SELECT workspace_id, position, mention_limit FROM chat_settings ORDER BY workspace_id');
  await store.pool.query('ALTER TABLE chat_settings DROP COLUMN reset_cursor, DROP COLUMN reset_position');
  await store.migrate();
  const [after] = await store.pool.query('SELECT workspace_id, position, mention_limit FROM chat_settings ORDER BY workspace_id');
  assert.deepEqual(after, before);
  const [boundaries] = await store.pool.query<any[]>('SELECT reset_cursor, reset_position FROM chat_settings');
  assert.ok(boundaries.every(row => row.reset_cursor === 0 && row.reset_position === 0));
  await store.migrate();
  assert.deepEqual((await store.pool.query('SELECT workspace_id, position, mention_limit FROM chat_settings ORDER BY workspace_id'))[0], before);
});

test('workspace chat reset atomically clears member conversation storage and starts fresh while preserving files and configuration', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  const otherId = `other-${randomUUID()}`;
  try {
    const workspace = (await store.workspaces.getWorkspace(f.workspaceId))!;
    const file = join(workspace.directory, 'keep-source.txt');
    await writeFile(file, 'Keep project implementation');
    const solo = await store.agents.createAgent();
    const soloRun = await store.agents.startRun(solo.agentId, user);
    await store.agents.finishRun(solo.agentId, soloRun.runId, 'completed');
    const soloBefore = await store.agents.followSnapshot(solo.agentId, undefined, 0);
    await store.workspaces.createWorkspace({ workspaceId: otherId, name: 'Other', directory: '/tmp/' + otherId, createdAt: 1 }, sha256(otherId), newLead(otherId));
    const other = await store.team.publishChat({ workspaceId: otherId, author: { type: 'user' }, text: 'Other conversation', recipients: [] });
    await f.team.runner.configure(f.workspaceId, 7);
    const accepted = await f.team.runner.postUser(f.workspaceId, '@Lead @Backend original conversation');
    for (let index = 0; index < 2; index++) answer((await f.requests.next()).events, message('Original final'));
    for (const run of accepted.runs) await f.runtime.finished(run.agentId, run.runId);
    // Include retired members, not only the current active roster.
    const backend = (await f.team.service.find(f.backend.memberId))!;
    await f.team.service.retire(f.workspaceId, backend.id, backend.revision);
    await new Promise(resolve => setImmediate(resolve));
    const members = await store.team.listMembers(f.workspaceId);
    const contextBase = await store.workspaces.loadContext(f.workspaceId);
    const configBefore = await store.config.configBundle(null);
    const harnessBefore = await f.team.harness.environment(f.lead.memberId);
    const contextBefore = await store.agents.getContext(f.lead.memberId);
    const before = await store.team.chatTimeline(f.workspaceId);
    const oldCursor = before.cursor;
    const retained = accepted.runs.map(run => ({ run, messageId: f.runtime.progress.lane(run.agentId).ring.find(Boolean)!.messageId }));
    const result = await f.team.runner.reset(f.workspaceId);
    for (const { run, messageId } of retained) assert.equal(f.runtime.progress.read(run.agentId, run.runId, messageId), undefined, 'reset also clears retired-member progress');
    assert.ok(result.resetCursor > oldCursor);
    const timeline = await store.team.chatTimeline(f.workspaceId, oldCursor);
    assert.deepEqual(timeline.changes, []); assert.equal(timeline.more, false);
    assert.equal(timeline.resetCursor, result.resetCursor);
    assert.equal(timeline.mentionLimit, 7);
    const chat = await store.team.chatSnapshot(f.workspaceId);
    assert.deepEqual(chat.messages, []); assert.deepEqual(chat.runs, []); assert.equal(chat.more, false);
    for (const member of members) {
      const context = await store.agents.getContext(member.id), state = await f.runtime.getState(member.id);
      assert.deepEqual(context.entries, []); assert.equal(state.historyPosition, 0); assert.equal(state.run, null);
      assert.deepEqual((await store.agents.followSnapshot(member.id, undefined, 0)).history, []);
    }
    await assert.rejects(store.agents.followSnapshot(accepted.runs[0]!.agentId, accepted.runs[0]!.runId, 0), (e: any) => e.code === 'not_found');
    await assert.rejects(store.agents.replaceContext(f.lead.memberId, contextBefore.revision, contextBefore.entries), (e: any) => e.code === 'context_conflict');
    assert.deepEqual(await store.team.listMembers(f.workspaceId), members);
    assert.deepEqual(await store.workspaces.loadContext(f.workspaceId), contextBase);
    assert.deepEqual(await store.config.configBundle(null), configBefore);
    assert.deepEqual(await f.team.harness.environment(f.lead.memberId), harnessBefore);
    assert.equal(await readFile(file, 'utf8'), 'Keep project implementation');
    assert.deepEqual(await store.agents.followSnapshot(solo.agentId, undefined, 0), soloBefore);
    assert.equal((await store.team.chatSnapshot(otherId)).messages[0]!.messageId, other.message.messageId);
    const reopened = new CoreData(new MySqlStorage(databaseUrl!));
    try { await reopened.migrate(); assert.deepEqual(await reopened.team.chatTimeline(f.workspaceId), timeline); assert.deepEqual((await reopened.agents.getContext(f.lead.memberId)).entries, []); }
    finally { await reopened.close(); }
    const fresh = await f.team.runner.postUser(f.workspaceId, 'Fresh conversation');
    assert.ok(fresh.message.position > result.resetPosition);
    assert.ok(fresh.entries[0]!.revision > result.resetCursor);
    assert.equal(fresh.entries[1]!.kind === 'member' && fresh.entries[1]!.working.after, 0);
    const request = await f.requests.next();
    assert.equal(request.request.context.messages.length, 1);
    assert.ok(JSON.stringify(request.request.context.messages).includes('Fresh conversation'));
    assert.ok(!JSON.stringify(request.request.context.messages).includes('original conversation'));
    answer(request.events, message('Fresh answer'));
    await f.runtime.finished(fresh.runs[0]!.agentId, fresh.runs[0]!.runId);
    assert.deepEqual((await store.agents.getContext(f.backend.memberId)).entries, [], 'retired members remain outside later delivery');
  } finally { await f.close(); }
});

test('workspace chat reset refuses live runs and rolls back all deletions on persistence failure', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  const trigger = 'reset_failure_' + randomUUID().replaceAll('-', '');
  let installed = false;
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, 'Preserve on refusal');
    const request = await f.requests.next();
    const before = await store.team.chatTimeline(f.workspaceId);
    await assert.rejects(store.team.resetChat(f.workspaceId), (e: any) => e.code === 'workspace_busy');
    assert.deepEqual(await store.team.chatTimeline(f.workspaceId), before);
    answer(request.events, message('Preserve this final'));
    await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId);
    await new Promise(resolve => setImmediate(resolve));
    const stable = await store.team.chatTimeline(f.workspaceId), context = await store.agents.getContext(f.lead.memberId), history = await store.agents.followSnapshot(f.lead.memberId, undefined, 0);
    await store.pool.query(`CREATE TRIGGER ${trigger} BEFORE DELETE ON messages FOR EACH ROW BEGIN IF OLD.agent_id = '${f.lead.memberId}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected reset failure'; END IF; END`);
    installed = true;
    await assert.rejects(f.team.runner.reset(f.workspaceId), /Injected reset failure/);
    assert.deepEqual(await store.team.chatTimeline(f.workspaceId), stable);
    assert.deepEqual(await store.agents.getContext(f.lead.memberId), context);
    assert.deepEqual(await store.agents.followSnapshot(f.lead.memberId, undefined, 0), history);
    await store.pool.query(`DROP TRIGGER ${trigger}`); installed = false;
    await f.team.runner.reset(f.workspaceId);
    assert.deepEqual((await store.team.chatTimeline(f.workspaceId)).changes, []);
  } finally { if (installed) await store.pool.query(`DROP TRIGGER ${trigger}`); await f.close(); }
});

test('tool error results, thrown errors and unknown tools preserve call identity and let later batch calls finish', { timeout: 15_000 }, async () => {
  const executed: string[] = [];
  const failure = { content: [{ type: 'text' as const, text: 'Timed out reading one source; choose another source.' }], isError: true, details: { error_code: 'web_timeout', retryable: true } };
  const tools: RuntimeTool[] = [
    { definition: { name: 'timeout', description: '', parameters: Type.Object({}) }, execute: async () => { executed.push('timeout'); return failure; } },
    { definition: { name: 'throws', description: '', parameters: Type.Object({}) }, execute: async () => { executed.push('throws'); throw new Error('Requested file is unavailable'); } },
    { definition: { name: 'working', description: '', parameters: Type.Object({}) }, execute: async () => { executed.push('working'); return { content: [{ type: 'text', text: 'Usable source' }], isError: false }; } },
  ];
  const f = await fixture({ policy: fixedPolicy(model, tools) });
  try {
    const run = await f.runtime.start(f.agentId, 'Use available sources');
    answer((await f.requests.next()).events, fauxAssistantMessage(['timeout', 'throws', 'missing', 'working'].map(name => ({ type: 'toolCall' as const, id: `call-${name}`, name, arguments: {} })), { stopReason: 'toolUse' }));
    const recovery = await f.requests.next();
    const results = recovery.request.context.messages.filter(m => m.role === 'toolResult');
    assert.deepEqual(results.map(result => [result.toolCallId, result.toolName, result.isError]), [
      ['call-timeout', 'timeout', true], ['call-throws', 'throws', true], ['call-missing', 'missing', true], ['call-working', 'working', false],
    ]);
    assert.deepEqual(results[0]!.content, failure.content);
    assert.deepEqual(results[0]!.details, failure.details);
    assert.match(JSON.stringify(results[1]), /Requested file is unavailable/);
    assert.match(JSON.stringify(results[2]), /Tool is unavailable: missing/);
    assert.deepEqual(executed, ['timeout', 'throws', 'working'], 'no implicit retry; later calls still execute');
    answer(recovery.events, message('Completed using the usable source.'));
    const terminal = await f.runtime.finished(f.agentId, run.runId);
    assert.equal(terminal.status, 'completed'); assert.equal(terminal.error, null);
    const history = await store.agents.runMessages(f.agentId, run.runId);
    assert.equal(history.filter(record => record.message.role === 'toolResult').length, 4);
    assert.equal(history.at(-1)!.message.role, 'assistant');
  } finally { await f.runtime.close(); }
});

test('failure to persist an error tool result remains terminal and never reaches a new model step', { timeout: 15_000 }, async () => {
  const tool: RuntimeTool = { definition: { name: 'error_result', description: '', parameters: Type.Object({}) }, execute: async () => ({ content: [{ type: 'text', text: 'A recoverable tool error' }], isError: true }) };
  const f = await fixture({ policy: fixedPolicy(model, [tool]) });
  const commit = store.agents.commitMessage.bind(store.agents);
  try {
    const run = await f.runtime.start(f.agentId, 'Try a tool');
    store.agents.commitMessage = async (...args) => { if (args[2].message.role === 'toolResult') throw new Error('Cannot persist tool result'); return commit(...args); };
    answer((await f.requests.next()).events, fauxAssistantMessage([{ type: 'toolCall', id: 'error-call', name: 'error_result', arguments: {} }], { stopReason: 'toolUse' }));
    const terminal = await f.runtime.finished(f.agentId, run.runId);
    assert.equal(terminal.status, 'failed'); assert.match(terminal.error!.message, /Cannot persist tool result/);
    assert.equal((await store.agents.runMessages(f.agentId, run.runId)).filter(record => record.message.role === 'toolResult').length, 0);
  } finally { store.agents.commitMessage = commit; await f.runtime.close(); }
});

test('member can publish a final response after a private web tool error in the same activation', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, 'Use the available information if search is unavailable');
    answer((await f.requests.next()).events, fauxAssistantMessage([{ type: 'toolCall', id: 'web-unavailable', name: 'web_fetch', arguments: { url: 'https://example.com' } }], { stopReason: 'toolUse' }));
    const recovery = await f.requests.next();
    const result = recovery.request.context.messages.find(m => m.role === 'toolResult' && m.toolCallId === 'web-unavailable');
    assert.ok(result?.role === 'toolResult' && result.isError);
    assert.match(JSON.stringify(result), /web_not_configured/);
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).messages.length, 1, 'tool failure is private');
    answer(recovery.events, message('The page could not be retrieved; here is the answer from available context.'));
    const terminal = await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId);
    assert.equal(terminal.status, 'completed'); assert.equal(terminal.error, null);
    const chat = await store.team.chatSnapshot(f.workspaceId);
    assert.equal(chat.messages.length, 2); assert.match(chat.messages[1]!.text, /available context/);
    const entry = (await store.team.chatTimeline(f.workspaceId)).changes.at(-1)!.entry;
    assert.ok(entry.kind === 'member' && entry.finalRef && entry.run.status === 'completed');
  } finally { await f.close(); }
});

test('compact streaming performs no SQL reads between durable boundaries and completion remains authoritative', { timeout: 15_000 }, async () => {
  const f = await fixture();
  const original = store.agents.followSnapshot.bind(store.agents); let reads = 0;
  store.agents.followSnapshot = async (...args) => { reads++; return original(...args); };
  try {
    const run = await f.runtime.start(f.agentId, 'go');
    const { events } = await f.requests.next();
    const stream = f.runtime.follow(f.agentId, { runId: run.runId });
    await until(stream, 'sync');
    events.push({ type: 'start', partial: { ...message(''), content: [], stopReason: 'pending' } });
    events.push({ type: 'text_start', contentIndex: 0, partial: message('') });
    await until(stream, 'chunk'); await until(stream, 'chunk');
    const baseline = reads;
    for (let i = 0; i < 100; i++) events.push({ type: 'text_delta', contentIndex: 0, delta: 'x', partial: message('x'.repeat(i + 1)) });
    let bytes = 0;
    for (let i = 0; i < 100; i++) {
      const chunk = await until(stream, 'chunk');
      assert.equal(chunk.type, 'chunk');
      if (chunk.type === 'chunk') {
        assert.equal(chunk.event.type, 'text_delta'); assert.equal('partial' in chunk.event, false);
        bytes += Buffer.byteLength(JSON.stringify(chunk));
      }
    }
    assert.equal(reads, baseline, 'incoming deltas read memory only');
    assert.ok(bytes < 30_000, `compact transfer: ${bytes}`);
    events.push({ type: 'done', reason: 'stop', message: message('x'.repeat(100)) });
    const rest = await collect(stream);
    assert.equal(rest.filter(e => e.type === 'message').length, 1);
    const completed = rest.find(e => e.type === 'message');
    assert.equal(completed?.type === 'message' && completed.record.message.role === 'assistant' && completed.record.message.content[0]?.type === 'text' && completed.record.message.content[0].text.length, 100);
    assert.equal(rest.at(-1)?.type, 'end');
  } finally { store.agents.followSnapshot = original; await f.runtime.close(); }
});

test('FIFO eviction while SQL synchronization is paused discards the tail and recovers at the next message start', { timeout: 15_000 }, async () => {
  const f = await fixture({ progressCapacity: 3, policy: { ...fixedPolicy(model), shouldContinue: scope => scope.step === 1 } });
  try {
    const run = await f.runtime.start(f.agentId, 'go'), first = await f.requests.next();
    const follower = f.runtime.follow(f.agentId, { runId: run.runId });
    assert.equal((await follower.next()).value?.type, 'message'); // Hold initial SQL sync at a slow reader.
    first.events.push({ type: 'start', partial: { ...message(''), content: [] } });
    first.events.push({ type: 'text_start', contentIndex: 0, partial: message('') });
    for (let i = 0; i < 8; i++) first.events.push({ type: 'text_delta', contentIndex: 0, delta: 'x', partial: message('x') });
    await new Promise(resolve => setTimeout(resolve, 20));
    const gap = await until(follower, 'gap'); assert.equal(gap.type, 'gap');
    first.events.push({ type: 'done', reason: 'stop', message: message('first whole') });
    const second = await f.requests.next();
    second.events.push({ type: 'start', partial: { ...message(''), content: [] } });
    const stable = await until(follower, 'message');
    assert.equal(stable.type === 'message' && stable.record.message.role === 'assistant' && stable.record.message.content[0]?.type === 'text' && stable.record.message.content[0].text, 'first whole');
    const start = await until(follower, 'chunk');
    assert.equal(start.type === 'chunk' && start.event.type, 'start');
    assert.equal(start.type === 'chunk' && start.sequence, 0);
    second.events.push({ type: 'done', reason: 'stop', message: message('second whole') });
    assert.equal((await collect(follower)).at(-1)?.type, 'end');
  } finally { await f.runtime.close(); }
});


test('shared workspace handoff waits for sender finalization before recipient execution', {timeout:30_000}, async()=>{
  let release!:()=>void, entered!:()=>void, calls=0;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  const finalizing=new Promise<void>(resolve=>{entered=resolve;});
  const base=configuredPolicy();
  const f=await groupFixture({...base,buildRequest:(scope,history)=>{calls++;return base.buildRequest(scope,history);},afterRun:async run=>{
    if(run.agentId===f.lead.memberId){entered();await hold;}
  }});
  try{
    const start=await f.team.runner.postUser(f.workspaceId,'Delegate');
    const lead=await f.requests.next();
    answer(lead.events,message('<mentions>["Backend"]</mentions>\nImplement.'));
    await finalizing;
    assert.equal(calls,1,'recipient model cannot start during sender finalization');
    assert.equal((await f.runtime.getState(f.backend.memberId)).run?.step,0);
    await assert.rejects(f.team.runner.postUser(f.workspaceId,'@Backend duplicate'),code('member_busy'));
    release();await f.runtime.finished(f.lead.memberId,start.runs[0]!.runId);
    const worker=await f.requests.next();assert.equal(calls,2);
    answer(worker.events,message('Finished.'));
    const run=(await f.runtime.getState(f.backend.memberId)).run!;
    await f.runtime.finished(f.backend.memberId,run.runId);
  }finally{release();await f.close();}
});

test('stopping shared workspace cancels waiting runs without executing or checkpointing them', {timeout:30_000}, async()=>{
  let calls=0;const base=configuredPolicy();
  const f=await groupFixture({...base,buildRequest:(scope,history)=>{calls++;return base.buildRequest(scope,history);}});
  try{
    const start=await f.team.runner.postUser(f.workspaceId,'@Backend @Frontend work');
    await f.requests.next();assert.equal(calls,1);
    await f.team.runner.stop(f.workspaceId);
    const ended=await Promise.all(start.runs.map(run=>f.runtime.finished(run.agentId,run.runId)));
    assert.deepEqual(ended.map(run=>run.status),['cancelled','cancelled']);assert.equal(calls,1);
    const waiting=start.runs[1]!;
    assert.deepEqual(await store.agents.runMessages(waiting.agentId,waiting.runId),[]);
    assert.equal(f.team.harness.approvals.list(f.workspaceId).length,0);
    const next=await f.team.runner.postUser(f.workspaceId,'Fresh request');
    answer((await f.requests.next()).events,message('Ready.'));
    assert.equal((await f.runtime.finished(f.lead.memberId,next.runs[0]!.runId)).status,'completed');
  }finally{await f.close();}
});


test('predefined Modelflare models resolve offline, override stale discovery and respect model API support', async () => {
  const models = createBackendModels();
  const service = new ConfigService(store.config, models, [], testEncryptionKey);
  const connectionId = `modelflare-${randomUUID()}`;
  const connection = await service.createConnection(connectionId, { label: 'Gateway', provider: 'modelflare',
    baseUrl: 'https://modelflare.dev', api: 'anthropic-messages', apiKey: 'gateway-private-key' });
  const choices = await service.modelChoices(connectionId);
  const haiku = choices.find(item => item.modelId === 'claude-haiku-5-5')!;
  assert.equal(haiku.verified, true);
  assert.equal(haiku.reasoning, true);
  assert.equal(haiku.contextWindow, 1_000_000);
  assert.equal(haiku.maxTokens, 128_000);
  assert.equal(choices.some(item => item.modelId === 'gpt-6.1-sol'), false);
  assert.equal(service.capabilities().models.filter(item => item.provider === 'modelflare').length, 32);
  await store.config.createConfig('model_cache', connectionId, { provider: 'modelflare', baseUrl: 'https://modelflare.dev', api: 'anthropic-messages', checkedAt: new Date().toISOString(),
    models: [ { ...haiku, verified: false, reasoning: false, contextWindow: 8192 },
      { ...haiku, modelId: 'gpt-image-2' }, { ...haiku, modelId: 'jev-1.13' },
      { ...haiku, modelId: 'gpt-6.1-sol' }, { ...haiku, modelId: 'future-discovered-model' } ] });
  const cached = await service.modelChoices(connectionId);
  assert.equal(cached.find(item => item.modelId === haiku.modelId)?.contextWindow, 1_000_000);
  assert.equal(cached.some(item => ['gpt-image-2', 'jev-1.13', 'gpt-6.1-sol'].includes(item.modelId)), false);
  assert.equal(cached.some(item => item.modelId === 'future-discovered-model'), true);
  const settings = { ...emptyRunSettings, connectionId, modelId: haiku.modelId,
    modelOptions: [{ connectionId, modelId: haiku.modelId, reasoning: 'xhigh' as const, maxTokens: 10000 }] };
  const first = await service.resolveSettings(settings, 3);
  assert.equal(first.model.provider, 'modelflare');
  assert.equal(first.model.baseUrl, 'https://modelflare.dev');
  assert.equal(first.options.apiKey, 'gateway-private-key');
  assert.equal(first.options.reasoning, 'xhigh');
  const switched = await service.updateConnection(connectionId, connection.revision, { label: 'Gateway', provider: 'modelflare',
    baseUrl: 'https://modelflare.dev/v1', api: 'openai-responses' });
  const responses = await service.modelChoices(connectionId);
  assert.equal(responses.some(item => item.modelId === haiku.modelId), false);
  assert.equal(responses.find(item => item.modelId === 'gpt-6.1-sol')?.contextWindow, 1_050_000);
  assert.ok((await service.issuesFor([settings]))[0]!.some(issue => issue.includes('model')));
  const next = await service.resolveSettings({ ...emptyRunSettings, connectionId, modelId: 'gpt-6.1-sol' }, 4);
  assert.equal(next.model.api, 'openai-responses');
  assert.equal(next.options.reasoning, 'low', 'off is clamped for models that require reasoning');
  assert.equal(next.options.apiKey, 'gateway-private-key');
  assert.equal(first.model.api, 'anthropic-messages', 'existing run snapshots stay unchanged');
  await service.updateConnection(connectionId, switched.revision, { label: 'Gateway', provider: 'modelflare',
    baseUrl: 'https://modelflare.dev/v1', api: 'openai-completions' });
  const adapted = await service.resolveSettings(settings, 5);
  assert.equal(adapted.model.api, 'openai-completions');
  assert.equal((adapted.model.compat as { supportsStore?: boolean }).supportsStore, false);
  assert.equal((adapted.model.compat as { forceAdaptiveThinking?: boolean }).forceAdaptiveThinking, undefined);
  assert.equal(adapted.options.reasoning, 'xhigh');
  assert.equal(JSON.stringify(await service.listConnections()).includes('gateway-private-key'), false);
});


const memberDocument = (summary: string, commands: unknown[] = []) => `# Implementation context

## Result summary
${summary}

## File lookup
| Path | Description |
| --- | --- |
| never-load-this.txt | Lookup reference only |

## Automatic retrieval

\`\`\`json
${JSON.stringify({ commands })}
\`\`\`
`;

test('continuous member context survives failure, success and runtime restart without document reconstruction', { timeout: 45_000 }, async () => {
  const f = await groupFixture();
  let restarted: AgentRuntime | undefined;
  try {
    const root = (await f.team.harness.environment(f.backend.memberId)).root;
    await writeFile(join(root, '.rsi/context/implement/impl/README.md'), memberDocument('DOCUMENT IS NOT AUTOMATIC INPUT'));
    const first = await f.team.runner.postUser(f.workspaceId, '@Backend first attempt');
    const firstStep = await f.requests.next();
    assert.doesNotMatch(JSON.stringify(firstStep.request.context.messages), /DOCUMENT IS NOT AUTOMATIC INPUT/);
    answer(firstStep.events, fauxAssistantMessage([{ type: 'text', text: 'Useful private work', textSignature: JSON.stringify({v:1,id:'private',phase:'commentary'}) }]));
    const failing = await f.requests.next();
    failing.events.push({type:'error',reason:'error',error:{...message(),stopReason:'error',errorMessage:'provider failed'}});
    assert.equal((await f.runtime.finished(f.backend.memberId, first.runs[0]!.runId)).status,'failed');
    const history = await store.agents.runMessages(f.backend.memberId, first.runs[0]!.runId);
    const second = await f.team.runner.postUser(f.workspaceId, '@Backend continue');
    const continued = await f.requests.next();
    const contents = JSON.stringify(continued.request.context.messages);
    assert.ok(contents.indexOf('first attempt') < contents.indexOf('Useful private work'));
    assert.ok(contents.indexOf('Useful private work') < contents.indexOf('@Backend continue'));
    answer(continued.events,message('Accepted public result'));
    await f.runtime.finished(f.backend.memberId,second.runs[0]!.runId);
    const before = await store.agents.getContext(f.backend.memberId);
    assert.match(JSON.stringify(before.entries),/Useful private work/);
    assert.equal(JSON.stringify(before.entries).split('Accepted public result').length-1,1,'own accepted answer appears once');
    assert.match(JSON.stringify(before.entries),/sender: Backend/);
    await f.runtime.close();
    restarted = new AgentRuntime(store.agents, f.team.runConfig, f.team.policy(configuredPolicy()), request => {
      const events = new Queue<AssistantMessageEvent>(); f.requests.push({request,events}); return events;
    });
    f.team.attach(restarted); await restarted.open();
    const third = await f.team.runner.postUser(f.workspaceId,'@Backend after restart');
    const resumed = await f.requests.next();
    assert.match(JSON.stringify(resumed.request.context.messages),/Useful private work/);
    assert.equal(JSON.stringify(resumed.request.context.messages).split('Accepted public result').length-1,1);
    assert.doesNotMatch(JSON.stringify(resumed.request.context.messages),/DOCUMENT IS NOT AUTOMATIC INPUT/);
    answer(resumed.events,message('Restored continuously'));
    await restarted.finished(f.backend.memberId,third.runs[0]!.runId);
    assert.deepEqual(await store.agents.runMessages(f.backend.memberId,first.runs[0]!.runId),history,'stable private history unchanged');
  } finally { await restarted?.close(); await f.close(); }
});

test('idle synchronization failure is observable and recoverable without rejecting an accepted publication', {timeout:30_000}, async()=>{
  const f=await groupFixture();const patch=store.agents.patchContext.bind(store.agents);
  store.agents.patchContext=async(agentId,revision,entries)=>{
    if(agentId===f.frontend.memberId)throw new Error('injected idle context write failure');
    return patch(agentId,revision,entries);
  };
  try{
    const accepted=await f.team.runner.postUser(f.workspaceId,'@Backend continue');
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).position,1);
    await assert.rejects(f.runtime.getState(f.frontend.memberId),code('persistence_failure'));
    assert.deepEqual((await store.agents.getContext(f.frontend.memberId)).entries,[],'refused acknowledgement advances no consumption state');
    store.agents.patchContext=patch;
    await f.runtime.syncGroupContext(f.frontend.memberId);
    assert.equal((await f.runtime.getState(f.frontend.memberId)).run,null,'idle catch-up triggers no model');
    assert.equal((await store.agents.getContext(f.frontend.memberId)).entries.length,1);
    answer((await f.requests.next()).events,message('Recovered publication'));
    await f.runtime.finished(f.backend.memberId,accepted.runs[0]!.runId);
  }finally{store.agents.patchContext=patch;await f.close();}
});

test('shared input arriving after the terminal read is caught up when the member becomes idle', {timeout:30_000}, async()=>{
  let memberId = '', finalizing = false;
  const f=await groupFixture({...configuredPolicy(), afterRun: async run => { if (run.agentId === memberId) finalizing = true; }});
  memberId = f.backend.memberId;
  const original=store.team.readGroupContext.bind(store.team);
  let ready!:()=>void, resume!:()=>void;
  const terminalRead=new Promise<void>(resolve=>ready=resolve), release=new Promise<void>(resolve=>resume=resolve);
  let paused=false;
  store.team.readGroupContext=async(workspaceId,after)=>{
    const snapshot=await original(workspaceId,after);
    if(finalizing&&workspaceId===f.workspaceId&&after===1&&!paused){paused=true;ready();await release;}
    return snapshot;
  };
  try{
    const first=await f.team.runner.postUser(f.workspaceId,'@Backend initial');
    answer((await f.requests.next()).events,message('Backend final'));
    await terminalRead;
    const newer=await f.team.runner.postUser(f.workspaceId,'@Lead late shared input');
    resume();
    await f.runtime.finished(f.backend.memberId,first.runs[0]!.runId);
    assert.match(JSON.stringify((await store.agents.getContext(f.backend.memberId)).entries),/late shared input/);
    const lead=await f.requests.next();answer(lead.events,message('Lead received it'));
    await f.runtime.finished(f.lead.memberId,newer.runs[0]!.runId);
  }finally{resume();store.team.readGroupContext=original;await f.close();}
});

test('implementation documents and retrieval commands are ordinary files, never implicit activation effects', { timeout: 30_000 }, async () => {
  const f = await groupFixture();
  try {
    const root = (await f.team.harness.environment(f.backend.memberId)).root;
    const doc = join(root,'.rsi/context/implement/impl/README.md');
    await writeFile(doc,memberDocument('NOT AUTOMATICALLY LOADED',[{command:'unexpected command'}]));
    let calls = 0;
    f.team.harness.bash = async () => { calls++; throw new Error('must only execute requested tools'); };
    for (const input of ['@Backend first','@Backend second']) {
      const publication=await f.team.runner.postUser(f.workspaceId,input);
      const step=await f.requests.next();
      assert.doesNotMatch(JSON.stringify(step.request.context.messages),/NOT AUTOMATICALLY LOADED|unexpected command/);
      answer(step.events,message('Use ordinary tools when needed'));
      await f.runtime.finished(f.backend.memberId,publication.runs[0]!.runId);
      await writeFile(doc,'malformed documentation is not a runtime reconstruction input');
    }
    assert.equal(calls,0);
  } finally { await f.close(); }
});

test('restart restores interrupted working context, repairs missing results without replay, and reset clears consumption', { timeout: 30_000 }, async () => {
  const f=await groupFixture(); let recovery: AgentRuntime | undefined;
  try {
    await f.runtime.close();
    const admitted=await store.team.publishChat({workspaceId:f.workspaceId,author:{type:'user'},text:'@Backend interrupted',recipients:[f.backend.memberId]});
    const run=admitted.runs[0]!;
    const context=await store.agents.getContext(f.backend.memberId);
    const entries=await new AgentMessageContext(f.backend.memberId,context).incoming({id:f.workspaceId,read:after=>store.team.readGroupContext(f.workspaceId,after)});
    await store.agents.replaceContext(f.backend.memberId,context.revision,entries!);
    const id=randomUUID(); await store.agents.beginMessage(f.backend.memberId,run.runId,id,1);
    await store.agents.commitMessage(f.backend.memberId,run.runId,{messageId:id,message:fauxAssistantMessage([{type:'toolCall',id:'uncertain',name:'bash',arguments:{command:'may have effects'}}],{stopReason:'toolUse'}),metadata:{}});
    const original=await store.agents.runMessages(f.backend.memberId,run.runId);
    recovery=new AgentRuntime(store.agents,f.team.runConfig,f.team.policy(configuredPolicy()),request=>{const events=new Queue<AssistantMessageEvent>();f.requests.push({request,events});return events;});
    f.team.attach(recovery); await recovery.open();
    assert.equal((await recovery.getState(f.backend.memberId)).run?.status,'interrupted');
    const next=await f.team.runner.postUser(f.workspaceId,'@Backend next trigger');
    const step=await f.requests.next();
    assert.match(JSON.stringify(step.request.context.messages),/not replayed/);
    assert.equal(step.request.context.messages.filter(m=>m.role==='toolResult'&&m.toolCallId==='uncertain').length,1);
    assert.deepEqual(await store.agents.runMessages(f.backend.memberId,run.runId),original);
    answer(step.events,message('Inspected uncertain work'));
    await recovery.finished(f.backend.memberId,next.runs[0]!.runId);
    await f.team.runner.reset(f.workspaceId);
    assert.deepEqual((await store.agents.getContext(f.backend.memberId)).entries,[]);
    const [tables]=await store.pool.query<any[]>("SHOW TABLES LIKE 'member_context%'");
    assert.deepEqual(tables,[],'obsolete retention/admission tables are retired');
  } finally {await recovery?.close();await f.close();}
});

test('legacy adoption restores recorded work once without rewriting stable history or reexecuting commands', { timeout: 30_000 }, async () => {
  const f=await groupFixture();
  try {
    const accepted=await f.team.runner.postUser(f.workspaceId,'@Backend migration');
    answer((await f.requests.next()).events,message('Durable legacy result'));
    await f.runtime.finished(f.backend.memberId,accepted.runs[0]!.runId);
    const history=await store.agents.runMessages(f.backend.memberId,accepted.runs[0]!.runId);
    await f.runtime.close();
    await store.pool.execute('DELETE FROM agent_context_entries WHERE agent_id = ?',[f.backend.memberId]);
    await store.pool.execute('UPDATE agents SET context_length = 0 WHERE id = ?',[f.backend.memberId]);
    await store.pool.query('ALTER TABLE agents DROP COLUMN context_format');
    const reopened=new CoreData(new MySqlStorage(databaseUrl!));
    try {
      await reopened.migrate();
      const adopted=await reopened.agents.getContext(f.backend.memberId);
      assert.match(JSON.stringify(adopted.entries),/Durable legacy result/);
      assert.equal(JSON.stringify(adopted.entries).split('Durable legacy result').length-1,1);
      assert.match(JSON.stringify(adopted.entries),/sender: Backend/);
      assert.deepEqual(await reopened.agents.runMessages(f.backend.memberId,accepted.runs[0]!.runId),history);
      await reopened.pool.query('ALTER TABLE agents ALTER COLUMN context_format SET DEFAULT 0');
      await reopened.migrate();assert.deepEqual(await reopened.agents.getContext(f.backend.memberId),adopted,'migration is idempotent');
      const [columns]=await reopened.pool.query<any[]>("SHOW COLUMNS FROM agents LIKE 'context_format'");
      assert.equal(String(columns[0].Default),'1','recover a schema upgrade interrupted before default change');
    } finally {await reopened.close();}
  } finally {await f.close();}
});

test('shared pictures survive reopen, hydrate native model messages, and reset removes all image state', { timeout: 30_000 }, async () => {
  const { png } = await import('../image-fixture.js');
  const { prepareChatImage } = await import('../../src/core/team/data/chat-images.js');
  const f = await groupFixture();
  try {
    const image = await prepareChatImage(png(), 'screenshot.png');
    const first = await f.team.runner.postUser(f.workspaceId, '', [image]);
    const step = await f.requests.next();
    const imageMessages = step.request.context.messages.filter(m => Array.isArray(m.content) && m.content.some(part => part.type === 'image'));
    assert.equal(imageMessages.length, 1);
    const content = imageMessages[0]!.content;
    assert.ok(Array.isArray(content));
    const picture = content.find(part => part.type === 'image'); assert.ok(picture?.type === 'image');
    assert.deepEqual(Buffer.from(picture.data, 'base64'), image.bytes);
    assert.deepEqual(first.entries[0]!.kind === 'user' && first.entries[0]!.attachments, [image.metadata]);
    await assert.rejects(f.team.runner.postUser(f.workspaceId, 'busy', [await prepareChatImage(png(), 'refused.png')]), /working/);
    const [count] = await store.pool.execute<any[]>('SELECT COUNT(*) AS n FROM chat_images WHERE workspace_id = ?', [f.workspaceId]); assert.equal(count[0].n, 1);
    answer(step.events, message('Image understood'));
    await f.runtime.finished(f.lead.memberId, first.runs[0]!.runId);
    const reopened = new CoreData(new MySqlStorage(databaseUrl!));
    try {
      const snapshot = await reopened.team.chatSnapshot(f.workspaceId);
      assert.deepEqual(snapshot.messages[0]!.attachments, [image.metadata]);
      assert.equal(JSON.stringify(snapshot).includes(picture.data), false);
      assert.deepEqual((await reopened.team.chatImage(f.workspaceId, image.metadata.id)).bytes, image.bytes);
      await assert.rejects(reopened.team.chatImage('other', image.metadata.id), /not found/);
    } finally { await reopened.close(); }
    const next = await f.team.runner.postUser(f.workspaceId, '@Backend inspect prior image');
    const other = await f.requests.next();
    assert.ok(other.request.context.messages.some(m => Array.isArray(m.content) && m.content.some(part => part.type === 'image' && part.data === picture.data)));
    const completion=f.runtime.finished(f.backend.memberId,next.runs[0]!.runId);assert.equal(completion,f.runtime.finished(f.backend.memberId,next.runs[0]!.runId));
    answer(other.events, message('Same picture received')); await completion;
    await f.team.runner.reset(f.workspaceId);
    await assert.rejects(store.team.chatImage(f.workspaceId, image.metadata.id), /not found/);
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).messages.length, 0);
  } finally { await f.close(); }
});

test('constructed image context fails explicitly when a later model request cannot accept pictures', { timeout: 30_000 }, async () => {
  const base = configuredPolicy();
  const f = await groupFixture({ ...base, buildRequest: async (scope, history) => {
    const request = await base.buildRequest(scope, history);
    return { ...request, model: { ...request.model, input: ['text'] } };
  } });
  try {
    const { prepareChatImage } = await import('../../src/core/team/data/chat-images.js');
    const { png } = await import('../image-fixture.js');
    const accepted = await f.team.runner.postUser(f.workspaceId, '', [await prepareChatImage(png(), 'picture.png')]);
    const state = await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId);
    assert.equal(state.status, 'failed'); assert.equal(state.error?.code, 'image_not_supported');
    assert.match(state.error!.message, /model with image input/);
  } finally { await f.close(); }
});

const compactSettings:CompactionSettings={thresholdTokens:100000,prompt:harnessPrompt('context-compaction')};
function largeUsage(text:string) {
  const result=message(text);
  result.usage={...result.usage,input:200000,output:0,cacheRead:0,cacheWrite:0,totalTokens:200000};
  return result;
}

test('finishing compaction persists a private trace and atomically replaces context without changing the published response', {timeout:30000}, async()=>{
  const f=await groupFixture(configuredPolicy(),{compaction:compactSettings});
  try {
    const accepted=await f.team.runner.postUser(f.workspaceId,'@Backend preserve the shared objective');
    const run=accepted.runs[0]!;
    answer((await f.requests.next()).events,largeUsage('Original accepted answer'));
    const preparation=await f.requests.next();
    assert.match(JSON.stringify(preparation.request.context.messages),/replacement boundary|Checkpoint: after-run/);
    const old=await store.agents.getContext(f.backend.memberId);
    assert.match(JSON.stringify(old.entries),/Original accepted answer/);
    assert.doesNotMatch(JSON.stringify(old.entries),/Checkpoint: after-run/,'tentative trace is not current context');
    const published=await store.team.chatTimeline(f.workspaceId);
    const entry=published.changes.at(-1)!.entry;
    assert.ok(entry.kind==='member'&&entry.finalRef);
    assert.equal(entry.kind==='member'&&entry.text,'Original accepted answer');
    answer(preparation.events,largeUsage('Preserved private continuation. No work remains.'));
    const terminal=await f.runtime.finished(f.backend.memberId,run.runId);
    assert.equal(terminal.status,'completed');assert.equal(terminal.step,1);
    assert.deepEqual(await store.team.chatTimeline(f.workspaceId),published,'no new publication or revision');
    assert.equal(await f.runtime.finalText(f.backend.memberId,run.runId),'Original accepted answer');
    const history=await store.agents.runMessages(f.backend.memberId,run.runId);
    assert.equal(history.filter(record=>record.metadata.source==='context-compaction').length,2);
    assert.equal(history.at(-1)!.message.role==='assistant'&&history.at(-1)!.position>terminal.endPosition!,true,'public range remains pinned before maintenance');
    const current=await store.agents.getContext(f.backend.memberId);
    assert.match(JSON.stringify(current.entries),/Preserved private continuation/);
    assert.match(JSON.stringify(current.entries),/sender: Backend|shared objective/,'original group messages remain');
    assert.doesNotMatch(JSON.stringify(current.entries),/Checkpoint: after-run/);
    const continuation=current.entries.find(record=>record.metadata.contextUsageInvalidated)!.message;
    assert.equal(continuation.role==='assistant'&&continuation.usage.totalTokens,0);
    const [journals]=await store.pool.query<any[]>('SELECT state, active_agent_id FROM context_compactions WHERE run_id = ?',[run.runId]);
    assert.equal(journals.length,1);assert.equal(journals[0].active_agent_id,null);
    assert.equal(decode<CompactionState>(journals[0].state,validateCompactionState).status,'completed');
    const next=await f.team.runner.postUser(f.workspaceId,'@Backend next ordinary request');
    const step=await f.requests.next();
    assert.doesNotMatch(JSON.stringify(step.request.context.messages),/Checkpoint: before-model/,'invalidated usage does not immediately compact again');
    answer(step.events,message('Second ordinary answer'));
    await f.runtime.finished(f.backend.memberId,next.runs[0]!.runId);
    await f.team.runner.reset(f.workspaceId);
    const [cleared]=await store.pool.query<any[]>('SELECT id FROM context_compactions WHERE agent_id = ?',[f.backend.memberId]);
    assert.deepEqual(cleared,[]);
  }finally{await f.close();}
});

test('before-call compaction waits for acknowledged cutover then continues the same activation', {timeout:30000}, async()=>{
  const f=await groupFixture(configuredPolicy(),{compaction:compactSettings});
  try {
    const before=await store.agents.getContext(f.backend.memberId);
    await store.agents.replaceContext(f.backend.memberId,before.revision,[compactionInput('OLD PRIVATE '.repeat(50000))]);
    const accepted=await f.team.runner.postUser(f.workspaceId,'@Backend continue existing work');
    const preparation=await f.requests.next();
    assert.match(JSON.stringify(preparation.request.context.messages),/Checkpoint: before-model/);
    assert.match(JSON.stringify((await store.agents.getContext(f.backend.memberId)).entries),/OLD PRIVATE/);
    answer(preparation.events,largeUsage('Useful continuation.\n## Next steps\nFinish the existing objective.'));
    const ordinary=await f.requests.next();
    assert.doesNotMatch(JSON.stringify(ordinary.request.context.messages),/OLD PRIVATE|Checkpoint: before-model/);
    assert.match(JSON.stringify(ordinary.request.context.messages),/Useful continuation|continue existing work/);
    answer(ordinary.events,message('Completed after compaction'));
    const finished=await f.runtime.finished(f.backend.memberId,accepted.runs[0]!.runId);
    assert.equal(finished.status,'completed');assert.equal(finished.step,1);
    const chat=await store.team.chatSnapshot(f.workspaceId);
    assert.deepEqual(chat.messages.map(m=>m.text),['@Backend continue existing work','Completed after compaction']);
  }finally{await f.close();}
});

test('workspace stop aborts finishing preparation while retaining the already accepted answer and uncertainty', {timeout:30000}, async()=>{
  const f=await groupFixture(configuredPolicy(),{compaction:compactSettings});
  try {
    const accepted=await f.team.runner.postUser(f.workspaceId,'@Backend answer then maintain context');
    answer((await f.requests.next()).events,largeUsage('Keep this public answer'));
    await f.requests.next();
    await f.team.runner.stop(f.workspaceId);
    const terminal=await f.runtime.finished(f.backend.memberId,accepted.runs[0]!.runId);
    assert.equal(terminal.status,'completed','accepted ordinary publication keeps its outcome');
    assert.match(JSON.stringify((await store.agents.getContext(f.backend.memberId)).entries),/No old context was discarded/);
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).messages.at(-1)!.text,'Keep this public answer');
    const [journals]=await store.pool.query<any[]>('SELECT state FROM context_compactions WHERE run_id = ?',[terminal.runId]);
    assert.equal(decode<CompactionState>(journals[0].state,validateCompactionState).status,'failed');
    assert.equal(decode<CompactionState>(journals[0].state,validateCompactionState).error!.code,'cancelled');
  }finally{await f.close();}
});

test('restart recovers interrupted preparation even after ordinary completion without replaying tools; cutover failure rolls back', {timeout:30000}, async()=>{
  const f=await groupFixture();let recovery:AgentRuntime|undefined;
  const trigger='compaction_failure_'+randomUUID().replaceAll('-','');let installed=false;
  try {
    const accepted=await f.team.runner.postUser(f.workspaceId,'@Backend retain accepted work');
    answer((await f.requests.next()).events,message('Stable accepted result'));
    const terminal=await f.runtime.finished(f.backend.memberId,accepted.runs[0]!.runId);
    const original=await store.agents.getContext(f.backend.memberId);
    const state:CompactionState={id:randomUUID(),agentId:f.backend.memberId,runId:terminal.runId,trigger:'after-run',status:'preparing',startedAt:Date.now(),endedAt:null,error:null};
    await store.agents.beginCompaction(state);
    for(const entry of [compactionInput('Recovery boundary'),{messageId:randomUUID(),message:fauxAssistantMessage([{type:'toolCall',id:'uncertain-prep',name:'bash',arguments:{command:'may have effects'}}],{stopReason:'toolUse'}),metadata:{}}]) {
      await store.agents.commitCompactionMessage({...entry,agentId:state.agentId,runId:state.runId,position:0,metadata:{...entry.metadata,source:'context-compaction',compactionId:state.id}});
    }
    await store.pool.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON context_compactions FOR EACH ROW BEGIN IF OLD.id = '${state.id}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected compaction cutover failure'; END IF; END`);installed=true;
    await assert.rejects(store.agents.finishCompaction({...state,status:'completed',endedAt:Date.now()},original.revision,[]),/Injected compaction cutover failure/);
    assert.deepEqual(await store.agents.getContext(state.agentId),original,'context replacement rolls back with journal write');
    await store.pool.query(`DROP TRIGGER ${trigger}`);installed=false;
    const immutable=await store.agents.runMessages(state.agentId,state.runId);
    await f.runtime.close();
    recovery=new AgentRuntime(store.agents,f.team.runConfig,f.team.policy(configuredPolicy()),request=>{const events=new Queue<AssistantMessageEvent>();f.requests.push({request,events});return events;},{compaction:compactSettings});
    f.team.attach(recovery);await recovery.open();
    const context=JSON.stringify((await store.agents.getContext(state.agentId)).entries);
    assert.match(context,/Stable accepted result/);assert.match(context,/uncertain-prep/);assert.match(context,/not replayed/);
    assert.equal((await recovery.getState(state.agentId)).run!.status,'completed');
    assert.deepEqual(await store.agents.runMessages(state.agentId,state.runId),immutable,'recovery never rewrites stable history');
    const [journals]=await store.pool.query<any[]>('SELECT state,active_agent_id FROM context_compactions WHERE id = ?',[state.id]);
    assert.equal(journals[0].active_agent_id,null);assert.equal(decode<CompactionState>(journals[0].state,validateCompactionState).error!.code,'runtime_restarted');
    const next=await f.team.runner.postUser(f.workspaceId,'@Backend inspect after restart');
    const request=await f.requests.next();
    assert.match(JSON.stringify(request.request.context.messages),/uncertain-prep/);
    answer(request.events,message('Resumed from recorded evidence'));
    await recovery.finished(state.agentId,next.runs[0]!.runId);
  }finally{if(installed)await store.pool.query(`DROP TRIGGER ${trigger}`);await recovery?.close();await f.close();}
});

test('published answers do not hide preparation persistence failure and restart recovers the journal', {timeout:30000}, async()=>{
  const f=await groupFixture(configuredPolicy(),{compaction:compactSettings});let recovery:AgentRuntime|undefined;
  const finish=store.agents.finishCompaction.bind(store.agents);
  try{
    const accepted=await f.team.runner.postUser(f.workspaceId,'@Backend preserve acknowledgement errors');
    answer((await f.requests.next()).events,largeUsage('Keep this accepted response'));
    const prep=await f.requests.next();
    store.agents.finishCompaction=async()=>{throw new Error('injected missing acknowledgement');};
    answer(prep.events,message('Prepared continuation'));
    await assert.rejects(f.runtime.finished(f.backend.memberId,accepted.runs[0]!.runId),code('persistence_failure'));
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).messages.at(-1)!.text,'Keep this accepted response');
    assert.match(JSON.stringify((await store.agents.getContext(f.backend.memberId)).entries),/Keep this accepted response/);
    const [pending]=await store.pool.query<any[]>('SELECT id FROM context_compactions WHERE active_agent_id = ?',[f.backend.memberId]);
    assert.equal(pending.length,1,'uncertain cutover remains recoverable');
    store.agents.finishCompaction=finish;
    await f.runtime.close();
    recovery=new AgentRuntime(store.agents,f.team.runConfig,f.team.policy(configuredPolicy()),()=>{throw new Error('recovery must not call a model');});
    f.team.attach(recovery);await recovery.open();
    const restored=JSON.stringify((await store.agents.getContext(f.backend.memberId)).entries);
    assert.match(restored,/Keep this accepted response/);assert.match(restored,/Prepared continuation/);assert.match(restored,/No old context was discarded/);
    assert.equal((await recovery.getState(f.backend.memberId)).run!.status,'completed');
  }finally{store.agents.finishCompaction=finish;await recovery?.close();await f.close();}
});

test('Agent owns durable execution/context independently of Team or Workspace schemas', {timeout:30000}, async()=>{
  const url=new URL(databaseUrl!),database='agent_owned_'+randomUUID().replaceAll('-','');url.pathname='/'+database;
  await store.pool.query(`CREATE DATABASE ${database}`);
  const storage=new MySqlStorage(url.toString());
  const {AgentData}=await import('../../src/core/agent/data/repository.js');
  const data=new AgentData(storage);
  const requests=new Queue<{request:ModelRequest;events:Queue<AssistantMessageEvent>}>();
  const runtime=new AgentRuntime(data,staticConfig,configuredPolicy(),request=>{const events=new Queue<AssistantMessageEvent>();requests.push({request,events});return events;});
  let reopened:import('../../src/storage/mysql.js').MySqlStorage|undefined;
  try{
    await data.migrate();await runtime.open();
    const {agentId}=await data.createAgent();const run=await runtime.start(agentId,'Agent-owned input');
    answer((await requests.next()).events,message('Agent-owned answer'));
    assert.equal((await runtime.finished(agentId,run.runId)).status,'completed');
    const history=await data.runMessages(agentId,run.runId),context=await data.getContext(agentId);
    assert.deepEqual(Object.keys(await data.executionState(agentId)).sort(),['activeRunId','historyPosition','id']);
    const [tables]=await storage.pool.query<any[]>('SHOW TABLES');
    assert.deepEqual(tables.map(row=>Object.values(row)[0]).sort(),['agent_context_entries','agents','context_compactions','messages','runs']);
    const rolledBack=randomUUID();
    await assert.rejects(storage.transaction(async db=>{
      const session=data.inTransaction(db);await session.createRecord(rolledBack);await session.admitRun(rolledBack);throw new Error('rollback owner operations');
    }),/rollback owner operations/);
    await assert.rejects(data.getState(rolledBack),code('not_found'));
    await runtime.close();await storage.close();
    reopened=new MySqlStorage(url.toString());const restored=new AgentData(reopened);await restored.migrate();
    assert.deepEqual(await restored.getContext(agentId),context);assert.deepEqual(await restored.runMessages(agentId,run.runId),history);
  }finally{await runtime.close();await storage.close();await reopened?.close();await store.pool.query(`DROP DATABASE ${database}`);}
});

test('resident Agent context survives runs with one SQL load and append-only context writes', {timeout: 30000}, async () => {
  const f = await fixture();
  const originalTransaction = store.storage.transaction;
  const statements: string[] = [];
  store.storage.transaction = function (operation) {
    return originalTransaction.call(this, async db => {
      const execute = db.execute, query = db.query;
      db.execute = function (this: typeof db, sql: any, ...args: any[]) { statements.push(typeof sql === 'string' ? sql : sql.sql); return (execute as any).call(this, sql, ...args); } as typeof execute;
      db.query = function (this: typeof db, sql: any, ...args: any[]) { statements.push(typeof sql === 'string' ? sql : sql.sql); return (query as any).call(this, sql, ...args); } as typeof query;
      try { return await operation(db); }
      finally { db.execute = execute; db.query = query; }
    }) as any;
  };
  try {
    const first = await f.runtime.start(f.agentId, 'First input');
    const signed = fauxAssistantMessage([{type: 'thinking', thinking: '', thinkingSignature: 'opaque-encrypted-content'}, {type: 'text', text: 'First answer'}]);
    answer((await f.requests.next()).events, signed);
    await f.runtime.finished(f.agentId, first.runId);
    const resident = await store.agents.residentContext(f.agentId);
    const second = await f.runtime.start(f.agentId, 'Second input');
    const request = await f.requests.next();
    assert.ok(request.request.context.messages.some(item => item.role === 'assistant' && item.content.some(block => block.type === 'thinking' && block.thinkingSignature === 'opaque-encrypted-content')));
    answer(request.events, message('Second answer'));
    await f.runtime.finished(f.agentId, second.runId);
    assert.equal(await store.agents.residentContext(f.agentId), resident, 'same owned context model across runs');
    assert.equal(resident.history.entries.length, 4, 'durable acknowledgement does not duplicate in-memory messages');
    assert.equal(statements.filter(sql => /SELECT position,id,entry FROM agent_context_entries/.test(sql)).length, 1);
    assert.equal(statements.filter(sql => /INSERT INTO agent_context_entries/.test(sql)).length, 4);
    assert.ok(!statements.some(sql => /(?:DELETE FROM|UPDATE) agent_context_entries/.test(sql)), 'normal appends do not rewrite existing rows');
    assert.ok(!statements.some(sql => /SELECT \* FROM agents|SET context\s*=/.test(sql)), 'coordination reads only bookkeeping');
    assert.deepEqual(await store.agents.getContext(f.agentId), resident.history);
  } finally {store.storage.transaction = originalTransaction; await f.runtime.close();}
});

test('resident context acknowledges outer commit, ignores rollback, and resets the same model', {timeout: 15000}, async () => {
  const {agentId} = await store.agents.createAgent();
  const resident = await store.agents.residentContext(agentId);
  const entry = {messageId: 'transactional', message: user, metadata: {}};
  await assert.rejects(store.storage.transaction(async db => {
    await store.agents.inTransaction(db).patchContext(agentId, 0, {append: [entry], update: []});
    assert.deepEqual(resident.history.entries, [], 'no speculative memory publication');
    throw new Error('rollback context rows');
  }), /rollback context rows/);
  assert.deepEqual(resident.history, {revision: 0, entries: []});
  assert.deepEqual(await store.agents.getContext(agentId), resident.history);
  await store.storage.transaction(async db => {
    await store.agents.inTransaction(db).patchContext(agentId, 0, {append: [entry], update: []});
    assert.equal(resident.history.revision, 0);
  });
  assert.deepEqual(resident.history, {revision: 1, entries: [entry]});
  await assert.rejects(store.storage.transaction(async db => {
    await store.agents.inTransaction(db).resetConversations([agentId]);
    assert.equal(resident.history.entries.length, 1);
    throw new Error('rollback reset');
  }), /rollback reset/);
  assert.equal(resident.history.entries.length, 1);
  await store.storage.transaction(async db => {await store.agents.inTransaction(db).resetConversations([agentId]);});
  assert.equal(await store.agents.residentContext(agentId), resident);
  assert.deepEqual(resident.history, {revision: 2, entries: []});
  await assert.rejects(store.agents.patchContext(agentId, 1, {append: [entry], update: []}), code('context_conflict'));
});

test('whole-JSON context migration preserves order, opaque fields, revisions and resumes after interruption', {timeout: 30000}, async () => {
  const database = 'context_migration_' + randomUUID().replaceAll('-', '');
  await store.pool.query(`CREATE DATABASE ${database}`);
  const url = new URL(databaseUrl!); url.pathname = '/' + database;
  const storage = new MySqlStorage(url.toString());
  const {AgentData} = await import('../../src/core/agent/data/repository.js');
  const data = new AgentData(storage);
  const entries = [{messageId: 'signed', message: fauxAssistantMessage([
    {type: 'thinking' as const, thinking: '', thinkingSignature: 'opaque-signature'},
    {type: 'thinking' as const, thinking: '[Reasoning redacted]', thinkingSignature: 'opaque-redacted', redacted: true},
    {type: 'text' as const, text: 'Preserved answer'},
  ]), metadata: {groupContextId: 'group', groupPosition: 7}}, {messageId: 'user', message: user, metadata: {}}];
  try {
    await storage.pool.query(`CREATE TABLE agents (
      id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, context JSON NOT NULL,
      context_format TINYINT UNSIGNED NOT NULL DEFAULT 1, context_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
      history_position BIGINT UNSIGNED NOT NULL DEFAULT 0,
      active_run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL, latest_run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
    ) ENGINE=InnoDB`);
    await storage.pool.execute('INSERT INTO agents (id,context,context_revision) VALUES (?, ?, ?), (?, ?, ?)', ['a', encode(entries), 9, 'b', '{"version":999,"data":[]}', 0]);
    await assert.rejects(data.migrate(), /schema version/);
    const [columns] = await storage.pool.query<any[]>("SHOW COLUMNS FROM agents LIKE 'context'");
    assert.equal(columns.length, 1, 'old data remains until every agent is migrated');
    await storage.pool.execute('UPDATE agents SET context = ? WHERE id = ?', [encode([]), 'b']);
    await data.migrate();
    const expected = {revision: 9, entries};
    assert.deepEqual(await data.getContext('a'), expected);
    await data.migrate(); assert.deepEqual(await data.getContext('a'), expected);
    const [retired] = await storage.pool.query<any[]>("SHOW COLUMNS FROM agents LIKE 'context'");
    assert.deepEqual(retired, []);
    const [rows] = await storage.pool.query<any[]>('SELECT position,id FROM agent_context_entries WHERE agent_id = ? ORDER BY position', ['a']);
    assert.deepEqual(rows.map(row => [row.position, row.id]), [[1, 'signed'], [2, 'user']]);
    assert.equal((await data.residentContext('a')).history.entries.length, 2);
  } finally {await storage.close(); await store.pool.query(`DROP DATABASE ${database}`);}
});

test('targeted context edits leave other rows and immutable history unchanged', {timeout: 15000}, async () => {
  const {agentId} = await store.agents.createAgent();
  const run = await store.agents.startRun(agentId, user);
  await store.agents.finishRun(agentId, run.runId, 'completed');
  const before = await store.agents.getContext(agentId);
  const resident = await store.agents.residentContext(agentId);
  const history = await store.agents.runMessages(agentId, run.runId);
  const edited = {...before.entries[0]!, metadata: {groupPosition: 1, groupContextId: 'workspace'}};
  const appended = {messageId: 'incoming', message: user, metadata: {groupPosition: 2, groupContextId: 'workspace'}};
  await store.agents.patchContext(agentId, before.revision, {update: [edited], append: [appended]});
  assert.deepEqual(resident.history.entries, [edited, appended]);
  const [originalRows] = await store.pool.query<any[]>('SELECT position,id,entry FROM agent_context_entries WHERE agent_id = ? ORDER BY position', [agentId]);
  await store.agents.patchContext(agentId, resident.history.revision, {update: [{...appended, metadata: {changed: true}}], append: []});
  const [rows] = await store.pool.query<any[]>('SELECT position,id,entry FROM agent_context_entries WHERE agent_id = ? ORDER BY position', [agentId]);
  assert.deepEqual(rows[0], originalRows[0], 'unaffected row is unchanged');
  assert.equal(rows[1].id, originalRows[1].id); assert.equal(rows[1].position, originalRows[1].position);
  assert.deepEqual(await store.agents.runMessages(agentId, run.runId), history);
  assert.deepEqual(await store.agents.getContext(agentId), resident.history);
  const current = structuredClone(resident.history);
  await assert.rejects(store.agents.patchContext(agentId, current.revision, {update: [{...appended, messageId: 'missing'}], append: []}), code('context_conflict'));
  assert.deepEqual(resident.history, current);
  assert.deepEqual(await store.agents.getContext(agentId), current);
});

test('uncertain SQL commit invalidates resident context before another run can reuse it', {timeout: 15000}, async () => {
  const {agentId} = await store.agents.createAgent();
  const stale = await store.agents.residentContext(agentId);
  const transaction = store.storage.transaction;
  let connection: import('mysql2/promise').PoolConnection | undefined;
  let commit: import('mysql2/promise').PoolConnection['commit'] | undefined;
  store.storage.transaction = function (operation) {
    return transaction.call(this, async db => {
      connection = db; commit = db.commit;
      db.commit = async () => {await commit!.call(db); throw new Error('commit acknowledgement lost');};
      return operation(db);
    }) as any;
  };
  const entry = {messageId: 'committed-without-ack', message: user, metadata: {}};
  try {
    await assert.rejects(store.agents.patchContext(agentId, 0, {append: [entry], update: []}), /acknowledgement lost/);
  } finally {
    if (connection && commit) connection.commit = commit;
    store.storage.transaction = transaction;
  }
  assert.throws(() => stale.history, /out of sequence/);
  const restored = await store.agents.residentContext(agentId);
  assert.notEqual(restored, stale);
  assert.deepEqual(restored.history, {revision: 1, entries: [entry]}, 'restore actual durable outcome without replaying the write');
});

test('Team reuses one Pi group-context load across publications, members and runs', {timeout: 30000}, async () => {
  const f = await groupFixture();
  const data = store.team as any, load = data.loadGroupContext;
  let loads = 0;
  const triggers = ['UPDATE', 'DELETE'].map(operation => ({operation, name: 'group_append_' + randomUUID().replaceAll('-', '')}));
  data.loadGroupContext = async function (id: string) {if (id === f.workspaceId) loads++; return load.call(this, id);};
  try {
    assert.deepEqual(await store.team.readGroupContext(f.workspaceId, 0), []);
    for (const {operation,name} of triggers) await store.pool.query(`CREATE TRIGGER ${name} BEFORE ${operation} ON chat_context_entries FOR EACH ROW BEGIN IF OLD.workspace_id = '${f.workspaceId}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Existing group rows must not be rewritten'; END IF; END`);
    for (let index = 1; index <= 2; index++) {
      const accepted = await f.team.runner.postUser(f.workspaceId, `@Lead shared ${index}`);
      const request = await f.requests.next();
      answer(request.events, fauxAssistantMessage([{type: 'thinking', thinking: '', thinkingSignature: 'private-encrypted-thinking'}, {type: 'text', text: `Public result ${index}`} ]));
      await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId);
    }
    const shared = await store.team.readGroupContext(f.workspaceId, 0);
    assert.equal(loads, 1); assert.equal(shared.length, 4);
    assert.deepEqual(shared.map(item => item.entry.message.role), ['user', 'user', 'user', 'user']);
    assert.match(JSON.stringify(shared), /sender: Lead/); assert.match(JSON.stringify(shared), /sender: user/);
    assert.doesNotMatch(JSON.stringify(shared), /private-encrypted-thinking/);
    assert.ok(shared[1]!.origin); assert.equal(shared[1]!.entry.metadata.finalRef !== undefined, true);
    const copy = structuredClone(shared); shared[0]!.entry.message.content = 'forged';
    assert.deepEqual(await store.team.readGroupContext(f.workspaceId, 0), copy);
    const [rows] = await store.pool.query<any[]>('SELECT position,entry FROM chat_context_entries WHERE workspace_id = ? ORDER BY position', [f.workspaceId]);
    assert.equal(rows.length, 4);
    for (const row of rows) assert.equal(decode<any>(row.entry, () => undefined).metadata.groupPosition, row.position);
    const [history] = await store.pool.query<any[]>('SELECT entry FROM chat_messages WHERE workspace_id = ? ORDER BY position', [f.workspaceId]);
    const published = decode<any>(history[1].entry, () => undefined);
    assert.equal(published.text, undefined); assert.ok(published.finalRef, 'frontend history still uses exact final references');
    const reopened = new CoreData(new MySqlStorage(databaseUrl!));
    try {await reopened.migrate(); assert.deepEqual(await reopened.team.readGroupContext(f.workspaceId, 0), copy);} finally {await reopened.close();}
  } finally {for (const {name} of triggers) await store.pool.query(`DROP TRIGGER IF EXISTS ${name}`); data.loadGroupContext = load; await f.close();}
});

test('Team group context acknowledges only outer commit and resets without stale resident data', {timeout: 30000}, async () => {
  const f = await groupFixture();
  const input = {workspaceId: f.workspaceId, author: {type: 'user' as const}, text: 'Shared committed input', recipients: []};
  try {
    assert.deepEqual(await store.team.readGroupContext(f.workspaceId, 0), []);
    await assert.rejects(store.storage.transaction(async db => {
      await store.team.inTransaction(db).publishChat(input);
      assert.deepEqual(await store.team.readGroupContext(f.workspaceId, 0), []);
      throw new Error('rollback shared publication');
    }), /rollback shared publication/);
    assert.deepEqual(await store.team.readGroupContext(f.workspaceId, 0), []);
    await store.storage.transaction(async db => {
      await store.team.inTransaction(db).publishChat(input);
      assert.deepEqual(await store.team.readGroupContext(f.workspaceId, 0), []);
    });
    const shared = await store.team.readGroupContext(f.workspaceId, 0); assert.equal(shared.length, 1);
    await assert.rejects(store.storage.transaction(async db => {
      await db.execute('DELETE FROM chat_context_entries WHERE workspace_id = ?', [f.workspaceId]);
      await store.team.inTransaction(db).readGroupContext(f.workspaceId, 0);
    }), /row length/, 'missing rows fail instead of silently shortening group context');
    await assert.rejects(store.storage.transaction(async db => {
      await store.team.inTransaction(db).resetChat(f.workspaceId);
      assert.deepEqual(await store.team.readGroupContext(f.workspaceId, 0), shared);
      throw new Error('rollback shared reset');
    }), /rollback shared reset/);
    assert.deepEqual(await store.team.readGroupContext(f.workspaceId, 0), shared);
    await store.team.resetChat(f.workspaceId);
    assert.deepEqual(await store.team.readGroupContext(f.workspaceId, 0), []);
    const fresh = await store.team.publishChat({...input, text: 'Fresh shared input'});
    assert.deepEqual((await store.team.readGroupContext(f.workspaceId, 0)).map(item => item.entry.messageId), [fresh.message.messageId]);
  } finally {await f.close();}
});

test('group-context migration backfills Pi messages, images and origin metadata atomically', {timeout: 30000}, async () => {
  const f = await groupFixture();
  const {png} = await import('../image-fixture.js');
  const {prepareChatImage} = await import('../../src/core/team/data/chat-images.js');
  const trigger = 'group_migration_' + randomUUID().replaceAll('-', '');
  const reopened = new CoreData(new MySqlStorage(databaseUrl!));
  let installed = false;
  try {
    const accepted = await f.team.runner.postUser(f.workspaceId, '@Lead inspect picture', [await prepareChatImage(png(), 'picture.png')]);
    answer((await f.requests.next()).events, message('Published picture result'));
    await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId);
    const expected = await store.team.readGroupContext(f.workspaceId, 0);
    const timeline = await store.team.chatTimeline(f.workspaceId);
    await f.runtime.close();
    await store.pool.execute('DELETE FROM chat_context_entries WHERE workspace_id = ?', [f.workspaceId]);
    await store.pool.execute('UPDATE chat_settings SET context_format = 0 WHERE workspace_id = ?', [f.workspaceId]);
    await store.pool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON chat_context_entries FOR EACH ROW BEGIN IF NEW.workspace_id = '${f.workspaceId}' AND NEW.position = 2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected group migration failure'; END IF; END`);
    installed = true;
    await assert.rejects(reopened.migrate(), /Injected group migration failure/);
    const [failed] = await store.pool.query<any[]>('SELECT context_format FROM chat_settings WHERE workspace_id = ?', [f.workspaceId]);
    assert.equal(failed[0].context_format, 0);
    const [rows] = await store.pool.query<any[]>('SELECT position FROM chat_context_entries WHERE workspace_id = ?', [f.workspaceId]);
    assert.deepEqual(rows, []);
    await store.pool.query(`DROP TRIGGER ${trigger}`); installed = false;
    await reopened.migrate();
    assert.deepEqual(await reopened.team.readGroupContext(f.workspaceId, 0), expected);
    assert.deepEqual(await reopened.team.chatTimeline(f.workspaceId), timeline);
    await reopened.migrate(); assert.deepEqual(await reopened.team.readGroupContext(f.workspaceId, 0), expected);
  } finally {if (installed) await store.pool.query(`DROP TRIGGER ${trigger}`); await reopened.close(); await f.close();}
});

test('uncertain group publication commit restores durable Pi context without replay', {timeout: 30000}, async () => {
  const f = await groupFixture();
  const transaction = store.storage.transaction;
  let connection: import('mysql2/promise').PoolConnection | undefined;
  let commit: import('mysql2/promise').PoolConnection['commit'] | undefined;
  try {
    try {
      assert.deepEqual(await store.team.readGroupContext(f.workspaceId, 0), []);
      store.storage.transaction = function (operation) {
        return transaction.call(this, async db => {
          connection = db; commit = db.commit;
          db.commit = async () => {await commit!.call(db); throw new Error('group commit acknowledgement lost');};
          return operation(db);
        }) as any;
      };
      await assert.rejects(store.team.publishChat({workspaceId: f.workspaceId, author: {type: 'user'}, text: 'Committed once', recipients: []}), /group commit acknowledgement lost/);
    } finally {
      if (connection && commit) connection.commit = commit;
      store.storage.transaction = transaction;
    }
    const restored = await store.team.readGroupContext(f.workspaceId, 0);
    assert.equal(restored.length, 1); assert.match(String(restored[0]!.entry.message.content), /Committed once/);
    assert.equal((await store.team.chatSnapshot(f.workspaceId)).messages.length, 1);
  } finally {await f.close();}
});


test('adoption imports preserved context and fresh lead atomically after reviewed metadata cleanup', async () => {
  const directory=await realpath(await mkdtemp(join(tmpdir(),'rsi-adopt-test-')));
  const root=join(directory,'.rsi');
  const original={
    'design/metadata.json': '{"implementation":["src"]}\n',
    'design/design.md': '# Preserved root\r\n',
    'design/api/metadata.json': '{"implementation":["src/api"]}\n',
    'design/api/design.md': '# API contract\n',
    'implement/impl/README.md': '# Existing result context\n',
  };
  try {
    for(const [path,content]of Object.entries(original)){
      await mkdir(join(root,'context',path,'..'),{recursive:true});await writeFile(join(root,'context',path),content);
    }
    await mkdir(join(root,'members/old'),{recursive:true});await writeFile(join(root,'members/old/member.json'),'stale member');
    await mkdir(join(directory,'src/api'),{recursive:true});await writeFile(join(directory,'src/api/index.ts'),'implementation');
    const review=await workspaces.inspectInitialization({directory,adopt:true});
    const input={name:'Adopted',directory,models:testModels(),adopt:true};
    await assert.rejects(workspaces.create(input),error=>(error as {code?:string}).code==='cleanup_required');
    const created=await workspaces.create({...input,cleanupRevision:review.cleanupRevision!});
    assert.equal(created.context.seq,1);assert.equal(created.context.files,Object.keys(original).length);
    const indexed=await store.workspaces.loadContext(created.workspaceId);
    assert.equal(indexed.seq,1);assert.equal(indexed.files.length,Object.keys(original).length);
    for(const [path,content]of Object.entries(original)){
      assert.equal(await readFile(join(root,'context',path),'utf8'),content);
      const file=indexed.files.find(f=>f.path===path)!;
      assert.equal(await store.workspaces.blob(created.workspaceId,file.hash),content);
    }
    const members=await store.team.listMembers(created.workspaceId);
    assert.equal(members.length,1);
    assert.equal(members[0]!.value.name,'Lead');
    assert.deepEqual(members[0]!.value.harness.designScope,{working:['metadata.json'],dependencies:[]});
    assert.equal((await store.agents.getState(members[0]!.id)).historyPosition,0);
    assert.deepEqual(await readdir(join(root,'members')),[members[0]!.value.name]);
    const activation=await store.team.getMemberActivation(created.workspaceId);
    assert.equal(activation?.revision,members[0]!.value.configuration?.acceptedRevision);
    const baseline=await store.workspaces.getGitBaseline(created.workspaceId);
    assert.deepEqual(baseline!.design,Object.fromEntries(Object.entries(original).filter(([p])=>p.startsWith('design/')).map(([p,c])=>[`.rsi/context/${p}`,c])));
    assert.equal(await readFile(join(directory,'src/api/index.ts'),'utf8'),'implementation');
  }finally{await rm(directory,{recursive:true,force:true});}
});


test('Agent context inspection pages exact Pi entries, rejects changed revisions and survives restart without a runtime lease', {timeout: 30000}, async () => {
  const entries: ContextEntry[] = [
    {messageId: 'question', message: {...user, content: [{type: 'text' as const, text: 'Image input'}, {type: 'image' as const, mimeType: 'image/png', data: 'aW1hZ2U='}]}, metadata: {source: 'group-chat', groupPosition: 1}},
    {messageId: 'answer', message: fauxAssistantMessage([{type: 'thinking', thinking: '', thinkingSignature: 'opaque-signed-thinking'}, {type: 'text', text: 'Private result'}]), metadata: {source: 'model', extra: {kept: true}}},
  ];
  const {agentId} = await store.agents.createAgent(undefined, entries);
  const first = await store.agents.inspectContext(agentId, {limit: 1});
  assert.deepEqual(first, {revision: 0, offset: 0, total: 2, nextOffset: 1, entries: [entries[0]]});
  assert.deepEqual(await store.agents.inspectContext(agentId, {offset: 1, limit: 1, revision: first.revision}), {revision: 0, offset: 1, total: 2, nextOffset: null, entries: [entries[1]]});
  assert.deepEqual((await store.agents.inspectContext(agentId, {offset: 2, revision: 0})).entries, []);
  assert.deepEqual(await store.agents.getContext(agentId), {revision: 0, entries}, 'inspection neither mutates nor synchronizes context');
  const reopened = new CoreData(new MySqlStorage(databaseUrl!));
  try { assert.deepEqual(await reopened.agents.inspectContext(agentId), {...first, nextOffset: null, entries}); }
  finally { await reopened.close(); }
  await store.agents.patchContext(agentId, 0, {update: [], append: [{messageId: 'next', message: user, metadata: {}}]});
  await assert.rejects(store.agents.inspectContext(agentId, {offset: 1, revision: 0}), code('context_changed'));
  const current = await store.agents.inspectContext(agentId, {limit: 1});
  await store.agents.replaceContext(agentId, current.revision, [{messageId: 'compacted', message: user, metadata: {source: 'compaction'}}]);
  await assert.rejects(store.agents.inspectContext(agentId, {offset: 1, revision: current.revision}), code('context_changed'));
  assert.equal((await store.agents.inspectContext(agentId)).entries[0]!.messageId, 'compacted');
  await assert.rejects(store.agents.inspectContext(agentId, {offset: 2, revision: current.revision + 1}), code('invalid_input'));
  await assert.rejects(store.agents.inspectContext('missing'), code('not_found'));
  await store.storage.transaction(async db => {
    const scoped = store.agents.inTransaction(db);
    const pinned = await scoped.inspectContext(agentId);
    await store.agents.patchContext(agentId, pinned.revision, {update: [], append: [{messageId: 'concurrent', message: user, metadata: {}}]});
    assert.deepEqual(await scoped.inspectContext(agentId, {revision: pinned.revision}), pinned, 'one owner transaction keeps header and rows on the same repeatable-read snapshot');
  });
  assert.equal((await store.agents.inspectContext(agentId)).total, 2, 'a new inspection observes the concurrent commit');
});

test('Group context inspection reads original public entries, handles publication/reset revisions and never reads Agent private context', {timeout: 30000}, async () => {
  const f = await groupFixture();
  try {
    assert.deepEqual(await f.team.inspectGroupContext(f.workspaceId), {revision: 0, offset: 0, total: 0, nextOffset: null, entries: []});
    const accepted = await f.team.runner.postUser(f.workspaceId, '@Lead inspect this');
    const active = await f.team.inspectGroupContext(f.workspaceId, {limit: 1});
    assert.equal(active.total, 1, 'inspection works during an active model call');
    assert.equal(active.entries[0]!.messageId, accepted.message.messageId);
    assert.equal(active.entries[0]!.metadata.source, 'group-chat');
    answer((await f.requests.next()).events, fauxAssistantMessage([{type: 'thinking', thinking: '', thinkingSignature: 'private-signature'}, {type: 'text', text: 'Shared answer'}]));
    await f.runtime.finished(f.lead.memberId, accepted.runs[0]!.runId);
    await assert.rejects(f.team.inspectGroupContext(f.workspaceId, {revision: active.revision}), code('context_changed'));
    const first = await f.team.inspectGroupContext(f.workspaceId, {limit: 1});
    const second = await f.team.inspectGroupContext(f.workspaceId, {offset: first.nextOffset!, limit: 1, revision: first.revision});
    assert.equal(second.nextOffset, null);
    const original = (await store.team.readGroupContext(f.workspaceId, 0)).map(item => item.entry);
    assert.deepEqual([...first.entries, ...second.entries], original);
    assert.doesNotMatch(JSON.stringify(original), /private-signature/);
    assert.match(JSON.stringify(second.entries), /sender: Lead/);
    assert.ok(second.entries[0]!.metadata.finalRef);
    const memberContext = await f.runtime.inspectContext(f.lead.memberId);
    assert.match(JSON.stringify(memberContext), /private-signature/);
    await f.runtime.close();
    assert.deepEqual(await f.runtime.inspectContext(f.lead.memberId), memberContext, 'read does not require runtime ownership');
    const reopened = new CoreData(new MySqlStorage(databaseUrl!));
    try { assert.deepEqual((await reopened.team.inspectGroupContext(f.workspaceId)).entries, original); }
    finally { await reopened.close(); }
    await store.team.resetChat(f.workspaceId);
    await assert.rejects(f.team.inspectGroupContext(f.workspaceId, {offset: 1, revision: first.revision}), code('context_changed'));
    assert.equal((await f.team.inspectGroupContext(f.workspaceId)).total, 0);
  } finally { await f.close(); }
});

test('lightweight roster reads active SQL records without design, context or readiness inspection', {timeout: 30000}, async () => {
  const f = await groupFixture();
  try {
    const fail = async () => { throw new Error('Inspection is forbidden in a roster read'); };
    f.team.designs.working = fail; f.team.designs.read = fail; f.team.service.issues = fail;
    const before = await store.agents.inspectContext(f.lead.memberId);
    const result = await f.team.roster(f.workspaceId);
    assert.deepEqual(result.members.map(member => member.name), ['Lead', 'Backend', 'Frontend']);
    assert.ok(result.members.every(member => !member.running));
    assert.ok(result.members.every(member => !('harness' in member) && !('settings' in member) && !('ready' in member)));
    assert.deepEqual(await store.agents.inspectContext(f.lead.memberId), before);
  } finally { await f.close(); }
});

test('shared summary persists a pinned prefix, keeps 30 originals and concurrent arrivals, and never rewrites stable history', {timeout:30000}, async()=>{
  const f=await groupFixture();
  try {
    const publish=async(position:number)=>store.team.publishChat({workspaceId:f.workspaceId,author:{type:'user'},text:`Original message ${position}`,recipients:[]});
    for(let position=1;position<=40;position++)await publish(position);
    const source=await store.team.readGroupContext(f.workspaceId,0);
    const stable=await store.team.chatSnapshot(f.workspaceId,0,100);
    const input=await store.team.summaryInput(f.workspaceId);
    assert.equal(input.messages.length,10);assert.equal(input.through,10);assert.equal(input.analyzedThrough,40);
    for(let position=41;position<=45;position++)await publish(position);
    const before=await store.team.inspectGroupContext(f.workspaceId,{limit:10});
    const {previous:_previous,messages:_messages,uncoveredTokens:_tokens,...pinned}=input;
    const accepted=await store.team.submitGroupSummary(f.workspaceId,{...pinned,text:'Preserved goals, accepted decisions and remaining work.'});
    assert.equal(accepted.revision,1);
    const view=await store.team.readGroupContext(f.workspaceId,0);
    assert.equal(view.length,36,'summary plus 30 pinned originals and 5 new arrivals');
    assert.equal(view[0]!.entry.metadata.source,'group-summary');
    assert.deepEqual(view.slice(1,31),source.slice(10));
    const page=await store.team.inspectGroupContext(f.workspaceId,{limit:1});
    assert.equal(page.total,36);assert.equal(page.entries[0]!.messageId,accepted.messageId);assert.equal(page.nextOffset,1);
    assert.ok(page.revision>before.revision);
    await assert.rejects(store.team.inspectGroupContext(f.workspaceId,{offset:10,revision:before.revision}),/Context changed/);
    const tail=await store.team.inspectGroupContext(f.workspaceId,{offset:1,revision:page.revision,limit:100});
    assert.equal(tail.entries.length,35);assert.equal(tail.nextOffset,null);
    const [raw]=await store.pool.query<any[]>('SELECT entry FROM chat_context_entries WHERE workspace_id=? ORDER BY position',[f.workspaceId]);
    assert.equal(raw.length,45,'original source rows remain immutable');
    const afterStable=await store.team.chatSnapshot(f.workspaceId,0,100);
    assert.deepEqual(afterStable.messages.slice(0,40),stable.messages);
    assert.deepEqual((await store.team.readGroupContext(f.workspaceId,0,8)),source.slice(0,8),'older member checkpoint cannot see future summary');
    store.team.close();
    assert.deepEqual(await store.team.readGroupContext(f.workspaceId,0),view,'summary and full tail survive resident reload');
    await assert.rejects(store.team.submitGroupSummary(f.workspaceId,{...pinned,text:'Stale update'}),/revision changed/);
    const next=await store.team.summaryInput(f.workspaceId);
    assert.equal(next.previous?.messageId,accepted.messageId);assert.deepEqual(next.messages.map(item=>item.position),[11,12,13,14,15]);
    const {previous:_old,messages:_new,uncoveredTokens:_uncovered,...nextPinned}=next;
    await assert.rejects(store.team.submitGroupSummary(f.workspaceId,{...nextPinned,text:'  '}),/nonempty/);
    assert.equal((await store.team.readGroupSummary(f.workspaceId))?.revision,1);
    await store.team.submitGroupSummary(f.workspaceId,{...nextPinned,text:'Updated summary merges the prior summary and five newly older messages.'});
    assert.equal((await store.team.readGroupContext(f.workspaceId,0)).length,31);
    assert.deepEqual((await store.team.chatSnapshot(f.workspaceId,0,100)).messages,afterStable.messages);
    await store.team.resetChat(f.workspaceId);
    assert.equal(await store.team.readGroupSummary(f.workspaceId),undefined);
    assert.equal((await store.team.inspectGroupContext(f.workspaceId)).total,0);
    await assert.rejects(store.team.submitGroupSummary(f.workspaceId,{...nextPinned,text:'Before reset'}),/revision changed|boundary|source changed/);
  } finally {await f.close();}
});

test('summary migration retires semantic metadata and preserves original group source', {timeout:30000}, async()=>{
  const database='summary_migration_'+randomUUID().replaceAll('-','');
  const url=new URL(databaseUrl!);url.pathname='/'+database;
  await store.pool.query(`CREATE DATABASE ${database}`);
  const storage=new MySqlStorage(url.href),data=new CoreData(storage);
  const directory=await realpath(await mkdtemp(join(tmpdir(),'summary-migration-')));
  const workspaceService=new WorkspaceService(data.workspaces,testModelValidator);
  try {
    await data.migrate();
    const workspace=await workspaceService.create({name:'Migration',directory:join(directory,'project'),models:testModels(),adopt:false});
    const {summaryMessages}=await import('../group-summary-fixture.js');
    const original=summaryMessages(40,10,workspace.workspaceId);
    await storage.pool.execute('INSERT INTO chat_settings (workspace_id,position,context_length,context_revision) VALUES (?,40,40,40)',[workspace.workspaceId]);
    for(const item of original)await storage.pool.execute('INSERT INTO chat_context_entries (workspace_id,position,id,entry) VALUES (?,?,?,?)',[workspace.workspaceId,item.position,item.entry.messageId,encode(item.entry)]);
    await storage.pool.query('ALTER TABLE chat_settings DROP COLUMN context_revision, ADD COLUMN semantic_position BIGINT UNSIGNED NOT NULL DEFAULT 0, ADD COLUMN semantic_revision BIGINT UNSIGNED NOT NULL DEFAULT 0');
    await storage.pool.query('CREATE TABLE chat_semantic_indexes (workspace_id VARCHAR(64) PRIMARY KEY,data JSON NOT NULL)');
    await storage.pool.execute('INSERT INTO chat_semantic_indexes VALUES (?,?)',[workspace.workspaceId,encode({tree:[{topic:'Old derived index'}]})]);
    await data.team.migrate();
    assert.equal(await data.team.readGroupSummary(workspace.workspaceId),undefined,'old semantic tree is never accepted as a group summary');
    const page=await data.team.inspectGroupContext(workspace.workspaceId,{limit:100});
    assert.equal(page.revision,40);assert.deepEqual(page.entries,original.map(item=>item.entry));
    const [tables]=await storage.pool.query<any[]>("SHOW TABLES LIKE 'chat_semantic_indexes'");assert.equal(tables.length,0);
    const [columns]=await storage.pool.query<any[]>('SHOW COLUMNS FROM chat_settings');assert.ok(columns.some(row=>row.Field==='context_revision'));assert.ok(!columns.some(row=>row.Field.startsWith('semantic_')));
    await data.team.migrate();assert.deepEqual((await data.team.inspectGroupContext(workspace.workspaceId,{limit:100})).entries,page.entries,'migration is idempotent');
  }finally{await workspaceService.close();await data.close();await store.pool.query(`DROP DATABASE ${database}`);await rm(directory,{recursive:true,force:true});}
});

test('group envelope migration preserves stable records and identities, refreshes private attribution once and survives reload', {timeout:30000}, async()=>{
  const f=await groupFixture();
  try {
    const accepted=await f.team.runner.postUser(f.workspaceId,'@Backend review the current design');
    const step=await f.requests.next();
    answer(step.events, fauxAssistantMessage([{type:'thinking',thinking:'',thinkingSignature:'opaque-thinking'},{type:'text',text:'Completed review.',textSignature:'signed-answer'}]));
    await f.runtime.finished(f.backend.memberId,accepted.runs[0]!.runId);
    for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
    const shared=await store.team.readGroupContext(f.workspaceId,0), original=shared.map(item=>item.entry);
    const history=await store.team.chatSnapshot(f.workspaceId), privateHistory=await store.agents.runMessages(f.backend.memberId,accepted.runs[0]!.runId);
    const context=await store.agents.getContext(f.backend.memberId);
    const oldHeader=(entry:any)=>{
      const m=entry.metadata,a=m.author;
      return `[Group message ${m.groupPosition}]\n${a.type==='user'?'Sender: User [user]':`Sender: ${a.name} [member: ${a.memberId}]`}\n${m.recipients.length?`[Mentioned members: ${m.recipients.join(', ')}]\n`:''}`;
    };
    const prefix=(content:any)=>typeof content==='string'?content:content[0].text;
    const body=(content:any)=>prefix(content).slice(prefix(content).indexOf('</metadata>\n\n')+'</metadata>\n\n'.length);
    const oldById=new Map<string,any>();
    for(const entry of original){
      const old=structuredClone(entry);old.message.content=oldHeader(entry)+body(entry.message.content);delete old.metadata.recipientNames;oldById.set(entry.messageId,old);
      await store.pool.execute('UPDATE chat_context_entries SET entry = ? WHERE workspace_id = ? AND id = ?',[encode(old),f.workspaceId,old.messageId]);
    }
    const updates=context.entries.flatMap(entry=>{
      const source=oldById.get(entry.metadata.groupMessageId as string);if(!source)return [];
      const old=structuredClone(entry);
      if(old.message.role==='user'){old.message=source.message;delete old.metadata.recipientNames;}
      else if(old.message.role==='assistant'){const first=old.message.content.find(part=>part.type!=='thinking');if(first?.type==='text')first.text=oldHeader(source);}
      return [old];
    });
    await store.agents.patchContext(f.backend.memberId,context.revision,{append:[],update:updates});
    await store.pool.execute('UPDATE chat_settings SET context_format = 1 WHERE workspace_id = ?',[f.workspaceId]);
    store.team.close();
    await store.team.migrateGroupContext();
    const migrated=await store.team.inspectGroupContext(f.workspaceId);
    assert.deepEqual(migrated.entries,original);assert.equal(migrated.revision,original.length+1);
    assert.deepEqual(await store.team.chatSnapshot(f.workspaceId),history,'stable group history is immutable');
    assert.deepEqual(await store.agents.runMessages(f.backend.memberId,accepted.runs[0]!.runId),privateHistory,'stable signed history is immutable');
    const refreshed=await store.agents.getContext(f.backend.memberId);
    assert.deepEqual(refreshed.entries,context.entries,'only generated private attribution changes');
    await store.team.migrateGroupContext();
    assert.deepEqual(await store.agents.getContext(f.backend.memberId),refreshed,'second startup writes nothing');
    const {dirname}=await import('node:path'),{rename}=await import('node:fs/promises');
    const root=(await f.team.harness.environment(f.lead.memberId)).root;
    const stored=(await store.team.getMember(f.backend.memberId))!,source=stored.value.configuration!,legacy=`.rsi/members/${stored.id}/member.json`;
    await rename(join(root,dirname(source.path)),join(root,dirname(legacy)));
    await store.team.updateMember(stored.id,stored.revision,stored.value.name.toLowerCase(),{...stored.value,configuration:{...source,path:legacy}});
    await initGit({...f,directory:root});await gitText(root,['add','-f','-A','--','.rsi/members']);await gitText(root,['commit','-m','Legacy paths']);
    await writeFile(join(root,dirname(legacy),'prompts/member.md'),'Unaccepted prompt');
    await f.team.initialize();
    const member=(await store.team.getMember(stored.id))!;
    assert.equal(member.value.configuration!.path,source.path);assert.deepEqual(member.value.configuration!.legacyPaths,[legacy]);
    assert.equal(await readFile(join(root,dirname(source.path),'prompts/member.md'),'utf8'),'Unaccepted prompt');
    assert.deepEqual((await f.team.reviewConfiguration(f.workspaceId)).changes,[],'old committed paths resolve to the same members');
    const reopened=new CoreData(new MySqlStorage(databaseUrl!));
    try{assert.deepEqual((await reopened.team.inspectGroupContext(f.workspaceId)).entries,original);assert.deepEqual(await reopened.agents.getContext(f.backend.memberId),refreshed);assert.deepEqual(await reopened.team.getMember(stored.id),member);}
    finally{await reopened.close();}
  }finally{await f.close();}
});
