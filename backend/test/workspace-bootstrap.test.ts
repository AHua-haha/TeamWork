import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { TeamSystem } from '../src/core/team/team-system.js';
import { testModels } from './memory-store.js';
import { code, stubConfig, withTeam } from './team-fixture.js';

test('new workspace has a ready root-design lead, exact active files and clean bootstrap history before any agent runs', () => withTeam(async f => {
  const lead = await f.team.member(f.workspaceId, f.lead.memberId);
  assert.equal(lead.ready,true); assert.deepEqual(lead.harness.designScope,{working:['metadata.json'],dependencies:[]});
  assert.deepEqual(lead.harness.implementationScope,{paths:[],usePaths:[]}); assert.deepEqual(lead.harness.allowedCommands,[]);
  assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs.map(d=>d.path),['metadata.json']);
  const source = await f.team.configuration.accepted(f.workspaceId,lead.memberId);
  for (const [path, content] of Object.entries(source.files)) assert.equal(await readFile(join(f.directory,'.rsi/members',lead.name,path),'utf8'),content);
  assert.deepEqual((await readdir(join(f.directory,'.rsi'))).sort(),['context','members']);
  const view = await f.team.currentConfiguration(f.workspaceId);
  assert.equal(view.status.valid,true); assert.equal(view.status.hasPending,false); assert.equal(view.status.commits.length,0);
  assert.equal(view.activation.valid,true); assert.equal(view.activation.hasChanges,false); assert.deepEqual(view.changes,[]);
  assert.equal(view.active.revision,source.acceptedRevision); assert.equal(f.runtime.runs.length,0);
  const files = await f.team.memberWorkspace.files(lead.memberId);
  assert.match((await files.read.readFile(join(files.root,'.rsi/context/design/metadata.json'))).toString(),/implementation/);
  await assert.rejects(files.read.readFile(join(files.root,'.rsi/harness/objects')),code('ENOENT'));
  assert.equal((await f.workspaces.files(f.workspaceId)).constructor.name,'ProjectFiles');
  assert.ok(!(await (await f.workspaces.files(f.workspaceId)).tree('',1)).entries.some(entry=>entry.path==='.rsi'));
  await files.write.writeFile(join(files.root,'.rsi/members',lead.name,'prompts/member.md'),'Pending after bootstrap');
  const reopened = new TeamSystem(f.store,f.workspaces,stubConfig); reopened.attach(f.runtime);
  try {
    await reopened.initialize();
    assert.equal((await reopened.currentConfiguration(f.workspaceId)).status.hasPending,true);
    assert.equal((await reopened.currentConfiguration(f.workspaceId)).active.revision,view.active.revision);
    assert.equal((await reopened.configuration.accepted(f.workspaceId,lead.memberId)).files['prompts/member.md'],source.files['prompts/member.md']);
  } finally { await reopened.runner.close(); }
}));


test('adopted context gives the fresh lead its existing recursive design mappings and a clean configuration baseline', () => withTeam(async f => {
  const directory=join(f.directory,'..','adopted');
  for(const path of ['.rsi/context/design/api','src/root','src/api'])await mkdir(join(directory,path),{recursive:true});
  await writeFile(join(directory,'.rsi/context/design/metadata.json'),JSON.stringify({implementation:['src/root']}));
  await writeFile(join(directory,'.rsi/context/design/design.md'),'# Preserved project');
  await writeFile(join(directory,'.rsi/context/design/api/metadata.json'),JSON.stringify({implementation:['src/api']}));
  await writeFile(join(directory,'.rsi/context/design/api/design.md'),'# Preserved API');
  const workspace=await f.workspaces.create({name:'Adopted',directory,adopt:true,models:testModels()});
  const roster=await f.team.team(workspace.workspaceId);
  assert.equal(roster.members.length,1);
  const lead=roster.members[0]!;
  assert.equal(lead.lead,true); assert.equal(lead.ready,true);
  assert.deepEqual(lead.harness.designScope,{working:['metadata.json'],dependencies:[]});
  assert.deepEqual([...lead.harness.implementationScope.paths].sort(),['src/api','src/root']);
  const view=await f.team.currentConfiguration(workspace.workspaceId);
  assert.equal(view.status.valid,true);assert.equal(view.status.hasPending,false);
  assert.equal(view.activation.valid,true);assert.equal(view.activation.hasChanges,false);
  assert.deepEqual(view.changes,[]);
  assert.deepEqual((await f.team.designs.list(workspace.workspaceId)).designs.map(d=>d.path).sort(),['api/metadata.json','metadata.json']);
}));
