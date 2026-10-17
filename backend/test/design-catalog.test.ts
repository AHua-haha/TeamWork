import assert from 'node:assert/strict';
import { test } from 'node:test';
import { code, withTeam, worker } from './team-fixture.js';
import { seedDesign } from './design-fixture.js';

test('catalog discovers valid system metadata independently of members and reports malformed nodes through inspection',()=>withTeam(async f=>{
 const base=await f.workspaces.context(f.workspaceId);
 await base.save('notes.md','# Ordinary notes',null,null);
 await base.save('bad/metadata.json','{"content":"Old embedded content"}',null,null);
 await seedDesign(f.workspaces,f.workspaceId,'architecture/metadata.json',{content:'# Architecture',implementation:['src']});
 const backend=await worker(f,'Backend',['backend']);
 const catalog=await f.team.designs.list(f.workspaceId);
 assert.deepEqual(catalog.designs.map(d=>d.path),['architecture/metadata.json','metadata.json','systems/backend/metadata.json']);
 assert.equal(catalog.truncated,false);
 assert.deepEqual(catalog.designs[0]!.implementation,['src']);
 await f.team.runner.retire(f.workspaceId,backend.memberId,backend.revision);
 assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs,catalog.designs);
 const invalid=await f.team.designs.inspect(f.workspaceId,'bad/metadata.json');assert.equal(invalid.design,null);assert.ok(invalid.designIssue);
 const valid=await f.team.designs.read(f.workspaceId,'architecture/metadata.json');
 assert.equal(valid.content,'# Architecture');assert.deepEqual(valid.documents,[{path:'architecture/design.md',content:'# Architecture'}]);
 const metadata=await base.read({path:'architecture/metadata.json'});await base.delete(metadata.path,metadata.revision,null);
 await assert.rejects(f.team.designs.inspect(f.workspaceId,metadata.path),code('not_found'));
 assert.equal((await f.team.designs.list(f.workspaceId)).designs.length,2);
}));
