import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ModelRequest, RuntimePolicy, StepScope } from '../src/runtime.js';
import { viewBudget } from '../src/harness.js';
import { withTeam, worker } from './team-fixture.js';

const names = (request: ModelRequest) => request.tools.map(tool => tool.definition.name);
const scope = (agentId: string) => ({ agentId, runId: 'r', step: 1, signal: new AbortController().signal, config: { systemPrompt: 'standing words' } } as StepScope);
const base: RuntimePolicy = { buildRequest: () => ({ model: {} as never, tools: [], context: { messages: [], tools: [], systemPrompt: 'base' } }) };

test('member requests get team rules and only their harness design and implementation context', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['backend'], 'backend developer');
  await worker(fixture, 'Frontend', ['frontend']);
  await mkdir(join(fixture.directory, 'backend'));
  await mkdir(join(fixture.directory, 'frontend'));
  await writeFile(join(fixture.directory, 'backend', 'main.ts'), 'BACKEND SOURCE');
  await writeFile(join(fixture.directory, 'frontend', 'main.ts'), 'FRONTEND SOURCE');
  const request = await fixture.team.policy(base).buildRequest(scope(backend.memberId), { revision: 0, entries: [] });
  assert.match(request.context.systemPrompt!, /You are Backend, backend developer/);
  assert.match(request.context.systemPrompt!, /Design for Backend/);
  assert.match(request.context.systemPrompt!, /BACKEND SOURCE/);
  assert.doesNotMatch(request.context.systemPrompt!, /FRONTEND SOURCE|Design for Frontend/);
  assert.match(request.context.systemPrompt!, /never edit a working or dependency design/);
  assert.match(request.context.systemPrompt!, /standing words/);
  assert.deepEqual(names(request).sort(), ['edit', 'ls', 'read', 'send_message', 'write']);
  assert.deepEqual(request.context.tools!.map(tool => tool.name), names(request));
}));
test('the lead receives design maintenance, choices, configuration and assignment tools through the harness', () => withTeam(async fixture => {
  const request = await fixture.team.policy(base).buildRequest(scope(fixture.lead.memberId), { revision: 0, entries: [] });
  assert.deepEqual(names(request).sort(), ['assign_member', 'configure_harness', 'create_member', 'list_models', 'ls', 'read', 'read_design', 'retire_member', 'save_design', 'send_message', 'update_member']);
  assert.match(request.context.systemPrompt!, /offer concrete choices with their tradeoffs and your recommendation/);
  assert.match(request.context.systemPrompt!, /wait for the user's answer/);
  assert.match(request.context.systemPrompt!, /There are no context files yet/);
  await fixture.team.designs.save(fixture.workspaceId, 'user/design.json', { content: 'Project', implementation: ['.'] }, null, 'Test', { type: 'lead', memberId: fixture.lead.memberId, runId: 'r' });
  await fixture.team.lead.configureHarness(fixture.lead.memberId, 'Lead', { designScope: { working: ['user/design.json'], dependencies: [] }, allowedCommands: [{ kind: 'executable', executable: 'node' }] });
  const configured = await fixture.team.policy(base).buildRequest(scope(fixture.lead.memberId), { revision: 0, entries: [] });
  for (const name of ['write', 'edit', 'run_command']) assert.ok(names(configured).includes(name));
}));
test('bounded file context names omitted files and unrelated catalog tools are not injected', () => withTeam(async fixture => {
  const member = await worker(fixture, 'Backend', ['backend']);
  await mkdir(join(fixture.directory, 'backend'));
  await writeFile(join(fixture.directory, 'backend', 'a.txt'), 'a'.repeat(viewBudget - 10));
  await writeFile(join(fixture.directory, 'backend', 'b.txt'), 'b'.repeat(100));
  const unscoped = { definition: { name: 'unscoped', description: '', parameters: {} as never }, execute: async () => ({ content: [], isError: false }) };
  const policy = fixture.team.policy({ buildRequest: () => ({ model: {} as never, tools: [unscoped], context: { messages: [] } }) });
  const request = await policy.buildRequest(scope(member.memberId), { revision: 0, entries: [] });
  assert.match(request.context.systemPrompt!, /Not loaded: backend\/b.txt/);
  assert.doesNotMatch(request.context.systemPrompt!, /### backend\/b.txt/);
  assert.ok(!names(request).includes('unscoped'));
  const plain = await policy.buildRequest(scope('plain-agent'), { revision: 0, entries: [] });
  assert.deepEqual(names(plain), ['unscoped']);
}));
