import {acceptFiles} from './git-fixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StepScope } from '../src/core/team/runtime.js';
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
  assert.deepEqual((await f.team.service.get(f.workspaceId, f.lead.memberId)).harness.implementationScope.paths, [], 'pending child does not expand the root assignment');
  await acceptFiles(f,'.rsi/context/design','Accept project');
  assert.equal((await f.team.designs.read(f.workspaceId, 'new/metadata.json')).content, 'Pending project');
  assert.deepEqual((await f.team.service.get(f.workspaceId, f.lead.memberId)).harness.implementationScope.paths, ['src'], 'root-assigned lead inherits the accepted child mapping');
  assert.equal((await f.team.service.team(f.workspaceId)).members.length, 1, 'member file edits do not activate settings');
}));
