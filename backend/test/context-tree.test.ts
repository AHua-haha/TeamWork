import { memberBash } from './team-fixture.js';
import { acceptFiles,initGit } from './git-fixture.js';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { withTeam, worker, configureAssignment, code } from './team-fixture.js';
import { seedDesign } from './design-fixture.js';

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

test('context files support both document forms and children in the shared workspace',()=>withTeam(async f=>{
 const parent=await worker(f,'Parent',[]),reference=parent.designScope.working[0]!;
 const prefix=reference.slice(0,-'metadata.json'.length);
 await seedDesign(f.workspaces,f.workspaceId,prefix+'child/metadata.json',{content:'# Child',implementation:[]});
 const dependency=await worker(f,'Dependency',[]);
 await configureAssignment(f,'Parent',{designScope:{working:[reference],dependencies:dependency.designScope.working}});
 const files=await f.team.memberWorkspace.files(parent.memberId);
 await files.write.mkdir(join(files.root,'.rsi/context/implement',prefix,'impl'));
 await files.write.writeFile(join(files.root,'.rsi/context/implement',prefix,'impl/README.md'),'# Implemented contract');
 await files.write.writeFile(join(files.root,'.rsi/context/implement',prefix,'impl/runtime.md'),'Runtime facts');
 await files.write.mkdir(join(files.root,'.rsi/context/implement',prefix,'child'));
 await files.write.writeFile(join(files.root,'.rsi/context/implement',prefix,'child/impl.md'),'# Child implementation');
 const depPrefix=dependency.designScope.working[0]!.slice(0,-'metadata.json'.length);
 await files.write.mkdir(join(files.root,'.rsi/context/implement',depPrefix,'impl'));
 await initGit(f);
 const staged=await memberBash(f.team, parent.memberId,{command:'git add -f .rsi/context/implement && git commit -m "Document runtime"'},signal());
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
 const member=await f.team.service.create(f.workspaceId,{name:'Case worker',role:'developer',settings:{},designScope: {working:['backend/metadata.json'],dependencies:[]}});
 const files=await f.team.memberWorkspace.files(member.memberId);
 await files.write.mkdir(join(files.root,'.rsi/context/implement/Backend'));
 await files.write.writeFile(join(files.root,'.rsi/context/implement/Backend/impl.md'),'# Implementation facts');

 await initGit(f);
 const result=await memberBash(f.team, member.memberId,{command:'git add -f .rsi/context/implement && git commit -m "Document Backend"'},signal());
 assert.equal(result.exitCode,0,result.output);
 assert.equal((await f.team.designs.read(f.workspaceId,'backend/metadata.json')).documents[0]!.path,'design/Backend/design.md');
}));

test('unresolvable safe assignments remain inspectable but cannot run or gain context authority',()=>withTeam(async f=>{
 await configureAssignment(f,'Lead',{designScope:{working:['missing-record.json'],dependencies:[]}});
 const member=await f.team.member(f.workspaceId,f.lead.memberId);
 assert.equal(member.ready,false);assert.match(member.issues.join(' '),/metadata.json/);
 assert.deepEqual(member.designScope.working,['missing-record.json']);
 assert.equal((await f.team.memberWorkspace.files(f.lead.memberId)).root,f.directory);
}));


test('read-only member views receive accepted design additions, updates and document-form transitions',()=>withTeam(async f=>{
 const lead=await f.team.memberWorkspace.files(f.lead.memberId);
 const accept=()=>acceptFiles(f,'.rsi/context/design','Accept design');
 await lead.write.mkdir(join(lead.root,'.rsi/context/design/new'));
 await lead.write.writeFile(join(lead.root,'.rsi/context/design/new/metadata.json'),'{"implementation":["src"]}');
 await lead.write.writeFile(join(lead.root,'.rsi/context/design/new/design.md'),'# First accepted contract');
 await accept();
 const first=await f.team.service.create(f.workspaceId,{name:'First',role:'developer',designScope: {working:['new/metadata.json'],dependencies:[]}});
 const firstFiles=await f.team.memberWorkspace.files(first.memberId);
 assert.match((await firstFiles.read.readFile(join(firstFiles.root,'.rsi/context/design/new/design.md'))).toString(),/First accepted/);
 await lead.write.mkdir(join(lead.root,'.rsi/context/design/new/design'));
 await lead.write.writeFile(join(lead.root,'.rsi/context/design/new/design/README.md'),'# Updated accepted contract');
 await rm(join(lead.root,'.rsi/context/design/new/design.md'));
 await accept();
 const second=await f.team.service.create(f.workspaceId,{name:'Second',role:'developer',designScope: {working:['new/metadata.json'],dependencies:[]}});
 const files=await f.team.memberWorkspace.files(second.memberId);
 const updatedFirst=await f.team.memberWorkspace.files(first.memberId);
 assert.match((await updatedFirst.read.readFile(join(updatedFirst.root,'.rsi/context/design/new/design/README.md'))).toString(),/Updated accepted/);
 await assert.rejects(updatedFirst.read.readFile(join(updatedFirst.root,'.rsi/context/design/new/design.md')),code('ENOENT'));
 assert.match((await files.read.readFile(join(files.root,'.rsi/context/design/new/design/README.md'))).toString(),/Updated accepted/);
 await assert.rejects(files.read.readFile(join(files.root,'.rsi/context/design/new/design.md')),code('ENOENT'));
 await files.write.writeFile(join(files.root,'.rsi/context/design/new/design/README.md'),'Pending edit');
}));
