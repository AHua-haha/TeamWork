import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { withTeam, worker, configureHarness, code } from './team-fixture.js';
import { seedDesign } from './design-fixture.js';
import { implementationContextPart } from '../src/harness-bases.js';
const signal=()=>new AbortController().signal;

test('a system can use multiple design documents without creating subdesign systems; revisions cover all documents',()=>withTeam(async f=>{
 const base=await f.workspaces.context(f.workspaceId);
 await base.save('backend/metadata.json','{"implementation":["src"]}',null,null);
 await base.save('backend/design/README.md','# Backend\n\n[Requests](request-flow.md)',null,null);
 const flow=await base.save('backend/design/request-flow.md','# Requests\nInputs, output and effects.',null,null);
 const before=await f.team.designs.read(f.workspaceId,'backend/metadata.json');
 assert.equal(before.documents.length,2);assert.equal(before.documents[0]!.path,'backend/design/README.md');
 assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs.map(d=>d.path),['backend/metadata.json','metadata.json']);
 await base.save(flow.path,'# Requests\nUpdated behavior.',flow.revision,null);
 const after=await f.team.designs.read(f.workspaceId,'backend/metadata.json');assert.notEqual(after.revision,before.revision);
 await seedDesign(f.workspaces,f.workspaceId,'backend/storage/metadata.json',{content:'# Storage',implementation:['db']});
 assert.equal((await f.team.designs.list(f.workspaceId)).designs.length,3,'only an explicit child metadata record introduces a child system');
}));

test('invalid metadata, mixed document forms and missing directory entries never grant authority',()=>withTeam(async f=>{
 const base=await f.workspaces.context(f.workspaceId);
 await base.save('bad/metadata.json','{"content":"old","implementation":["."]}',null,null);
 assert.equal((await f.team.designs.inspect(f.workspaceId,'bad/metadata.json')).design,null);
 await seedDesign(f.workspaces,f.workspaceId,'mixed/metadata.json',{content:'# Single',implementation:[]});
 await base.save('mixed/design/README.md','# Directory',null,null);
 assert.match((await f.team.designs.inspect(f.workspaceId,'mixed/metadata.json')).designIssue!,/never both/);
 const single=await base.read({path:'mixed/design.md'});await base.delete(single.path,single.revision,null);
 const resolved=await f.team.designs.read(f.workspaceId,'mixed/metadata.json');assert.equal(resolved.documents.length,1);
 await base.save('mixed/design/data.json','{}',null,null);
 assert.match((await f.team.designs.inspect(f.workspaceId,'mixed/metadata.json')).designIssue!,/Markdown/);
 await base.save('missing/metadata.json','{"implementation":[]}',null,null);
 await base.save('missing/design/details.md','# Details',null,null);
 assert.match((await f.team.designs.inspect(f.workspaceId,'missing/metadata.json')).designIssue!,/README/);
}));

test('exact-node authority covers both forms without inheriting children or editable dependencies',()=>withTeam(async f=>{
 const parent=await worker(f,'Parent',[]),reference=parent.harness.designScope.working[0]!;
 const prefix=reference.slice(0,-'metadata.json'.length);
 await seedDesign(f.workspaces,f.workspaceId,prefix+'child/metadata.json',{content:'# Child',implementation:[]});
 const dependency=await worker(f,'Dependency',[]);
 await configureHarness(f,'Parent',{designScope:{working:[reference],dependencies:dependency.harness.designScope.working},allowedCommands:[]});
 const files=await f.team.harness.files(parent.memberId);
 await files.write.mkdir(join(files.root,'.rsi/context',prefix,'impl'));
 await files.write.writeFile(join(files.root,'.rsi/context',prefix,'impl/README.md'),'# Implemented contract');
 await files.write.writeFile(join(files.root,'.rsi/context',prefix,'impl/runtime.md'),'Runtime facts');
 await assert.rejects(files.write.writeFile(join(files.root,'.rsi/context',prefix,'child/impl.md'),'no'),code('not_found'));
 const depPrefix=dependency.harness.designScope.working[0]!.slice(0,-'metadata.json'.length);
 await assert.rejects(files.write.mkdir(join(files.root,'.rsi/context',depPrefix,'impl')),code('access_denied'));
 const staged=await f.team.harness.bash(parent.memberId,{command:'git add . && git commit -m "Document runtime"',metadata:{git:{scope:implementationContextPart(reference).id}}},signal());
 assert.equal(staged.exitCode,0,staged.stderr);
}));

