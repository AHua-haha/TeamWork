import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { implementationContextPart } from '../src/harness-bases.js';
import { implementationContextPath } from '../src/workspace-layout.js';
import { code, configureHarness, withTeam, worker } from './team-fixture.js';
const signal = () => new AbortController().signal;

test('implementation context paths preserve design identity/extensions with stable scope IDs',()=>{
  assert.equal(implementationContextPath('backend/api/metadata.json'),'implement/backend/api/impl.md');
  assert.equal(implementationContextPath('backend/metadata.json'),'implement/backend/impl.md');
  assert.equal(implementationContextPath('Backend/API/metadata.json'),'implement/Backend/API/impl.md');
  assert.equal(implementationContextPart('A/metadata.json').id,implementationContextPart('a/metadata.json').id);
  assert.throws(()=>implementationContextPath('agent/internal.md'),code('invalid_path'));
  assert.throws(()=>implementationContextPath('user/../escape'),code('invalid_path'));
});

test('root bootstrap supplies design and implemented-contract templates and agent context authority without implementation code rights',()=>withTeam(async f=>{
  const base=await f.workspaces.context(f.workspaceId);
  const design=await base.read({path:'design/design.md'});
  for(const title of ['Purpose, responsibilities and boundaries','Interface contract','Constraints, specifications and requirements'])assert.ok(design.content.includes(title));
  const context=await base.read({path:'implement/impl.md'});
  for(const title of ['Implemented contract','Input','Output','Effect','Usage examples'])assert.ok(context.content.includes(title));
  assert.match(context.content,/No implemented interfaces have been documented/);
  const files=await f.team.harness.files(f.lead.memberId),path=join(files.root,'.rsi/context/implement/impl.md');
  await files.edit.writeFile(path,context.content+'\nCurrent implementation notes.\n');
  await assert.rejects(files.write.writeFile(join(files.root,'code.ts'),'outside'),code('not_found'));
  const prepared=await f.team.harness.prepare(f.lead.memberId,[]);
  assert.match(prepared.context,/Interface contract/);assert.match(prepared.context,/Usage examples/);
  assert.match(prepared.context,/impl-context-[a-f0-9]{16}/);
  const before=(await f.team.harness.inspect(f.lead.memberId)).parts.find(p=>p.state.part.id==='design')!;
  const part=implementationContextPart('metadata.json');
  const committed=await f.team.harness.bash(f.lead.memberId,{command:'git add . && git commit -m "Document current implementation"',metadata:{git:{scope:part.id}}},signal());
  assert.equal(committed.exitCode,0,committed.output);
  const after=(await f.team.harness.inspect(f.lead.memberId)).parts.find(p=>p.state.part.id==='design')!;
  assert.equal(after.state.committed,before.state.committed);
  assert.equal((await base.read({path:'implement/impl.md'})).content,context.content+'\nCurrent implementation notes.\n','raw context observes the same shared workspace');
}));

test('working context is writable/searchable while dependencies, unrelated context, member and private state stay protected',()=>withTeam(async f=>{
  const a=await worker(f,'A',['src']), b=await worker(f,'B',['lib']);
  await configureHarness(f,'A',{designScope:{working:a.harness.designScope.working,dependencies:b.harness.designScope.working},allowedCommands:[{kind:'executable',executable:'bash'}]});
  const own=implementationContextPart(a.harness.designScope.working[0]!), dep=implementationContextPart(b.harness.designScope.working[0]!);
  const dependency=await f.team.harness.files(b.memberId);
  await dependency.write.mkdir(join(dependency.root,dep.paths[0]!.slice(0,dep.paths[0]!.lastIndexOf('/'))));
  await dependency.write.writeFile(join(dependency.root,dep.paths[0]!),'Dependency implementation context');
  const published=await f.team.harness.bash(b.memberId,{command:'git add . && git commit -m "Document dependency"',metadata:{git:{scope:dep.id}}},signal());
  assert.equal(published.exitCode,0,published.output);
  const files=await f.team.harness.files(a.memberId);
  await files.write.mkdir(join(files.root,own.paths[0]!.slice(0,own.paths[0]!.lastIndexOf('/'))));await files.write.writeFile(join(files.root,own.paths[0]!),'# Implemented contract\nInput Output Effect Usage examples');

  assert.match((await files.read.readFile(join(files.root,dep.paths[0]!))).toString(),/Dependency/);
  await assert.rejects(files.edit.writeFile(join(files.root,dep.paths[0]!),'forbidden'),code('access_denied'));
  await assert.rejects(files.read.readFile(join(files.root,'.rsi/context/design/agent/unrelated.md')),code('not_found'));
  await assert.rejects(files.write.writeFile(join(files.root,'.rsi/members/other/member.json'),'{}'),code('not_found'));
  await assert.rejects(files.read.readFile(join(files.root,'.rsi/harness/repository.git/HEAD')),code('not_found'));
  const searched=await f.team.harness.bash(a.memberId,{command:`grep -n 'Implemented contract' ${own.paths[0]}`,metadata:{git:{scope:own.id}}},signal());
  assert.equal(searched.exitCode,0,searched.output);assert.match(searched.output,/Implemented contract/);
  await assert.rejects(f.team.harness.bash(a.memberId,{command:'git status',metadata:{git:{scope:dep.id}}},signal()),code('not_found'));
  const shell=await f.team.harness.bash(a.memberId,{command:`printf forbidden > ${own.paths[0]}`},signal());
  assert.equal(shell.exitCode,0,shell.output);assert.equal(await readFile(join(files.root,own.paths[0]!), 'utf8'),'forbidden');
}));

test('a replacement with a different assignment set sees and maintains the same current context',()=>withTeam(async f=>{
  const a=await worker(f,'A',['src']), b=await worker(f,'B',['lib']);
  const design=a.harness.designScope.working[0]!, part=implementationContextPart(design);
  const files=await f.team.harness.files(a.memberId);await files.write.mkdir(join(files.root,part.paths[0]!.slice(0,part.paths[0]!.lastIndexOf('/'))));
  await files.write.writeFile(join(files.root,part.paths[0]!), 'Committed context v1');
  const commit=(id:string)=>f.team.harness.bash(id,{command:'git add . && git commit -m "Maintain implemented contract"',metadata:{git:{scope:part.id}}},signal());
  assert.equal((await commit(a.memberId)).exitCode,0);
  const replacement=await f.team.service.create(f.workspaceId,{name:'Replacement',role:'developer',responsibility:'Continue A and B',settings:{},harness:{designScope:{working:[design,...b.harness.designScope.working],dependencies:[]},allowedCommands:[]}});
  const next=await f.team.harness.files(replacement.memberId);
  assert.equal((await next.read.readFile(join(next.root,part.paths[0]!))).toString(),'Committed context v1');
  await files.write.writeFile(join(files.root,part.paths[0]!), 'Committed context v2');assert.equal((await commit(a.memberId)).exitCode,0);
  await next.write.writeFile(join(next.root,part.paths[0]!), 'Committed context v3');const committed=await commit(replacement.memberId);
  assert.equal(committed.exitCode,0,committed.output);
  assert.equal((await files.read.readFile(join(files.root,part.paths[0]!))).toString(),'Committed context v3');
}));
