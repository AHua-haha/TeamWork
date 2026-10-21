import { acceptFiles,initGit } from './git-fixture.js';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { withTeam, worker, configureHarness, code } from './team-fixture.js';
import { seedDesign } from './design-fixture.js';
import { implementationContextResource } from '../src/domain/harness-bases.js';
const signal=()=>new AbortController().signal;

test('a system can use multiple design documents without creating subdesign systems; revisions cover all documents',()=>withTeam(async f=>{
 const base=await f.workspaces.context(f.workspaceId);
 await base.save('design/backend/metadata.json','{"implementation":["src"]}',null,null);
 await base.save('design/backend/design/README.md','# Backend\n\n[Requests](request-flow.md)',null,null);
 const flow=await base.save('design/backend/design/request-flow.md','# Requests\nInputs, output and effects.',null,null);
 const before=await f.team.designs.read(f.workspaceId,'backend/metadata.json');
 assert.equal(before.documents.length,2);assert.equal(before.documents[0]!.path,'design/backend/design/README.md');
 assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs.map(d=>d.path),['backend/metadata.json','metadata.json']);
 await base.save(flow.path,'# Requests\nUpdated behavior.',flow.revision,null);
 const after=await f.team.designs.read(f.workspaceId,'backend/metadata.json');assert.notEqual(after.revision,before.revision);
 await seedDesign(f.workspaces,f.workspaceId,'backend/storage/metadata.json',{content:'# Storage',implementation:['db']});
 assert.equal((await f.team.designs.list(f.workspaceId)).designs.length,3,'only an explicit child metadata record introduces a child system');
}));

test('invalid metadata, mixed document forms and missing directory entries never grant authority',()=>withTeam(async f=>{
 const base=await f.workspaces.context(f.workspaceId);
 await base.save('design/bad/metadata.json','{"content":"old","implementation":["."]}',null,null);
 assert.equal((await f.team.designs.inspect(f.workspaceId,'bad/metadata.json')).design,null);
 await seedDesign(f.workspaces,f.workspaceId,'mixed/metadata.json',{content:'# Single',implementation:[]});
 await base.save('design/mixed/design/README.md','# Directory',null,null);
 assert.match((await f.team.designs.inspect(f.workspaceId,'mixed/metadata.json')).designIssue!,/never both/);
 const single=await base.read({path:'design/mixed/design.md'});await base.delete(single.path,single.revision,null);
 const resolved=await f.team.designs.read(f.workspaceId,'mixed/metadata.json');assert.equal(resolved.documents.length,1);
 await base.save('design/mixed/design/data.json','{}',null,null);
 assert.match((await f.team.designs.inspect(f.workspaceId,'mixed/metadata.json')).designIssue!,/Markdown/);
 await base.save('design/missing/metadata.json','{"implementation":[]}',null,null);
 await base.save('design/missing/design/details.md','# Details',null,null);
 assert.match((await f.team.designs.inspect(f.workspaceId,'missing/metadata.json')).designIssue!,/README/);
}));

test('exact-node authority covers both forms without inheriting children or editable dependencies',()=>withTeam(async f=>{
 const parent=await worker(f,'Parent',[]),reference=parent.harness.designScope.working[0]!;
 const prefix=reference.slice(0,-'metadata.json'.length);
 await seedDesign(f.workspaces,f.workspaceId,prefix+'child/metadata.json',{content:'# Child',implementation:[]});
 const dependency=await worker(f,'Dependency',[]);
 await configureHarness(f,'Parent',{designScope:{working:[reference],dependencies:dependency.harness.designScope.working},allowedCommands:[]});
 const files=await f.team.harness.files(parent.memberId);
 await files.write.mkdir(join(files.root,'.rsi/context/implement',prefix,'impl'));
 await files.write.writeFile(join(files.root,'.rsi/context/implement',prefix,'impl/README.md'),'# Implemented contract');
 await files.write.writeFile(join(files.root,'.rsi/context/implement',prefix,'impl/runtime.md'),'Runtime facts');
 await assert.rejects(files.write.writeFile(join(files.root,'.rsi/context/implement',prefix,'child/impl.md'),'no'),code('not_found'));
 const depPrefix=dependency.harness.designScope.working[0]!.slice(0,-'metadata.json'.length);
 await assert.rejects(files.write.mkdir(join(files.root,'.rsi/context/implement',depPrefix,'impl')),code('access_denied'));
 await initGit(f);
 const staged=await f.team.harness.bash(parent.memberId,{command:'git add -f .rsi/context/implement && git commit -m "Document runtime"'},signal());
 assert.equal(staged.exitCode,0,staged.output);
}));

