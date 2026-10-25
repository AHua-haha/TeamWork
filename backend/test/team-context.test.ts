import { seedDesign } from './design-fixture.js';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ModelRequest, RuntimePolicy, StepScope } from '../src/core/agent/runtime.js';
import { viewBudget } from '../src/core/harness/harness.js';
import { configureHarness, withTeam, worker } from './team-fixture.js';

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
  assert.doesNotMatch(request.context.systemPrompt!, /BACKEND SOURCE/);
  assert.match(request.context.systemPrompt!, /Resolved permissions/);
  assert.doesNotMatch(request.context.systemPrompt!, /FRONTEND SOURCE|Design for Frontend/);
  assert.match(request.context.systemPrompt!, /commits wait for user|waits for user approval/);
  assert.match(request.context.systemPrompt!, /standing words/);
  assert.deepEqual(names(request).sort(), ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'web_fetch', 'web_search', 'write']);
  assert.deepEqual(request.context.tools!.map(tool => tool.name), names(request));
  const inspected = await fixture.team.inspect(fixture.workspaceId, backend.memberId);
  assert.deepEqual(inspected.harnesses.find(h => h.id === 'execute')!.tools, ['bash', 'web_search', 'web_fetch']);
  assert.match(request.context.systemPrompt!, /outbound networking and local server binding/);
  assert.match(request.context.systemPrompt!, /<metadata>/);
  assert.match(request.context.systemPrompt!, /<mentions>/);
  assert.match(request.context.systemPrompt!, /omit the entire block/);
  assert.doesNotMatch(request.context.systemPrompt!, /Mention tokens are routing instructions even inside/);
}));
test('the lead receives design maintenance, choices and management tools with shared assignment instructions', () => withTeam(async fixture => {
  const request = await fixture.team.policy(base).buildRequest(scope(fixture.lead.memberId), { revision: 0, entries: [] });
  assert.deepEqual(names(request).sort(), ['bash', 'edit', 'find', 'grep', 'list_models', 'ls', 'read', 'validate_member_config', 'web_fetch', 'web_search', 'write']);
  assert.match(request.context.systemPrompt!, /offer concrete choices with their tradeoffs and your recommendation/);
  assert.match(request.context.systemPrompt!, /wait for the user's answer/);
  assert.match(request.context.systemPrompt!, /Assign work in your final group response/);
  assert.match(request.context.systemPrompt!, /design\/member-only waits for user approval/);
  await seedDesign(fixture.workspaces, fixture.workspaceId, 'metadata.json', { content: 'Project', implementation: ['.'] });
  await configureHarness(fixture, 'Lead', { designScope: { working: ['metadata.json'], dependencies: [] }, allowedCommands: [{ kind: 'executable', executable: 'bash' }] });
  const configured = await fixture.team.policy(base).buildRequest(scope(fixture.lead.memberId), { revision: 0, entries: [] });
  for (const name of ['write', 'edit', 'bash']) assert.ok(names(configured).includes(name));
}));
test('source files are loaded on demand and unrelated catalog tools are not injected', () => withTeam(async fixture => {
  const member = await worker(fixture, 'Backend', ['backend']);
  await mkdir(join(fixture.directory, 'backend'));
  await writeFile(join(fixture.directory, 'backend', 'a.txt'), 'a'.repeat(viewBudget - 10));
  await writeFile(join(fixture.directory, 'backend', 'b.txt'), 'b'.repeat(100));
  const unscoped = { definition: { name: 'unscoped', description: '', parameters: {} as never }, execute: async () => ({ content: [], isError: false }) };
  const policy = fixture.team.policy({ buildRequest: () => ({ model: {} as never, tools: [unscoped], context: { messages: [] } }) });
  const request = await policy.buildRequest(scope(member.memberId), { revision: 0, entries: [] });
  assert.doesNotMatch(request.context.systemPrompt!, /a{100}|b{100}/);
  assert.doesNotMatch(request.context.systemPrompt!, /### backend\/b.txt/);
  assert.ok(!names(request).includes('unscoped'));
  const plain = await policy.buildRequest(scope('plain-agent'), { revision: 0, entries: [] });
  assert.deepEqual(names(plain), ['unscoped']);
}));

for (const enforced of [true, false]) {
  test(`design-edit responsibility reaches actual lead and worker requests with enforcement ${enforced ? 'enabled' : 'disabled'}`, () => withTeam(async f => {
    const member = await worker(f, 'Backend', ['src']);
    const dependency = await worker(f, 'Storage', ['storage']);
    await seedDesign(f.workspaces, f.workspaceId, 'systems/backend/api/metadata.json', { content: 'Owned child API design', implementation: ['api'] });
    await configureHarness(f, 'Backend', {
      designScope: {working: member.harness.designScope.working, dependencies: dependency.harness.designScope.working}, allowedCommands: [],
    });
    for (const id of [member.memberId, f.lead.memberId]) {
      const request = await f.team.policy(base).buildRequest(scope(id), {revision: 0, entries: []});
      const prompt = request.context.systemPrompt!;
      assert.equal(prompt.split('## Design-edit responsibility').length - 1, 1);
      assert.match(prompt, /Every member may maintain and edit the design context of its assigned working designs/);
      assert.match(prompt, /accepted descendant designs/);
      assert.match(prompt, /Dependency designs remain read-only/);
      assert.match(prompt, /Report design changes in your shared response so the user is aware/);
      assert.match(prompt, /Editing a design is not evidence of user acceptance/);
      assert.match(prompt, /member configuration remains lead-managed/);
      assert.doesNotMatch(prompt, /Only the lead may edit the design tree|Other members can only read\/follow working and dependency designs|The lead alone can edit all design context/);
      assert.match(prompt, enforced ? /Resolved permissions/ : /operator has disabled harness permission enforcement/i);
      if (id === member.memberId) {
        assert.match(prompt, /Owned child API design/);
        assert.match(prompt, /Design for Storage/);
        assert.match(prompt, /For changes outside your working scope or an unsettled user decision/);
      } else {
        assert.match(prompt, /maintain the whole project design and its subdesigns/);
      }
    }
  }, enforced));
}
