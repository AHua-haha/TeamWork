import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fauxAssistantMessage, fauxProvider, Type, type JsonObject, type ToolCall } from '@earendil-works/pi-ai';
import { png } from './image-fixture.js';
import { AgentExecution, fixedPolicy } from '../src/core/agent/agent.js';
import type { ModelStream, RuntimeTool, RuntimePolicy } from '../src/core/agent/contracts.js';
import { FileAssistantResponseHandler } from '../src/core/agent/file-assistant-response-handler.js';
import type { AssistantResponseHandlerData, CompletedMessage, ContextHistory, HandlerMessageEffects, RunState } from '../src/core/agent/data/model.js';

const model = fauxProvider().getModel();
const call = (id: string, name: string, arguments_: JsonObject): ToolCall => ({type: 'toolCall', id, name, arguments: arguments_});
const text = (record: {message: CompletedMessage['message']}) => Array.isArray(record.message.content) ? record.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : record.message.content;

async function fixture(t: TestContext, initial: Record<string, string> = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'file-handler-'))), root = join(directory, 'workspace');
  await mkdir(root);
  t.after(() => rm(directory, {recursive: true, force: true}));
  for (const [path, content] of Object.entries(initial)) { await mkdir(dirname(join(root, path)), {recursive: true}); await writeFile(join(root, path), content); }
  let state: AssistantResponseHandlerData = {revision: 0, data: {}};
  let handler = new FileAssistantResponseHandler(root, state);
  let context: ContextHistory = {revision: 0, entries: []};
  const history: CompletedMessage[] = [], commits: HandlerMessageEffects[] = [], requests: string[] = [];
  let failCommit = false;
  async function run(turns: ToolCall[][], tools: RuntimeTool[] = [], policyExtra: Partial<RuntimePolicy> = {}) {
    let index = 0;
    const stream: ModelStream = async function*(request) {
      requests.push(JSON.stringify(request.context.messages));
      const calls = turns[index++];
      const response = calls ? fauxAssistantMessage(calls, {stopReason: 'toolUse'}) : fauxAssistantMessage('finished');
      yield {type: 'start', partial: {...response, content: [], stopReason: 'pending'}};
      yield {type: 'done', reason: response.stopReason as 'stop' | 'toolUse', message: response};
    };
    const run: RunState = {agentId: 'agent', runId: `run-${history.length}`, status: 'running', phase: 'model', step: 0, startedAt: 1, endedAt: null, endPosition: null, activeMessageId: null, error: null};
    const execution = new AgentExecution(run, context, history.length, {model, tools, systemPrompt: '', options: {}}, {...fixedPolicy(model, tools), createAssistantResponseHandlers: () => [handler], ...policyExtra}, stream, {
      message: async record => { history.push(structuredClone(record)); return record; },
      handlerMessage: async (record, effects) => {
        if (failCommit) throw new Error('transaction rolled back');
        assert.equal(effects.revision, state.revision);
        state = {revision: state.revision + 1, data: structuredClone(effects.data)};
        commits.push(structuredClone(effects)); history.push(structuredClone(record));
        return record;
      },
    });
    const terminal = await execution.run(new AbortController().signal);
    context = execution.snapshot().context;
    return terminal;
  }
  return {root, directory, history, commits, requests, run, state: () => state, context: () => context,
    restart: () => {handler = new FileAssistantResponseHandler(root, state);}, clearContext: () => {context = {revision: context.revision + 1, entries: []};},
    setFailCommit: () => {failCommit = true;}, handler: () => handler};
}

 test('independent declarations execute directly and retain one visible aggregate without rewriting history', async t => {
  const f = await fixture(t, {'src/file.ts': 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine'});
  assert.ok(f.handler().tools().every(tool => tool.execute === undefined));
  const terminal = await f.run([[call('a', 'read', {path: 'src/file.ts', offset: 2, limit: 2}), call('b', 'read', {path: 'src/file.ts', offset: 7, limit: 2})]]);
  assert.equal(terminal.status, 'completed');
  const results = f.context().entries.filter(entry => entry.message.role === 'toolResult');
  assert.equal(results.length, 2);
  assert.equal(results[0]!.metadata.modelContextHidden, true);
  assert.equal(results[1]!.metadata.modelContextHidden, undefined);
  assert.match(text(results[1]!), /     2\ttwo/); assert.match(text(results[1]!), /     8\teight/);
  assert.match(text(results[1]!), /--- Lines 4-6 not shown ---/);
  assert.match(f.requests[1]!, /File view omitted/);
  assert.match(text(f.history.find(entry => entry.message.role === 'toolResult')!), /Aggregated file view/);
  assert.equal(f.history.find(entry => entry.message.role === 'toolResult')!.metadata.modelContextHidden, undefined);
  const data = f.state().data.files as Record<string, {ranges: unknown; visibleMessageId: string}>;
  assert.deepEqual(data[join(f.root, 'src/file.ts')]!.ranges, [{start: 2, end: 3}, {start: 7, end: 8}]);
  assert.equal(data[join(f.root, 'src/file.ts')]!.visibleMessageId, results[1]!.messageId);
  assert.equal(f.commits[1]!.metadataUpdates[0]!.messageId, results[0]!.messageId);
});

test('absolute and parent-relative paths and symlinks have no workspace or design permission boundary', async t => {
  const f = await fixture(t, {'file.txt': 'inside'});
  await writeFile(join(f.directory, 'outside.txt'), 'outside');
  await symlink(join(f.directory, 'outside.txt'), join(f.root, 'link.txt'));
  const terminal = await f.run([[call('a', 'read', {path: '../outside.txt'}), call('b', 'read', {path: 'link.txt'}), call('c', 'write', {path: join(f.directory, 'new/outside.txt'), content: 'new'}), call('d', 'edit', {path: join(f.directory, 'new/outside.txt'), edits: [{oldText: 'new', newText: 'edited'}]})]]);
  assert.equal(terminal.status, 'completed');
  assert.equal(await readFile(join(f.directory, 'new/outside.txt'), 'utf8'), 'edited');
  const files = f.state().data.files as Record<string, unknown>;
  assert.equal(Object.keys(files).length, 2, 'symlink and real path share one aggregate');
  assert.ok(f.history.filter(entry => entry.message.role === 'toolResult').every(entry => entry.message.role === 'toolResult' && !entry.message.isError));
});

test('a failed last edit preserves the preceding successful aggregate and does not replace its reference', async t => {
  const f = await fixture(t, {'file.txt': 'one\ntwo'});
  await f.run([[call('a', 'read', {path: 'file.txt'}), call('b', 'edit', {path: 'file.txt', edits: [{oldText: 'missing', newText: 'bad'}]})]]);
  const results = f.context().entries.filter(entry => entry.message.role === 'toolResult');
  assert.equal(results[0]!.metadata.modelContextHidden, undefined);
  assert.equal(results[1]!.message.role === 'toolResult' && results[1]!.message.isError, true);
  assert.equal(results[1]!.metadata.fileViewPath, undefined);
  assert.equal(f.state().revision, 1);
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'one\ntwo');
});

test('mixed file and other calls execute in assistant order', async t => {
  const f = await fixture(t, {'file.txt': 'one\ntwo'});
  const bash: RuntimeTool = {definition: {name: 'bash', description: 'test mutation', parameters: Type.Object({})}, execute: async () => {
    assert.equal(f.history.at(-1)?.message.role, 'toolResult');
    await writeFile(join(f.root, 'file.txt'), 'changed\ntwo');
    return {content: [{type: 'text', text: 'changed'}], isError: false};
  }};
  await f.run([[call('a', 'read', {path: 'file.txt'}), call('b', 'bash', {}), call('c', 'read', {path: 'file.txt'})]], [bash]);
  const results = f.context().entries.filter(entry => entry.message.role === 'toolResult');
  assert.deepEqual(results.map(entry => entry.message.role === 'toolResult' && entry.message.toolCallId), ['a', 'b', 'c']);
  assert.match(text(results[2]!), /changed/); assert.equal(results[0]!.metadata.modelContextHidden, true);
});

test('ranges and direct visible references survive runs and restoration; removed context references are harmless', async t => {
  const f = await fixture(t, {'file.txt': 'one\ntwo\nthree'});
  await f.run([[call('a', 'read', {path: 'file.txt', limit: 1})]]);
  f.restart();
  await f.run([[call('b', 'read', {path: 'file.txt', offset: 3, limit: 1})]]);
  assert.match(text(f.history.filter(entry => entry.message.role === 'toolResult').at(-1)!), /     1\tone/);
  assert.equal(f.commits.at(-1)!.metadataUpdates.length, 1);
  f.clearContext();
  await f.run([[call('c', 'read', {path: 'file.txt', limit: 1})]]);
  assert.equal(f.commits.at(-1)!.metadataUpdates.length, 0);
});

test('empty and shortened files never produce line zero or clamp stale ranges to unrelated lines', async t => {
  const f = await fixture(t, {'file.txt': 'one\ntwo\nthree'});
  await f.run([[call('a', 'read', {path: 'file.txt', offset: 3})]]);
  await writeFile(join(f.root, 'file.txt'), '');
  await f.run([[call('b', 'read', {path: 'file.txt'})]]);
  const result = f.history.filter(entry => entry.message.role === 'toolResult').at(-1)!;
  assert.match(text(result), /total_lines: 0/); assert.doesNotMatch(text(result), /undefined|\n *0\t/);
});

test('exact edits shift ranges, preserve CRLF, and reject overlapping or ambiguous matches before writing', async t => {
  const f = await fixture(t, {'file.txt': 'a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\ni\r\n'});
  await f.run([[call('a', 'read', {path: 'file.txt', offset: 7, limit: 2})], [call('b', 'edit', {path: 'file.txt', edits: [{oldText: 'b\r\nc', newText: 'B\r\nC\r\nC2'}, {oldText: 'e\nf', newText: 'E\nF'}]})]]);
  const result = f.history.filter(entry => entry.message.role === 'toolResult').at(-1)!;
  assert.match(text(result), /     9\th/); assert.match(text(result), /C2/);
  assert.doesNotMatch(await readFile(join(f.root, 'file.txt'), 'utf8'), /(?<!\r)\n/);
  const before = await readFile(join(f.root, 'file.txt'), 'utf8');
  await f.run([[call('c', 'edit', {path: 'file.txt', edits: [{oldText: 'B\nC', newText: 'x'}, {oldText: 'C\nC2', newText: 'y'}]})]]);
  assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), before);
});

