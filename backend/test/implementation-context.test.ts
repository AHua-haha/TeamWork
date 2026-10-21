import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { implementationContextResource } from '../src/domain/harness/harness-bases.js';
import { memberContextPath } from '../src/domain/workspace/workspace-layout.js';
import { withTeam,worker,configureHarness,code } from './team-fixture.js';
import { initGit } from './git-fixture.js';

test('implementation context resources preserve design identity and both document forms without Git scope identities',()=>{
  assert.deepEqual(implementationContextResource('backend/metadata.json').paths,['.rsi/context/implement/backend/impl.md','.rsi/context/implement/backend/impl']);
  assert.equal(memberContextPath('metadata.json'),'.rsi/context/implement/impl/README.md');
});
test('bootstrap provides complete context templates; implementation context commits use ordinary project history',()=>withTeam(async f=>{
  const files=await f.team.harness.files(f.lead.memberId);const path=memberContextPath('metadata.json');
  const content=(await files.read.readFile(join(files.root,path))).toString();assert.match(content,/Implemented contract/);assert.match(content,/Automatic retrieval/);
  await files.write.writeFile(join(files.root,path),content+'\nCurrent implementation notes.\n');await initGit(f);
  const result=await f.team.harness.bash(f.lead.memberId,{command:'git add -f .rsi/context/implement && git commit -m "Document implementation"'},new AbortController().signal);assert.equal(result.exitCode,0,result.output);
  await assert.rejects(files.write.writeFile(join(files.root,'source.txt'),'no mapping'),code('not_found'));
}));
test('working context remains writable and dependencies read-only; members share the same current documents',()=>withTeam(async f=>{
  const a=await worker(f,'A',['src']),b=await worker(f,'B',['lib']);await configureHarness(f,'A',{designScope:{working:a.harness.designScope.working,dependencies:b.harness.designScope.working},allowedCommands:[]});
  const af=await f.team.harness.files(a.memberId),bf=await f.team.harness.files(b.memberId),own=memberContextPath(a.harness.designScope.working[0]!),dependency=memberContextPath(b.harness.designScope.working[0]!);
  await bf.write.mkdir(join(bf.root,dependency.slice(0,dependency.lastIndexOf('/'))));await bf.write.writeFile(join(bf.root,dependency),'Dependency context');
  assert.match((await af.read.readFile(join(af.root,dependency))).toString(),/Dependency/);await assert.rejects(af.write.writeFile(join(af.root,dependency),'no'),code('access_denied'));
  await af.write.mkdir(join(af.root,own.slice(0,own.lastIndexOf('/'))));await af.write.writeFile(join(af.root,own),'Current context');assert.equal(af.root,bf.root);
}));
