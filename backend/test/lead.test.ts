import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StepScope } from '../src/runtime.js';
import { withTeam } from './team-fixture.js';

const scope = (agentId: string) => ({ agentId, runId: 'lead-run', signal: new AbortController().signal } as StepScope);

test('lead bootstraps pending designs and member files through common tools; design acceptance requires the user', () => withTeam(async f => {
  const prepared = await f.team.harness.prepare(f.lead.memberId, []);
  const call = async (name: string, args: Record<string, unknown>) => {
    const output = await prepared.tools.find(t => t.definition.name === name)!.execute(args as never, scope(f.lead.memberId), {} as never);
    return output.content.map(p => p.type === 'text' ? p.text : '').join('');
  };
  assert.deepEqual(prepared.tools.map(t => t.definition.name).sort(), ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'web_fetch', 'web_search', 'write']);
  await call('write', { path: '.rsi/context/design/new/metadata.json', content: JSON.stringify({ implementation: ['src'] }) });
  await call('write', { path: '.rsi/context/design/new/design.md', content: 'Pending project' });
  await call('write', { path: '.rsi/members/example/member.json', content: '{"name":"Example"}' });
  assert.match(await call('bash', { command: 'git add . && git commit -m "Define project"', metadata: { git: { scope: 'design' } } }), /approval_required/);
  const review = (await f.team.harness.inspect(f.lead.memberId)).parts.find(p => p.state.part.id === 'design')!;
  const accepted = await f.team.harness.commit(f.lead.memberId, 'design', 'Accept project', { type: 'user', memberId: f.lead.memberId }, review.revision, review.state.committed);
  assert.equal(accepted.actor.type, 'user');
  assert.equal((await f.team.designs.read(f.workspaceId, 'new/metadata.json')).content, 'Pending project');
  assert.deepEqual((await f.team.service.get(f.workspaceId, f.lead.memberId)).harness.implementationScope.paths, [], 'unassigned lead does not gain implementation access');
  assert.equal((await f.team.service.team(f.workspaceId)).members.length, 1, 'member file edits do not activate settings');
}));
