import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ModelRequest, RuntimePolicy, StepScope } from '../src/runtime.js';
import { viewBudget } from '../src/member-context.js';
import { withTeam, worker, type Fixture } from './team-fixture.js';

async function put(fixture: Fixture, path: string, content: string) {
  const target = join(fixture.directory, '.context', path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
}
const names = (request: ModelRequest) => request.tools.map(tool => tool.definition.name);
const scope = (agentId: string): StepScope => ({ agentId, runId: 'r', step: 1, signal: new AbortController().signal, config: { systemPrompt: 'standing words' } } as unknown as StepScope);

test('a worker is told its role, the team, the user context, and only its own scope', () => withTeam(async fixture => {
  await put(fixture, 'user/spec.md', 'THE GOAL: a reading list');
  await put(fixture, 'agent/systems/backend/plan.md', 'BACKEND PLAN');
  await put(fixture, 'agent/systems/frontend/plan.md', 'FRONTEND PLAN');
  const backend = await worker(fixture, 'Backend', ['agent/systems/backend'], 'backend developer');
  await fixture.team.service.create(fixture.workspaceId, { name: 'Idle', role: 'reviewer', settings: { connectionId: null, modelId: null } });

  const text = (await fixture.team.context.instructions(backend.memberId, 'standing words'))!;
  assert.match(text, /You are Backend, backend developer on the team of the workspace "Project"/);
  assert.match(text, /Your responsibility: Owns Backend/);
  assert.match(text, /- Lead \(Lead\): Works with the user/);
  assert.match(text, /- Backend \(backend developer\), you: Owns Backend/);
  assert.match(text, /- Idle \(reviewer\): no responsibility given \[cannot run yet: Select a provider and model\]/);
  assert.match(text, /### \.context\/user\/spec\.md\nTHE GOAL: a reading list/);
  assert.match(text, /### \.context\/agent\/systems\/backend\/plan\.md\nBACKEND PLAN/);
  assert.match(text, /## Your instructions\nstanding words/);
  assert.doesNotMatch(text, /FRONTEND PLAN/);
  assert.doesNotMatch(text, /Agent context files/);
  assert.match(text, /The lead talks to the user and changes the team/);
  assert.equal(await fixture.team.context.instructions('not-a-member', 'x'), null);
}));

test('the lead gets a list of all agent context and the team rules for leads', () => withTeam(async fixture => {
  await put(fixture, 'agent/systems/backend/plan.md', 'BACKEND PLAN');
  await put(fixture, 'agent/systems/frontend/plan.md', 'FRONTEND PLAN');
  const text = (await fixture.team.context.instructions(fixture.lead.memberId, undefined))!;
  assert.match(text, /## Agent context files\n\.context\/agent\/systems\/backend\/plan\.md \(12 bytes\)\n\.context\/agent\/systems\/frontend\/plan\.md \(13 bytes\)/);
  assert.match(text, /create_member, update_member, and retire_member/);
  assert.match(text, /There are no user context files yet\./);
  assert.doesNotMatch(text, /BACKEND PLAN/, 'the lead scope is empty, so no agent file content is loaded');
  assert.doesNotMatch(text, /## Your instructions/);
}));

test('a section is cut at the budget and the rest is listed by path', () => withTeam(async fixture => {
  await put(fixture, 'user/a.md', 'a'.repeat(viewBudget - 10));
  await put(fixture, 'user/b.md', 'b'.repeat(100));
  const text = (await fixture.team.context.instructions(fixture.lead.memberId, undefined))!;
  assert.match(text, /### \.context\/user\/a\.md/);
  assert.doesNotMatch(text, /### \.context\/user\/b\.md/);
  assert.match(text, /Not shown \(too large for this view; read them with your tools\): \.context\/user\/b\.md/);
}));

test('the policy gives members their tools and instructions and leaves other agents alone', () => withTeam(async fixture => {
  const base: RuntimePolicy = { buildRequest: () => ({ model: {} as never, tools: [], context: { messages: [], tools: [], systemPrompt: 'base' } }) };
  const policy = fixture.team.policy(base);
  const backend = await worker(fixture, 'Backend');

  const leadRequest = await policy.buildRequest(scope(fixture.lead.memberId), { revision: 0, entries: [] });
  assert.deepEqual(names(leadRequest).sort(), ['create_member', 'edit', 'list_models', 'ls', 'read', 'retire_member', 'send_message', 'update_member', 'write']);
  assert.deepEqual(leadRequest.context.tools!.map(tool => tool.name), names(leadRequest));
  assert.match(leadRequest.context.systemPrompt!, /You are Lead, Lead on the team/);
  assert.match(leadRequest.context.systemPrompt!, /## Your instructions\nstanding words/);

  const workerRequest = await policy.buildRequest(scope(backend.memberId), { revision: 0, entries: [] });
  assert.deepEqual(names(workerRequest).sort(), ['edit', 'ls', 'read', 'send_message', 'write']);

  // The instructions may only name tools the member really has.
  const named = (prompt: string) => ['ls', 'read', 'edit', 'write', 'send_message', 'create_member', 'update_member', 'retire_member', 'list_files', 'read_file', 'search_files', 'edit_file', 'write_file'].filter(tool => new RegExp(`\\b${tool}\\b`).test(prompt));
  for (const request of [leadRequest, workerRequest]) for (const tool of named(request.context.systemPrompt!)) assert.ok(names(request).includes(tool), `${tool} is named in the instructions but is not a tool of this member`);

  const plain = await policy.buildRequest(scope('plain-agent'), { revision: 0, entries: [] });
  assert.deepEqual([names(plain), plain.context.systemPrompt], [[], 'base']);
}));