test('lead design Git never captures implementation context, including newly created nodes',()=>withTeam(async f=>{
 const files=await f.team.harness.files(f.lead.memberId),env=await f.team.harness.environment(f.lead.memberId);
 await files.write.mkdir(join(files.root,'.rsi/context/new/design'));
 await files.write.writeFile(join(files.root,'.rsi/context/new/metadata.json'),'{"implementation":["src"]}');
 await files.write.writeFile(join(files.root,'.rsi/context/new/design/README.md'),'# New system');
 await files.write.writeFile(join(files.root,'.rsi/context/new/design/flow.md'),'Flow contract');
 // Simulate independently maintained implementation context beside a newly created design.
 await mkdir(join(files.root,'.rsi/context/new/impl'));await writeFile(join(files.root,'.rsi/context/new/impl/README.md'),'PRIVATE IMPLEMENTATION FACT');
 const stage=await f.team.harness.bash(f.lead.memberId,{command:'git add . && git diff --cached && git status --porcelain',metadata:{git:{scope:'design'}}},signal());
 assert.equal(stage.exitCode,0,stage.stderr);assert.doesNotMatch(stage.stdout,/PRIVATE IMPLEMENTATION FACT|new\/impl/);
 const review=(await f.team.harness.inspect(f.lead.memberId)).parts.find(p=>p.state.part.id==='design')!;
 assert.ok((await env.history.paths(review.revision)).every(path=>!path.includes('/impl/')&&!path.endsWith('/impl.md')));
 await f.team.harness.commit(f.lead.memberId,'design','Accept new system',{type:'user',memberId:f.lead.memberId},review.revision,review.state.committed);
 const accepted=await f.team.designs.read(f.workspaceId,'new/metadata.json');assert.equal(accepted.documents.length,2);assert.deepEqual(accepted.implementation,['src']);
 assert.equal((await f.team.designs.list(f.workspaceId)).designs.length,2);
}));

test('implementation context transitions keep one scope history and refuse ambiguous semantic commits',()=>withTeam(async f=>{
 const id=f.lead.memberId,part=implementationContextPart('metadata.json'),files=await f.team.harness.files(id);
 const git=(command:string)=>f.team.harness.bash(id,{command,metadata:{git:{scope:part.id}}},signal());
 await files.write.mkdir(join(files.root,'.rsi/context/impl'));
 await files.write.writeFile(join(files.root,'.rsi/context/impl/README.md'),'# Current implementation');
 const denied=await git('git add . && git commit -m "Ambiguous"');assert.notEqual(denied.exitCode,0);assert.match(denied.stderr,/never both/);
 assert.equal((await git('git rm .rsi/context/impl.md && git add . && git commit -m "Expand implementation context"')).exitCode,0);
 const history=await f.team.harness.history(id,part.id);assert.ok(history.some(item=>item.kind==='commit'));
 const peer=await f.team.service.create(f.workspaceId,{name:'Replacement',role:'developer',responsibility:'Continue',settings:{},harness:{designScope:{working:['metadata.json'],dependencies:[]},allowedCommands:[]}});
 const next=await f.team.harness.files(peer.memberId);assert.match((await next.read.readFile(join(next.root,'.rsi/context/impl/README.md'))).toString(),/Current implementation/);
}));

test('raw file operations refuse mixed node-folder mutation and retain history in the unified tree',()=>withTeam(async f=>{
 const base=await f.workspaces.context(f.workspaceId);
 await seedDesign(f.workspaces,f.workspaceId,'api/metadata.json',{content:'# API',implementation:[]});
 await mkdir(join(f.directory,'.rsi/context/api/impl'));await writeFile(join(f.directory,'.rsi/context/api/impl/README.md'),'# Implementation');
 await base.overview();
 await assert.rejects(base.move('api','renamed',undefined,null),code('read_only'));
 await assert.rejects(base.delete('api',undefined,null),code('read_only'));
 assert.equal((await base.read({path:'api/design.md'})).content,'# API');
 assert.deepEqual(Object.keys(await base.overview()).sort(),['bytes','files','problems','seq','workspaceId']);
 await rm(join(f.directory,'.rsi/context/api/impl'),{recursive:true});
 const renamed=await base.move('api','API',undefined,null);assert.ok(renamed.moved.some(file=>file.to==='API/design.md'));
}));

test('case-insensitive node references preserve actual node/document spelling in a member worktree',()=>withTeam(async f=>{
 await seedDesign(f.workspaces,f.workspaceId,'Backend/metadata.json',{content:'# Backend',implementation:[]});
 const member=await f.team.service.create(f.workspaceId,{name:'Case worker',role:'developer',settings:{},harness:{designScope:{working:['backend/metadata.json'],dependencies:[]},allowedCommands:[]}});
 const files=await f.team.harness.files(member.memberId);
 await files.write.writeFile(join(files.root,'.rsi/context/Backend/impl.md'),'# Implementation facts');
 const scope=implementationContextPart('Backend/metadata.json');
 const result=await f.team.harness.bash(member.memberId,{command:'git add . && git commit -m "Document Backend"',metadata:{git:{scope:scope.id}}},signal());
 assert.equal(result.exitCode,0,result.stderr);
 assert.equal((await f.team.designs.read(f.workspaceId,'backend/metadata.json')).documents[0]!.path,'Backend/design.md');
}));

test('unresolvable safe assignments remain inspectable but cannot run or gain context authority',()=>withTeam(async f=>{
 await configureHarness(f,'Lead',{designScope:{working:['missing-record.json'],dependencies:[]},allowedCommands:[]});
 const inspection=await f.team.inspect(f.workspaceId,f.lead.memberId);
 assert.equal(inspection.member.ready,false);assert.match(inspection.member.issues.join(' '),/metadata.json/);
 assert.ok(!inspection.harnesses.flatMap(h=>h.parts).some(p=>p.id.startsWith('impl-context-')));
 await assert.rejects(f.team.harness.files(f.lead.memberId),code('invalid_path'));
}));
