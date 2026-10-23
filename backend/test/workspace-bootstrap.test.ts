import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { TeamSystem } from '../src/core/team/team-system.js';
import { code, stubConfig, withTeam } from './team-fixture.js';

test('new workspace has a ready root-design lead, exact active files and clean bootstrap history before any agent runs', () => withTeam(async f => {
  const lead = await f.team.member(f.workspaceId, f.lead.memberId);
  assert.equal(lead.ready,true); assert.deepEqual(lead.harness.designScope,{working:['metadata.json'],dependencies:[]});
  assert.deepEqual(lead.harness.implementationScope,{paths:[],usePaths:[]}); assert.deepEqual(lead.harness.allowedCommands,[]);
  assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs.map(d=>d.path),['metadata.json']);
  const source = await f.team.configuration.accepted(f.workspaceId,lead.memberId);
  for (const [path, content] of Object.entries(source.files)) assert.equal(await readFile(join(f.directory,'.rsi/members',lead.memberId,path),'utf8'),content);
  assert.deepEqual((await readdir(join(f.directory,'.rsi'))).sort(),['context','members']);
  const view = await f.team.currentConfiguration(f.workspaceId);
  assert.equal(view.status.valid,true); assert.equal(view.status.hasPending,false); assert.equal(view.status.commits.length,0);
  assert.equal(view.activation.valid,true); assert.equal(view.activation.hasChanges,false); assert.deepEqual(view.changes,[]);
  assert.equal(view.active.revision,source.acceptedRevision); assert.equal(f.runtime.runs.length,0);
  const files = await f.team.harness.files(lead.memberId);
  assert.match((await files.read.readFile(join(files.root,'.rsi/context/design/metadata.json'))).toString(),/implementation/);
  await assert.rejects(files.read.readFile(join(files.root,'.rsi/harness/objects')),code('not_found'));
  assert.equal((await f.workspaces.files(f.workspaceId)).constructor.name,'ProjectFiles');
  assert.ok(!(await (await f.workspaces.files(f.workspaceId)).tree('',1)).entries.some(entry=>entry.path==='.rsi'));
  await files.write.writeFile(join(files.root,'.rsi/members',lead.memberId,'prompts/member.md'),'Pending after bootstrap');
  const reopened = new TeamSystem(f.store,f.workspaces,stubConfig); reopened.attach(f.runtime);
  try {
    await reopened.initialize();
    assert.equal((await reopened.currentConfiguration(f.workspaceId)).status.hasPending,true);
    assert.equal((await reopened.currentConfiguration(f.workspaceId)).active.revision,view.active.revision);
    assert.equal((await reopened.configuration.accepted(f.workspaceId,lead.memberId)).files['prompts/member.md'],source.files['prompts/member.md']);
  } finally { await reopened.runner.close(); }
}));
