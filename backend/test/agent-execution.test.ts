import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { AgentExecution, fixedPolicy, type AgentObserver } from '../src/core/agent/agent.js';
import type { ModelStream, AgentConfiguration } from '../src/core/agent/contracts.js';
import type { RunState } from '../src/core/agent/types.js';

const model = fauxProvider().getModel();
const config: AgentConfiguration = { model, tools: [], systemPrompt: '', options: {} };
const initial: RunState = { agentId: 'agent', runId: 'run', status: 'running', phase: 'model', step: 0, startedAt: 1, endedAt: null, endPosition: null, activeMessageId: null, error: null };
function execution(observer?: AgentObserver) {
  const response = fauxAssistantMessage('answer');
  const stream: ModelStream = async function* () {
    yield { type: 'start', partial: { ...response, content: [], stopReason: 'pending' } };
    yield { type: 'done', reason: 'stop', message: response };
  };
  return new AgentExecution(initial, { revision: 0, entries: [] }, 0, config, fixedPolicy(model), stream, observer);
}

test('one Agent executes entirely in memory without a persistence provider', async () => {
  const agent = execution();
  const terminal = await agent.run(new AbortController().signal);
  assert.equal(terminal.status, 'completed'); assert.equal(terminal.endPosition, 1);
  const snapshot = agent.snapshot();
  assert.equal(snapshot.context.entries.length, 1);
  assert.equal(snapshot.context.entries[0]!.message.role, 'assistant');
  snapshot.context.entries.length = 0;
  assert.equal(agent.snapshot().context.entries.length, 1, 'public state is detached');
  await assert.rejects(agent.run(new AbortController().signal), /already started/);
});

test('caller acknowledgement completes before dependent finalization and can assign stable record positions', async () => {
  let release!: () => void, entered!: () => void, finished = false;
  const gate = new Promise<void>(resolve => release = resolve), recording = new Promise<void>(resolve => entered = resolve);
  const agent = execution({
    messageStart: async () => 8,
    message: async record => { entered(); await gate; return record; },
    finished: async state => { finished = true; return state; },
  });
  const running = agent.run(new AbortController().signal);
  await recording;
  assert.equal(finished, false);
  assert.equal(agent.snapshot().context.entries.length, 0);
  release();
  const terminal = await running;
  assert.equal(finished, true); assert.equal(terminal.endPosition, 9);
});

test('caller persistence failure becomes failed execution and terminal acknowledgement failure is observable', async () => {
  let state: RunState | undefined;
  const agent = execution({ message: async () => { throw new Error('caller write failed'); }, finished: async value => { state = value; } });
  const result = await agent.run(new AbortController().signal);
  assert.equal(state?.status, 'failed'); assert.match(result.error!.message, /caller write failed/);
  assert.equal(agent.snapshot().context.entries.length, 0);
  const terminalFailure = execution({ finished: async () => { throw new Error('terminal write failed'); } });
  await assert.rejects(terminalFailure.run(new AbortController().signal), /terminal write failed/);
  assert.equal(terminalFailure.snapshot().run.status, 'completed', 'memory execution is terminal even when caller persistence fails');
});
