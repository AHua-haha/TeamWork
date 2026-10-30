import assert from 'node:assert/strict';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {withTeam,worker} from './team-fixture.js';
import {seedDesign} from './design-fixture.js';

test('design catalog follows current source-bound DESIGN entries, independently of member lifetime and Git commits',()=>withTeam(async f=>{
 await seedDesign(f.workspaces,f.workspaceId,'architecture/_ctx/DESIGN.md',{content:'# Architecture',implementation:[]});
 const backend=await worker(f,'Backend',[]);
 const catalog=await f.team.designs.list(f.workspaceId);
 assert.deepEqual(catalog.designs.map(d=>d.path),['_ctx/DESIGN.md','architecture/_ctx/DESIGN.md','systems/backend/_ctx/DESIGN.md']);
 await f.team.runner.retire(f.workspaceId,backend.memberId,backend.revision);
 assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs,catalog.designs);
 await writeFile(join(f.directory,'.rsi/project/architecture/_ctx/DESIGN.md'),'# Current uncommitted architecture');
 assert.equal((await f.team.designs.read(f.workspaceId,'architecture/_ctx/DESIGN.md')).content,'# Current uncommitted architecture');
 await rm(join(f.directory,'.rsi/project/architecture/_ctx/DESIGN.md'));
 await f.team.designs.refresh(f.workspaceId);
 assert.equal((await f.team.designs.list(f.workspaceId)).designs.length,2);
 await mkdir(join(f.directory,'.rsi/project/missing/_ctx'),{recursive:true});
 await writeFile(join(f.directory,'.rsi/project/missing/_ctx/DESIGN.md'),'# No source node');
 const snapshot=await f.team.designs.refresh(f.workspaceId);
 assert.equal(snapshot.designSystems.missing,undefined);assert.ok(snapshot.diagnostics.some(d=>d.code==='unrepresented_node'));
}));
