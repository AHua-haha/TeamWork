import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import type { AgentConfiguration, ResolvedRunConfig, StepScope } from '../src/core/agent/contracts.js';
import { AgentRuntime, fixedPolicy } from '../src/core/agent/runtime.js';
import type { AgentData } from '../src/core/agent/data/repository.js';
import type { GroupSemanticIndex } from '../src/core/agent/data/context.js';
import type { RunState } from '../src/core/agent/data/model.js';
import { groupEntry, groupSender, type ChatMessage } from '../src/core/team/data/group-chat.js';
import { semanticSourceDigest, validateSemanticInvolvement, validateSemanticSubmission, type GroupSemanticSubmission } from '../src/core/team/data/semantic.js';
import { settle, withTeam, type Fixture } from './team-fixture.js';

function terminal(status: RunState['status'] = 'completed'): RunState {
  return { agentId: 'maintenance', runId: 'maintenance-run', status, phase: 'finished', step: 1, startedAt: 1, endedAt: 2, endPosition: 0, activeMessageId: null, error: null };
}

function semanticFixture(f: Fixture, text = 'x'.repeat(128_000)) {
  const chat: ChatMessage = { workspaceId: f.workspaceId, messageId: 'g1', position: 1, exchangeId: 'e1', author: { type: 'user' }, text, recipients: [], time: 1 };
  const messages = [{ position: 1, entry: groupEntry(chat), sender: groupSender(chat) }];
  let saved: GroupSemanticIndex | undefined;
  let reads = 0;
  const metadata = { baseRevision: 0, through: 1, sourceDigest: semanticSourceDigest(messages) };
  Object.assign(f.store, {
    semanticInput: async (workspaceId: string) => {
      assert.equal(workspaceId, f.workspaceId); reads++;
      return { messages, previous: saved, through: 1, baseRevision: saved?.revision ?? 0 };
    },
    submitGroupSemantic: async (workspaceId: string, submission: GroupSemanticSubmission) => {
      assert.equal(workspaceId, f.workspaceId);
      assert.deepEqual({ baseRevision: submission.baseRevision, through: submission.through, sourceDigest: submission.sourceDigest }, metadata);
      validateSemanticSubmission(submission, 1);
      validateSemanticInvolvement(submission.tree, messages, new Set([f.lead.memberId]));
      saved = { revision: 1, from: 1, through: 1, sourceDigest: metadata.sourceDigest, tree: structuredClone(submission.tree) };
      return saved;
    },
  });
  Object.assign(f.team.runConfig, { resolveForRun: async (memberId: string) => {
    assert.equal(memberId, f.lead.memberId);
    return { model: {}, options: {}, tools: [], systemPrompt: 'Lead prompt', source: {} } as unknown as ResolvedRunConfig;
  } });
  const submit = async (config: AgentConfiguration) => {
    assert.ok(config.systemPrompt.includes(JSON.stringify(metadata)), 'backend supplies the exact digest, source boundary and base revision');
    assert.equal(config.compaction, undefined);
    const args = { ...metadata, tree: [{ id: 'root', firstPosition: 1, lastPosition: 1, topic: 'Project', summary: 'Agreed project context', involvedMemberIds: [], children: [] }] };
    const tool = config.tools[0]!;
    assert.equal(tool.definition.name, 'submit_group_semantic_information');
    await tool.execute(args, {} as StepScope, { type: 'toolCall', id: 'submit', name: tool.definition.name, arguments: args });
  };
  return { messages, submit, get saved() { return saved; }, get reads() { return reads; } };
}

test('startup checks eligible existing group context with a bound runtime and supplies valid submission metadata', () => withTeam(async f => {
  const data = semanticFixture(f);
  let calls = 0;
  Object.assign(f.runtime, { async runMaintenance(config: AgentConfiguration, entries: unknown[], signal: AbortSignal) {
    assert.equal(this, f.runtime, 'maintenance retains the runtime receiver');
    assert.equal(signal.aborted, false);
    assert.equal(entries.length, 2, 'maintenance gets original group context and previous-index input');
    calls++; await data.submit(config); return terminal();
  } });
  await f.team.startMaintenance();
  assert.equal(calls, 1);
  assert.equal(data.saved?.revision, 1);
  assert.equal(f.runtime.runs.length, 0, 'maintenance creates no member activation');
  await f.team.startMaintenance();
  assert.equal(calls, 1, 'startup scan is idempotent');
}));

