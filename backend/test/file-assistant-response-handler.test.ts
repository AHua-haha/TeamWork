import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { fauxAssistantMessage, type JsonObject, type ToolCall } from '@earendil-works/pi-ai';
import type { AssistantResponseHandlerContext, AgentFileCapability } from '../src/core/agent/contracts.js';
import { FileAssistantResponseHandler } from '../src/core/agent/file-assistant-response-handler.js';
import type { AssistantResponseHandlerData } from '../src/core/agent/data/model.js';

function fixture(initialFiles: Record<string, string> = {}) {
  const root = '/workspace';
  const files = new Map(Object.entries(initialFiles).map(([path, content]) => [resolve(root, path), content]));
  const capability: AgentFileCapability = {
    operation: async (_id, action) => action(),
    fileInvocation: async (_id, _name, path) => ({ root, path: resolve(root, path) }),
    files: async () => ({
      read: { readFile: async path => { const content = files.get(path); if (content === undefined) throw new Error(`${path} not found`); return Buffer.from(content); } },
      write: {
        mkdir: async () => undefined,
        writeFile: async (path, content) => { if (path.includes('/missing/')) throw new Error('write target is unavailable'); files.set(path, content); },
      },
      edit: {
        readFile: async path => { const content = files.get(path); if (content === undefined) throw new Error(`${path} not found`); return Buffer.from(content); },
        writeFile: async (path, content) => { files.set(path, content); },
      },
    }),
  };
  let persisted: AssistantResponseHandlerData = { revision: 0, data: {} };
  const handler = new FileAssistantResponseHandler(capability, 'agent', persisted, async (revision, data) => {
    assert.equal(revision, persisted.revision);
    persisted = { revision: revision + 1, data: structuredClone(data) };
    return structuredClone(persisted);
  });
  const results: Array<{ id: string; text: string; isError: boolean; metadata?: Record<string, unknown> }> = [];
  const hidden: Array<{ path: string; keep: string }> = [];
  const suppressed: string[][] = [];
  const context = (calls: ReturnType<typeof call>[]): AssistantResponseHandlerContext => ({
    scope: { mode: 'work', agentId: 'agent', runId: 'run', step: 1, signal: new AbortController().signal,
      config: { model: {} as never, tools: [], systemPrompt: '', options: {} },
      readContext: async () => ({ revision: 0, entries: [] }),
      replaceContext: async (_revision, entries) => ({ revision: 1, entries }),
      recordInput: async () => undefined },
    toolCalls: calls.map(item => item.value),
    execute: async () => { throw new Error('file handler should not delegate'); },
    beforeToolCall: async () => undefined,
    validateToolCall: toolCall => toolCall.arguments,
    recordToolResult: async (toolCall, output, metadata) => {
      results.push({ id: toolCall.id, text: output.content.find(part => part.type === 'text')?.text ?? '', isError: output.isError, metadata });
      return { role: 'toolResult', toolCallId: toolCall.id, toolName: toolCall.name, content: output.content, isError: output.isError, timestamp: 1 };
    },
    appendHint: async () => undefined,
    updateMetadata: async () => undefined,
    hideFileViews: async (path, keep) => { hidden.push({ path, keep }); },
    suppressToolCallArguments: async ids => { suppressed.push(ids); },
  });
  return { root, files, handler, persisted: () => persisted, results, hidden, suppressed, context };
}
type CallFixture = { value: ToolCall; id: string; name: string; arguments: JsonObject };
function call(id: string, name: string, arguments_: JsonObject): CallFixture {
  return { value: { type: 'toolCall', id, name, arguments: arguments_ }, id, name, arguments: arguments_ };
}

 test('same-response reads merge ranges and only the last result contains the cat-n aggregate', async () => {
  const setup = fixture({ 'src/file.ts': 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine' });
  const calls = [call('read-a', 'read', { path: 'src/file.ts', offset: 2, limit: 2 }), call('read-b', 'read', { path: 'src/file.ts', offset: 7, limit: 2 })];
  await setup.handler.handle(fauxAssistantMessage(calls.map(item => item.value), { stopReason: 'toolUse' }), setup.context(calls));
  assert.equal(setup.results.length, 2);
  assert.equal(setup.results[0]!.text, 'read succeeded for src/file.ts.');
  const output = setup.results[1]!.text;
  assert.match(output, /Aggregated file view/);
  assert.match(output, /--- Lines 1-1 not shown ---/);
  assert.match(output, /--- Lines 4-6 not shown ---/);
  assert.match(output, /     2\ttwo/);
  assert.match(output, /     8\teight/);
  assert.match(output, /<metadata>\npath: src\/file\.ts\ntotal_lines: 9\noperation: read\nstatus: success\n<\/metadata>$/);
  assert.doesNotMatch(output, /revealedRanges/);
  assert.deepEqual(setup.persisted().data, { files: { 'src/file.ts': { ranges: [{ start: 2, end: 3 }, { start: 7, end: 8 }] } } });
  assert.deepEqual(setup.hidden, [{ path: 'src/file.ts', keep: 'read-b' }]);
});

test('edit adjusts later revealed ranges and supports multiple exact replacements in one call', async () => {
  const setup = fixture({ 'src/file.ts': 'a\nb\nc\nd\ne\nf\ng\nh\ni\n' });
  const read = [call('read-initial', 'read', { path: 'src/file.ts', offset: 7, limit: 2 })];
  await setup.handler.handle(fauxAssistantMessage(read.map(item => item.value), { stopReason: 'toolUse' }), setup.context(read));
  setup.results.length = 0;
  setup.hidden.length = 0;
  const edits = [call('edit-1', 'edit', { path: 'src/file.ts', edits: [
    { oldText: 'b\nc', newText: 'B\nC\nC2' },
    { oldText: 'e\nf', newText: 'E\nF' },
  ] })];
  await setup.handler.handle(fauxAssistantMessage(edits.map(item => item.value), { stopReason: 'toolUse' }), setup.context(edits));
  const output = setup.results[0]!.text;
  assert.equal(setup.results[0]!.isError, false);
  assert.match(output, /edit_result: applied 2 exact string replacements/);
  assert.match(output, /operation: edit\nstatus: success/);
  assert.match(output, /C2/);
  assert.match(output, /     9\th/);
  assert.doesNotMatch(output, /     10\ti/);
  assert.deepEqual(setup.persisted().data, { files: { 'src/file.ts': { ranges: [{ start: 2, end: 4 }, { start: 6, end: 9 }] } } });
});

test('successful write returns the full file and suppresses its long input; failure keeps the input visible', async () => {
  const setup = fixture({});
  const writes = [call('write-ok', 'write', { path: 'new/file.txt', content: 'first\nsecond\n' })];
  await setup.handler.handle(fauxAssistantMessage(writes.map(item => item.value), { stopReason: 'toolUse' }), setup.context(writes));
  assert.match(setup.results[0]!.text, /operation: write\nstatus: success/);
  assert.match(setup.results[0]!.text, /     2\tsecond/);
  assert.deepEqual(setup.suppressed, [['write-ok']]);

  const failed = [call('write-bad', 'write', { path: 'missing/file.txt', content: 'keep this argument' })];
  await setup.handler.handle(fauxAssistantMessage(failed.map(item => item.value), { stopReason: 'toolUse' }), setup.context(failed));
  assert.equal(setup.results[1]!.isError, true);
  assert.match(setup.results[1]!.text, /<metadata>\npath: missing\/file\.txt\noperation: write\nstatus: error\n<\/metadata>$/);
  assert.deepEqual(setup.suppressed, [['write-ok']]);
});

test('handler-state persistence failure is fatal and never becomes a misleading ordinary tool error', async () => {
  const root = '/workspace';
  const files = new Map([[resolve(root, 'src/file.ts'), 'content']]);
  const capability: AgentFileCapability = {
    operation: async (_id, action) => action(),
    fileInvocation: async (_id, _name, path) => ({ root, path: resolve(root, path) }),
    files: async () => ({ read: { readFile: async path => Buffer.from(files.get(path) ?? '') },
      write: { mkdir: async () => undefined, writeFile: async () => undefined },
      edit: { readFile: async path => Buffer.from(files.get(path) ?? ''), writeFile: async () => undefined } }),
  };
  const handler = new FileAssistantResponseHandler(capability, 'agent', { revision: 0, data: {} }, async () => { throw new Error('db refused'); });
  const input = [call('read-fail-persist', 'read', { path: 'src/file.ts' })];
  const fixture = fixtureContext(input);
  await assert.rejects(handler.handle(fauxAssistantMessage(input.map(item => item.value), { stopReason: 'toolUse' }), fixture.context), /Could not persist file handler state/);
  assert.equal(fixture.results.length, 0);
});

function fixtureContext(calls: CallFixture[]) {
  const results: Array<{ text: string }> = [];
  const context = {
    scope: { mode: 'work' as const, agentId: 'agent', runId: 'run', step: 1, signal: new AbortController().signal,
      config: { model: {} as never, tools: [], systemPrompt: '', options: {} }, readContext: async () => ({ revision: 0, entries: [] }),
      replaceContext: async (_revision: number, entries: never[]) => ({ revision: 1, entries }), recordInput: async () => undefined },
    toolCalls: calls.map(item => item.value), execute: async () => { throw new Error('unexpected execute'); }, beforeToolCall: async () => undefined,
    validateToolCall: (toolCall: { arguments: JsonObject }) => toolCall.arguments,
    recordToolResult: async (_call: unknown, output: { content: Array<{ type: string; text?: string }> }) => { results.push({ text: output.content.find(part => part.type === 'text')?.text ?? '' }); return {} as never; },
    appendHint: async () => undefined, updateMetadata: async () => undefined, hideFileViews: async () => undefined, suppressToolCallArguments: async () => undefined,
  } as unknown as AssistantResponseHandlerContext;
  return { context, results };
}