test('raw operations preserve separate roots and design history; implementation purpose is entirely read-only',()=>withTeam(async f=>{
 const base=await f.workspaces.context(f.workspaceId);
 await seedDesign(f.workspaces,f.workspaceId,'api/metadata.json',{content:'# API',implementation:[]});
 await mkdir(join(f.directory,'.rsi/context/implement/api/impl'),{recursive:true});
 await writeFile(join(f.directory,'.rsi/context/implement/api/impl/README.md'),'# Implementation');
 await base.overview();
 await assert.rejects(base.move('implement/api','implement/renamed',undefined,null),code('read_only'));
 await assert.rejects(base.delete('implement/api',undefined,null),code('read_only'));
 await assert.rejects(base.save('implement/api/temporary.txt','no',null,null),code('read_only'));
 const renamed=await base.move('design/api','design/API',undefined,null);
 assert.ok(renamed.moved.some(file=>file.to==='design/API/design.md'));
 assert.equal((await base.read({path:'implement/api/impl/README.md'})).content,'# Implementation');
 assert.deepEqual(Object.keys(await base.overview()).sort(),['bytes','files','problems','seq','workspaceId']);
}));

test('case-insensitive node references preserve actual node/document spelling in a member worktree',()=>withTeam(async f=>{
 await seedDesign(f.workspaces,f.workspaceId,'Backend/metadata.json',{content:'# Backend',implementation:[]});
 const member=await f.team.service.create(f.workspaceId,{name:'Case worker',role:'developer',settings:{},harness:{designScope:{working:['backend/metadata.json'],dependencies:[]},allowedCommands:[]}});
 const files=await f.team.harness.files(member.memberId);
 await files.write.mkdir(join(files.root,'.rsi/context/implement/Backend'));
 await files.write.writeFile(join(files.root,'.rsi/context/implement/Backend/impl.md'),'# Implementation facts');
 const scope=implementationContextResource('Backend/metadata.json');
 await initGit(f);
 const result=await f.team.harness.bash(member.memberId,{command:'git add -f .rsi/context/implement && git commit -m "Document Backend"'},signal());
 assert.equal(result.exitCode,0,result.output);
 assert.equal((await f.team.designs.read(f.workspaceId,'backend/metadata.json')).documents[0]!.path,'design/Backend/design.md');
}));

test('unresolvable safe assignments remain inspectable but cannot run or gain context authority',()=>withTeam(async f=>{
 await configureHarness(f,'Lead',{designScope:{working:['missing-record.json'],dependencies:[]},allowedCommands:[]});
 const inspection=await f.team.inspect(f.workspaceId,f.lead.memberId);
 assert.equal(inspection.member.ready,false);assert.match(inspection.member.issues.join(' '),/metadata.json/);
 assert.ok(!inspection.harnesses.flatMap(h=>h.resources).some(p=>p.id.startsWith('impl-context-')));
 await assert.rejects(f.team.harness.files(f.lead.memberId),code('invalid_path'));
}));

