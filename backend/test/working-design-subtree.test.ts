import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {resolveAssignment} from '../src/core/team/member-workspace.js';
import {seedDesign} from './design-fixture.js';
import {configureAssignment,withTeam,worker} from './team-fixture.js';

test('working source subtrees contain descendant design systems exactly once and exclude similarly named siblings',()=>withTeam(async f=>{
 const member=await worker(f,'Backend',[]),parent=member.designScope.working[0]!;
 const child=await seedDesign(f.workspaces,f.workspaceId,'systems/backend/auth/_ctx/DESIGN.md',{content:'# Auth',implementation:[]});
 const grandchild=await seedDesign(f.workspaces,f.workspaceId,'systems/backend/auth/cache/_ctx/DESIGN.md',{content:'# Cache',implementation:[]});
 await seedDesign(f.workspaces,f.workspaceId,'systems/backend-extra/_ctx/DESIGN.md',{content:'# Sibling',implementation:[]});
 await configureAssignment(f,'Backend',{designScope:{working:[parent,child],dependencies:[]}});
 const resolved=await resolveAssignment(f.team.designs,f.workspaceId,(await f.team.service.find(member.memberId))!.value.designScope);
 assert.deepEqual(resolved.working.map(d=>d.path),['systems/backend/_ctx/DESIGN.md',child,grandchild]);
}));

test('an explicit refresh sees new filesystem designs without Git acceptance or member reactivation',()=>withTeam(async f=>{
 const member=await worker(f,'Backend',[]),before=await f.team.member(f.workspaceId,member.memberId);
 await mkdir(join(f.directory,'systems/backend/new'),{recursive:true});
 await mkdir(join(f.directory,'.rsi/project/systems/backend/new/_ctx'),{recursive:true});
 await writeFile(join(f.directory,'.rsi/project/systems/backend/new/_ctx/DESIGN.md'),'# New filesystem design');
 assert.equal((await resolveAssignment(f.team.designs,f.workspaceId,before.designScope)).working.length,1);
 await f.team.designs.refresh(f.workspaceId);
 assert.equal((await resolveAssignment(f.team.designs,f.workspaceId,before.designScope)).working.length,2);
 assert.equal((await f.team.member(f.workspaceId,member.memberId)).revision,before.revision);
}));

test('dependency selection stays explicit while working scope expands recursively',()=>withTeam(async f=>{
 const member=await worker(f,'Backend',[]);
 const dependency=await seedDesign(f.workspaces,f.workspaceId,'contracts/_ctx/DESIGN.md',{content:'# Contracts',implementation:[]});
 await seedDesign(f.workspaces,f.workspaceId,'contracts/child/_ctx/DESIGN.md',{content:'# Child',implementation:[]});
 await configureAssignment(f,'Backend',{designScope:{working:member.designScope.working,dependencies:[dependency]}});
 const resolved=await resolveAssignment(f.team.designs,f.workspaceId,(await f.team.service.find(member.memberId))!.value.designScope);
 assert.deepEqual(resolved.dependencies.map(d=>d.path),[dependency]);
}));
