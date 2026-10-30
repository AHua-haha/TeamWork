import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {TeamSystem} from '../src/core/team/team-system.js';
import {testModels} from './memory-store.js';
import {stubConfig,withTeam} from './team-fixture.js';

test('fresh workspace has exact active lead files and activation baseline without context history',()=>withTeam(async f=>{
 const lead=await f.team.member(f.workspaceId,f.lead.memberId);
 assert.equal(lead.ready,true);assert.deepEqual(lead.designScope,{working:['_ctx/DESIGN.md'],dependencies:[]});
 assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs.map(d=>d.path),['_ctx/DESIGN.md']);
 const source=await f.team.configuration.accepted(f.workspaceId,lead.memberId);
 for(const [path,text]of Object.entries(source.files))assert.equal(await readFile(join(f.directory,'.rsi/members/Lead',path),'utf8'),text);
 assert.deepEqual((await readdir(join(f.directory,'.rsi'))).sort(),['members','project']);
 const view=await f.team.currentConfiguration(f.workspaceId);
 assert.equal(view.status.valid,true);assert.equal(view.status.hasPending,false);assert.equal(view.activation.hasChanges,false);
 assert.equal(view.active.revision,source.acceptedRevision);assert.equal(f.runtime.runs.length,0);
 assert.equal('loadContext' in f.store,false);
 await writeFile(join(f.directory,'.rsi/members/Lead/prompts/member.md'),'Pending prompt');
 const restarted=new TeamSystem(f.store,f.workspaces,stubConfig);restarted.attach(f.runtime);
 try{await restarted.initialize();assert.equal((await restarted.currentConfiguration(f.workspaceId)).status.hasPending,true);assert.equal((await restarted.currentConfiguration(f.workspaceId)).active.revision,view.active.revision);}finally{await restarted.runner.close();}
}));

test('adoption preserves current context bytes and creates a ready root-design lead without importing documents',()=>withTeam(async f=>{
 const directory=join(f.folder,'adopted');
 for(const path of ['.rsi/adopted/_ctx','.rsi/adopted/src/api/_ctx','src/api'])await mkdir(join(directory,path),{recursive:true});
 await writeFile(join(directory,'.rsi/adopted/_ctx/DESIGN.md'),'# Preserved project');
 await writeFile(join(directory,'.rsi/adopted/src/api/_ctx/DESIGN.md'),'# Preserved API');
 const workspace=await f.workspaces.create({name:'Adopted',directory,models:testModels(),adopt:true});
 const roster=await f.team.team(workspace.workspaceId);assert.equal(roster.members.length,1);assert.equal(roster.members[0]!.ready,true);
 assert.equal(await readFile(join(directory,'.rsi/adopted/src/api/_ctx/DESIGN.md'),'utf8'),'# Preserved API');
 assert.deepEqual((await f.team.designs.list(workspace.workspaceId)).designs.map(d=>d.path),['_ctx/DESIGN.md','src/api/_ctx/DESIGN.md']);
 const view=await f.team.currentConfiguration(workspace.workspaceId);assert.equal(view.status.valid,true);assert.equal(view.status.hasPending,false);
}));