test('working and dependency permissions separate lead design management from implementation authority',()=>withTeam(async f=>{
 const backend=await worker(f,'Backend',['src']),dependency=await worker(f,'Shared',['src/shared']);
 const working=backend.harness.designScope.working,dependencies=dependency.harness.designScope.working;
 await configureHarness(f,'Backend',{designScope:{working,dependencies},allowedCommands:[{kind:'executable',executable:'bash'}]});
 await configureHarness(f,'Lead',{designScope:{working,dependencies},allowedCommands:[]});
 const lead=await f.team.harness.files(f.lead.memberId),member=await f.team.harness.files(backend.memberId);
 await assert.rejects(lead.write.mkdir(join(lead.root,'.rsi/context/Design')),code('invalid_path'));
 const own=implementationContextResource(working[0]!),dep=implementationContextResource(dependencies[0]!);
 const ownDesign=`.rsi/context/design/${working[0]!.replace('metadata.json','design.md')}`;
 const depDesign=`.rsi/context/design/${dependencies[0]!.replace('metadata.json','design.md')}`;
 await lead.write.writeFile(join(lead.root,depDesign),'Lead can maintain a dependency design');
 for(const files of [lead,member]){
  await files.write.mkdir(join(files.root,own.paths[0]!.slice(0,own.paths[0]!.lastIndexOf('/'))));
  await files.write.writeFile(join(files.root,own.paths[0]!),'# Working implementation');
  await assert.rejects(files.write.mkdir(join(files.root,dep.paths[1]!)),code('access_denied'));
  await assert.rejects(files.write.writeFile(join(files.root,'.rsi/context/implement/other/impl.md'),'no'),code('not_found'));
  await files.write.mkdir(join(files.root,'src'));
  await files.write.writeFile(join(files.root,'src/own.ts'),'allowed');
  await assert.rejects(files.write.mkdir(join(files.root,'src/shared')),code('access_denied'));
 }
 await assert.rejects(member.edit.writeFile(join(member.root,ownDesign),'no'),code('access_denied'));
 await assert.rejects(member.edit.writeFile(join(member.root,depDesign),'no'),code('access_denied'));
 await assert.rejects(f.team.harness.bash(backend.memberId,{command:'git restore .',metadata:{git:{scope:'design'}}},signal()),code('invalid_input'));
 const escaped=await f.team.harness.bash(backend.memberId,{command:`printf escape > ${ownDesign}`},signal());
 assert.equal(escaped.exitCode,0,escaped.output);
 await assert.rejects(f.team.harness.bash(backend.memberId,{command:`git add ${ownDesign}`,metadata:{git:{scope:'implementation'}}},signal()),code('invalid_input'));
 const prepared=await f.team.harness.prepare(backend.memberId,[]);
 assert.match(prepared.context,/"working"[\s\S]*"designContext"[\s\S]*"implementationContext"[\s\S]*"dependencies"/);
 assert.ok(!(await f.team.harness.environment(backend.memberId)).definitions.some(d=>d.resources.some(r=>r.id==='design')));
}));

test('read-only member views receive accepted design additions, updates and document-form transitions',()=>withTeam(async f=>{
 const lead=await f.team.harness.files(f.lead.memberId);
 const accept=()=>acceptFiles(f,'.rsi/context/design','Accept design');
 await lead.write.mkdir(join(lead.root,'.rsi/context/design/new'));
 await lead.write.writeFile(join(lead.root,'.rsi/context/design/new/metadata.json'),'{"implementation":["src"]}');
 await lead.write.writeFile(join(lead.root,'.rsi/context/design/new/design.md'),'# First accepted contract');
 await accept();
 const first=await f.team.service.create(f.workspaceId,{name:'First',role:'developer',harness:{designScope:{working:['new/metadata.json'],dependencies:[]},allowedCommands:[]}});
 const firstFiles=await f.team.harness.files(first.memberId);
 assert.match((await firstFiles.read.readFile(join(firstFiles.root,'.rsi/context/design/new/design.md'))).toString(),/First accepted/);
 await lead.write.mkdir(join(lead.root,'.rsi/context/design/new/design'));
 await lead.write.writeFile(join(lead.root,'.rsi/context/design/new/design/README.md'),'# Updated accepted contract');
 await rm(join(lead.root,'.rsi/context/design/new/design.md'));
 await accept();
 const second=await f.team.service.create(f.workspaceId,{name:'Second',role:'developer',harness:{designScope:{working:['new/metadata.json'],dependencies:[]},allowedCommands:[]}});
 const files=await f.team.harness.files(second.memberId);
 const updatedFirst=await f.team.harness.files(first.memberId);
 assert.match((await updatedFirst.read.readFile(join(updatedFirst.root,'.rsi/context/design/new/design/README.md'))).toString(),/Updated accepted/);
 await assert.rejects(updatedFirst.read.readFile(join(updatedFirst.root,'.rsi/context/design/new/design.md')),code('not_found'));
 assert.match((await files.read.readFile(join(files.root,'.rsi/context/design/new/design/README.md'))).toString(),/Updated accepted/);
 await assert.rejects(files.read.readFile(join(files.root,'.rsi/context/design/new/design.md')),code('not_found'));
 await assert.rejects(files.edit.writeFile(join(files.root,'.rsi/context/design/new/design/README.md'),'no'),code('access_denied'));
}));
