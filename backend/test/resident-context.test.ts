import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { ResidentContexts } from '../src/core/agent/data/resident-context.js';
import { AgentContextState, AgentState } from '../src/core/agent/data/state.js';
import { AgentMessageContext } from '../src/core/agent/data/context.js';
import type { ContextEntry, ContextHistory, RunState } from '../src/core/agent/data/model.js';

const input = (id: string): ContextEntry => ({messageId: id, message: {role: 'user', content: id, timestamp: 1}, metadata: {}});

test('resident context coalesces initial loads and reuses the model across activations', async () => {
  const residents = new ResidentContexts();
  let loads = 0;
  const load = async () => { loads++; return {revision: 0, entries: []}; };
  const [one, two] = await Promise.all([residents.get('agent', load), residents.get('agent', load)]);
  assert.equal(one, two); assert.equal(loads, 1);
  residents.changed('agent', {baseRevision: 0, revision: 1, patch: {append: [input('a')], update: []}});
  const run = (id: string): RunState => ({agentId: 'agent', runId: id, status: 'running', phase: 'model', step: 0, startedAt: 1, endedAt: null, endPosition: null, activeMessageId: null, error: null});
  const first = new AgentState(run('one'), one, 0);
  const second = new AgentState(run('two'), await residents.get('agent', load), 1);
  assert.equal(first.context, second.context); assert.equal(loads, 1);
  second.receive({...input('b'), agentId: 'agent', runId: 'two', position: 2});
  assert.equal(first.context.entries.at(-1)!.messageId, 'b');
  const detached = second.snapshot(); detached.context.entries.length = 0;
  assert.equal(first.context.entries.length, 2);
  residents.clear(); assert.notEqual(await residents.get('agent', load), one); assert.equal(loads, 2);
});

test('commit during first durable read is incorporated exactly once after snapshot restoration', async () => {
  const residents = new ResidentContexts();
  let resolve!: (history: ContextHistory) => void;
  const loaded = residents.get('agent', () => new Promise(done => {resolve = done;}));
  await Promise.resolve();
  residents.changed('agent', {baseRevision: 0, revision: 1, patch: {append: [input('new')], update: []}});
  resolve({revision: 0, entries: []});
  const model = await loaded;
  assert.deepEqual(model.history, {revision: 1, entries: [input('new')]});
  residents.changed('agent', {baseRevision: 0, revision: 1, patch: {append: [input('new')], update: []}});
  assert.equal(model.history.entries.length, 1);
});

test('group delivery produces append/provenance patches without mutating old signed context', async () => {
  const signed: ContextEntry = {messageId: 'own', message: fauxAssistantMessage([{type: 'thinking', thinking: '', thinkingSignature: 'encrypted'}, {type: 'text', text: 'Result'}]), metadata: {}};
  const original = structuredClone(signed);
  const context = {revision: 2, entries: [input('old'), signed]};
  const shared = {id: 'group', read: async () => [
    {position: 1, sender: 'Sender: Agent', origin: {agentId: 'agent', messageId: 'own'}, entry: {...input('shared-own'), metadata: {}}},
    {position: 2, sender: 'Sender: User', entry: input('new')},
  ]};
  const change = await new AgentMessageContext('agent', context).changes(shared);
  assert.ok(change && 'patch' in change);
  assert.deepEqual(change.patch.append.map(entry => entry.messageId), ['new']);
  assert.deepEqual(change.patch.update.map(entry => entry.messageId), ['own']);
  assert.deepEqual(signed, original);
  const model = new AgentContextState(context); model.patch(3, change.patch);
  assert.deepEqual((model.history.entries[1]!.message.content as unknown[])[0], (signed.message.content as unknown[])[0]);
  assert.equal(await new AgentMessageContext('agent', model.history).changes({id: 'group', read: async after => {assert.equal(after, 2); return [];}}), undefined);
});

test('a revision gap prevents stale execution and allows a new durable restoration', async () => {
  const residents = new ResidentContexts();
  const stale = await residents.get('agent', async () => ({revision: 0, entries: []}));
  residents.changed('agent', {baseRevision: 1, revision: 2, patch: {append: [input('missed')], update: []}});
  assert.throws(() => stale.history, /out of sequence/);
  const restored = await residents.get('agent', async () => ({revision: 2, entries: [input('restored')]}));
  assert.notEqual(restored, stale); assert.equal(restored.history.revision, 2);
});

test('repair inside a restored prefix preserves ordering through explicit replacement', async () => {
  const call: ContextEntry = {messageId: 'call', message: fauxAssistantMessage([{type: 'toolCall', id: 'uncertain', name: 'bash', arguments: {command: 'work'}}], {stopReason: 'toolUse'}), metadata: {}};
  const history = {revision: 1, entries: [call, input('later')]};
  const change = await new AgentMessageContext('agent', history).changes();
  assert.ok(change && 'replace' in change);
  assert.deepEqual(change.replace.map(entry => entry.message.role), ['assistant', 'toolResult', 'user']);
  assert.deepEqual(history.entries, [call, input('later')]);
  const complete = await new AgentMessageContext('agent', history).incoming();
  assert.deepEqual(complete!.map(entry => entry.message.role), ['assistant', 'toolResult', 'user']);
});