test('successful write suppresses only its content argument and preserves original stable history', async t => {
  const f = await fixture(t);
  await f.run([[call('a', 'write', {path: 'new/file.txt', content: 'unique-secret-for-test\nsecond\n'})]]);
  assert.match(f.requests[1]!, /Written successfully; content omitted/);
  const assistant = f.context().entries.find(entry => entry.message.role === 'assistant')!;
  assert.deepEqual(assistant.metadata.suppressedToolCallArguments, ['a']);
  assert.match(JSON.stringify(f.history[0]), /unique-secret-for-test/);
  assert.match(text(f.history[1]!), /     2\tsecond/);
  assert.equal(f.commits[0]!.metadataUpdates[0]!.messageId, assistant.messageId);
});

test('all file results use digit-based line-number width and custom read descriptions match untruncated aggregates', async t => {
  const f = await fixture(t, {'file.txt': Array.from({length: 3000}, (_, i) => `  line-${i + 1}`).join('\n')});
  await f.run([[call('a', 'read', {path: 'file.txt'})]]);
  const lines = text(f.history[1]!).split('\n').filter(line => /^ *\d+\t/.test(line));
  assert.equal(lines.length, 3000); assert.equal(lines[0], '     1\t  line-1');
  assert.match(f.handler().tools()[0]!.definition.description, /not truncated/);
});