test('startup semantic generation executes through the real AgentRuntime model/tool loop', () => withTeam(async f => {
  const data = semanticFixture(f);
  const model = fauxProvider().getModel();
  const configuration: ResolvedRunConfig = { model, options: {}, tools: [], systemPrompt: '', source: { appRevision: 0, agentRevision: 0, catalogRevisions: {} } };
  const config = { resolveForRun: async () => configuration };
  Object.assign(f.team.runConfig, config);
  // Maintenance needs runtime ownership, but owns no durable member context/history.
  const ownership = {
    acquireRuntime: async () => {}, assertRuntime: () => {}, releaseRuntime: async () => {},
    recoverCompactions: async () => {}, recoverInterruptedRuns: async () => {},
  } as unknown as AgentData;
  let modelCalls = 0;
  const runtime = new AgentRuntime(ownership, config, fixedPolicy(model), async function* (request) {
    modelCalls++;
    assert.equal(request.context.messages[0]?.role, 'user');
    const metadata = { baseRevision: 0, through: 1, sourceDigest: semanticSourceDigest(data.messages) };
    assert.ok(request.context.systemPrompt?.includes(JSON.stringify(metadata)));
    const args = { ...metadata, tree: [{ id: 'root', firstPosition: 1, lastPosition: 1, topic: 'Project', summary: 'Agreed project context', involvedMemberIds: [], children: [] }] };
    const message = modelCalls === 1 ? fauxAssistantMessage([{ type: 'toolCall', id: 'submit', name: 'submit_group_semantic_information', arguments: args }], { stopReason: 'toolUse' }) : fauxAssistantMessage('Semantic information saved.');
    if (modelCalls === 2) {
      const result = request.context.messages.find(message => message.role === 'toolResult');
      assert.ok(result && result.role === 'toolResult' && !result.isError, 'real tool execution accepted the semantic index');
    }
    yield { type: 'start', partial: { ...message, content: [], stopReason: 'pending' } };
    yield { type: 'done', reason: modelCalls === 1 ? 'toolUse' : 'stop', message };
  });
  await runtime.open();
  f.team.attach(runtime);
  try {
    await f.team.startMaintenance();
    assert.equal(modelCalls, 2, 'maintenance reaches the model and resumes after its submission tool');
    assert.equal(data.saved?.revision, 1);
    assert.equal(data.saved?.through, 1);
  } finally {
    await f.team.closeMaintenance();
    await runtime.close();
  }
}));

test('startup skips context below the semantic threshold', () => withTeam(async f => {
  const data = semanticFixture(f, 'Short context');
  Object.assign(f.runtime, { runMaintenance: async () => { assert.fail('short context must not call the provider'); } });
  await f.team.startMaintenance();
  assert.equal(data.reads, 1);
  assert.equal(data.saved, undefined);
}));

test('publication and startup share one semantic job and covered context is not regenerated', () => withTeam(async f => {
  const data = semanticFixture(f);
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  Object.assign(f.runtime, { async runMaintenance(config: AgentConfiguration) {
    assert.equal(this, f.runtime); calls++; await gate; await data.submit(config); return terminal();
  } });
  await f.team.runner.postUser(f.workspaceId, 'Continue');
  const scan = f.team.startMaintenance();
  await settle();
  assert.equal(calls, 1);
  release(); await scan;
  f.runtime.end(f.lead.memberId); await settle();
  await f.team.runner.postUser(f.workspaceId, 'Continue again'); await settle();
  assert.equal(calls, 1, 'already indexed messages do not count toward the next threshold');
}));

test('failed semantic jobs are logged and remain eligible for the next publication', t => withTeam(async f => {
  const data = semanticFixture(f);
  const logs: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
  let calls = 0;
  Object.assign(f.runtime, { async runMaintenance(config: AgentConfiguration) {
    calls++; if (calls === 1) throw new Error('Fixture maintenance failure');
    await data.submit(config); return terminal();
  } });
  await f.team.startMaintenance();
  const afterFailure = data.saved;
  assert.equal(afterFailure, undefined);
  assert.match(JSON.stringify(logs), /Fixture maintenance failure/);
  await f.team.runner.postUser(f.workspaceId, 'Retry through publication'); await settle();
  assert.equal(calls, 2);
  assert.equal(data.saved?.revision, 1);
}));

test('maintenance completion without a successful submission is reported as failure', t => withTeam(async f => {
  const data = semanticFixture(f);
  const logs: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
  Object.assign(f.runtime, { runMaintenance: async () => terminal() });
  await f.team.startMaintenance();
  assert.equal(data.saved, undefined);
  assert.match(JSON.stringify(logs), /without an accepted semantic index/);
}));

test('shutdown cancels and drains startup maintenance without scheduling another job', () => withTeam(async f => {
  semanticFixture(f);
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  Object.assign(f.runtime, { async runMaintenance(_config: AgentConfiguration, _entries: unknown[], signal: AbortSignal) {
    calls++; started();
    await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); });
    return terminal('cancelled');
  } });
  const scan = f.team.startMaintenance();
  await ready; await f.team.closeMaintenance(); await scan;
  await f.team.runner.postUser(f.workspaceId, 'No new maintenance during shutdown'); await settle();
  assert.equal(calls, 1);
}));
