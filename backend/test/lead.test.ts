import {acceptFiles} from './git-fixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StepScope } from '../src/core/agent/runtime.js';
import { withTeam } from './team-fixture.js';

const scope = (agentId: string) => ({ agentId, runId: 'lead-run', signal: new AbortController().signal } as StepScope);

test('lead bootstraps pending designs and member files through common tools; file edits remain separate from design acceptance and member activation', () => withTeam(async f => {
  const {writeFile, mkdir} = await import('node:fs/promises');
  const {join, dirname} = await import('node:path');
  const call = async (_name: string, args: {path: string; content: string}) => {const target=join(f.directory,args.path); await mkdir(dirname(target),{recursive:true}); await writeFile(target,args.content);};
  await call('write', { path: '.rsi/context/design/new/metadata.json', content: JSON.stringify({ implementation: ['src'] }) });
  await call('write', { path: '.rsi/context/design/new/design.md', content: 'Pending project' });
  await call('write', { path: '.rsi/members/example/member.json', content: '{"name":"Example"}' });
  assert.deepEqual((await f.team.service.get(f.workspaceId, f.lead.memberId)).harness.implementationScope.paths, [], 'pending child does not expand the root assignment');
  await acceptFiles(f,'.rsi/context/design','Accept project');
  assert.equal((await f.team.designs.read(f.workspaceId, 'new/metadata.json')).content, 'Pending project');
  assert.deepEqual((await f.team.service.get(f.workspaceId, f.lead.memberId)).harness.implementationScope.paths, ['src'], 'root-assigned lead inherits the accepted child mapping');
  assert.equal((await f.team.service.team(f.workspaceId)).members.length, 1, 'member file edits do not activate settings');
}));