test('read preserves native image content rather than attempting UTF-8 decoding', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'pixel.png'), png());
  await f.run([[call('a', 'read', {path: 'pixel.png'})]]);
  const result = f.history[1]!.message;
  assert.equal(result.role, 'toolResult');
  assert.ok(Array.isArray(result.content) && result.content.some(part => part.type === 'image'), text(f.history[1]!));
});

test('persistence failure is fatal, publishes no handler state, and does not replay file effects', async t => {
  const f = await fixture(t);
  f.setFailCommit();
  const terminal = await f.run([[call('a', 'write', {path: 'new.txt', content: 'already written'})]]);
  assert.equal(terminal.status, 'failed'); assert.equal(terminal.error?.code, 'handler_state_persistence_failure');
  assert.equal(await readFile(join(f.root, 'new.txt'), 'utf8'), 'already written');
  assert.equal(f.state().revision, 0); assert.equal(f.history.length, 1); assert.equal(f.requests.length, 1);
});

test('legacy file ranges obtain a visible reference once from restored context', async t => {
  const f = await fixture(t, {'file.txt': 'one\ntwo'});
  const initial: AssistantResponseHandlerData = {revision: 0, data: {files: {'file.txt': {ranges: [{start: 1, end: 1}]}}}};
  const handler = new FileAssistantResponseHandler(f.root, initial);
  const legacy = {messageId: 'legacy-read', message: {role: 'toolResult' as const, toolName: 'read', toolCallId: 'old', content: [{type: 'text' as const, text: 'old view'}], isError: false, timestamp: 1}, metadata: {fileViewPath: 'file.txt'}};
  handler.restoreContext({revision: 1, entries: [legacy]});
  handler.restoreContext({revision: 2, entries: [],}); // Later activations do not rescan/rebuild references.
  let previous: string | undefined;
  const calls = [call('read', 'read', {path: 'file.txt'})];
  await handler.handle(fauxAssistantMessage(calls, {stopReason: 'toolUse'}), {
    scope: {signal: new AbortController().signal} as never, toolCalls: calls,
    beforeToolCall: async () => undefined, validateToolCall: c => c.arguments,
    recordToolResult: async (c, output, _metadata, commit) => {previous = commit?.hideMessageId; return {...output, role: 'toolResult', toolCallId: c.id, toolName: c.name, timestamp: 1};},
    contextEntry: () => undefined, execute: async () => {throw new Error('not used');}, appendHint: async () => undefined, updateMetadata: async () => undefined, suppressToolCallArguments: async () => undefined,
  });
  assert.equal(previous, 'legacy-read');
});

test('compaction executes handler-owned file tools and retains only the latest visible aggregate', async t => {
  const f = await fixture(t, {'file.txt': 'one\ntwo\nthree'});
  const handler = f.handler();
  let mode = 'work', preparation = 0;
  const base = fixedPolicy(model), stable: CompletedMessage[] = [];
  const stream: ModelStream = async function*(request) {
    if (mode === 'compaction') assert.ok(request.tools.some(tool => tool.definition.name === 'read'));
    const calls = mode === 'compaction' && ++preparation <= 2 ? [call(`read-${preparation}`, 'read', {path: 'file.txt', offset: preparation === 1 ? 1 : 3, limit: 1})] : undefined;
    const response = calls ? fauxAssistantMessage(calls, {stopReason: 'toolUse'}) : fauxAssistantMessage(mode === 'compaction' ? 'Retained file knowledge. Next steps: finish.' : 'done');
    yield {type: 'start', partial: {...response, content: [], stopReason: 'pending'}};
    yield {type: 'done', reason: response.stopReason as 'stop' | 'toolUse', message: response};
  };
  const initial: RunState = {agentId: 'agent', runId: 'compact-run', status: 'running', phase: 'model', step: 0, startedAt: 1, endedAt: null, endPosition: null, activeMessageId: null, error: null};
  const execution = new AgentExecution(initial, {revision: 0, entries: [{messageId: 'large', message: {role: 'user', content: 'old '.repeat(15000), timestamp: 1}, metadata: {}}]}, 0,
    {model, tools: [], systemPrompt: '', options: {}, compaction: {thresholdTokens: 4000, prompt: 'Preserve useful context; do not continue work.'}},
    {...base, createAssistantResponseHandlers: () => [handler], buildRequest: async(scope, history) => {mode = scope.mode!; return base.buildRequest(scope, history);}}, stream,
    {message: async record => {stable.push(structuredClone(record)); return record;}, compactionMessage: async record => {stable.push(structuredClone(record)); return record;}, handlerMessage: async record => {stable.push(structuredClone(record)); return record;}});
  assert.equal((await execution.run(new AbortController().signal)).status, 'completed');
  const results = execution.snapshot().context.entries.filter(entry => entry.message.role === 'toolResult');
  assert.equal(results.length, 2); assert.equal(results[0]!.metadata.modelContextHidden, true); assert.equal(results[1]!.metadata.modelContextHidden, undefined);
  assert.match(text(results[1]!), /three/);
  assert.ok(stable.filter(entry => entry.message.role === 'toolResult').every(entry => entry.metadata.modelContextHidden === undefined));
});

test('deleting text reveals the surviving changed line and deleting the whole file yields an empty view', async t => {
  const f = await fixture(t, {'file.txt': 'hello world'});
  await f.run([[call('a', 'edit', {path: 'file.txt', edits: [{oldText: 'world', newText: ''}]})]]);
  assert.match(text(f.history[1]!), /     1\thello /);
  await f.run([[call('b', 'edit', {path: 'file.txt', edits: [{oldText: 'hello ', newText: ''}]})]]);
  const result = f.history.filter(entry => entry.message.role === 'toolResult').at(-1)!;
  assert.match(text(result), /total_lines: 0/); assert.doesNotMatch(text(result), /undefined|\n *0\t/);
});
