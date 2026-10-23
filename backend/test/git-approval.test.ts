import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { withTeam, worker, code } from './team-fixture.js';
import { initGit, waitApproval, acceptFiles } from './git-fixture.js';
import { gitText, currentFiles } from '../src/core/workspace-git.js';

const signal=()=>new AbortController().signal;
test('ordinary implementation commits preserve branch, staged bytes and unstaged files without harness history',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);await initGit(f);
  await mkdir(join(f.directory,'src'));await writeFile(join(f.directory,'src/a'),'staged');await gitText(f.directory,['add','src']);await writeFile(join(f.directory,'src/a'),'unstaged');
  const result=await f.team.harness.bash(member.memberId,{cwd:f.folder,command:'git -C project commit -m "Implement" && git -C project log --oneline'},signal());
  assert.equal(result.exitCode,0,result.output);assert.match(result.output,/Implement/);assert.equal(await gitText(f.directory,['show','HEAD:src/a']),'staged');assert.equal(await readFile(join(f.directory,'src/a'),'utf8'),'unstaged');
  await assert.rejects(lstat(join(f.directory,'.rsi/harness')),code('ENOENT'));
}));
test('protected commit approval accepts exact content; mixed commits refuse without changing staging or HEAD',()=>withTeam(async f=>{
  await worker(f,'Backend',['src']);await initGit(f);await mkdir(join(f.directory,'src'));await writeFile(join(f.directory,'src/a'),'code');await gitText(f.directory,['add','-f','.rsi/context/design','src']);
  const before=await gitText(f.directory,['write-tree']);const denied=await f.team.harness.bash(f.lead.memberId,{command:'git commit -m Mixed'},signal());assert.equal(denied.exitCode,1);assert.match(denied.output,/Split design\/member/);assert.equal(await gitText(f.directory,['write-tree']),before);assert.equal(f.team.harness.approvals.list(f.workspaceId).length,0);
  await gitText(f.directory,['rm','--cached','-r','src']);
  const running=f.team.harness.bash(f.lead.memberId,{command:'git commit -m Protected'},signal(),'approval-run');const pending=await waitApproval(f);const review=f.team.harness.approvals.read(f.workspaceId,pending.id);
  assert.equal(review.runId,'approval-run');assert.ok(review.changes.every(c=>c.path.startsWith('.rsi/context/design/')));assert.match(review.changes[0]!.patch,/implementation|Project/);
  f.team.harness.approvals.decide(f.workspaceId,pending.id,'accept','');const result=await running;assert.equal(result.exitCode,0,result.output);assert.equal(await gitText(f.directory,['log','-1','--format=%s']),'Protected');
}));
test('deny and feedback resolve the original tool without a commit; approval waits suspend foreground timeout',()=>withTeam(async f=>{
  await initGit(f);await gitText(f.directory,['add','-f','.rsi/members']);
  for(const action of ['deny','feedback']as const){const run=f.team.harness.bash(f.lead.memberId,{command:'git commit -m Members',timeout:2},signal());const pending=await waitApproval(f);await new Promise(r=>setTimeout(r,2200));f.team.harness.approvals.decide(f.workspaceId,pending.id,action,'Please revise');const result=await run;assert.equal(result.exitCode,1,result.output);assert.match(result.output,/denied|Please revise/);assert.equal(result.timedOut,false);}
}));
test('changed staging or HEAD invalidates approval, cancellation removes it, and repeat decisions refuse',()=>withTeam(async f=>{
  await initGit(f);await gitText(f.directory,['add','-f','.rsi/members']);
  const run=f.team.harness.bash(f.lead.memberId,{command:'git commit -m Members'},signal());const pending=await waitApproval(f);
  const path=(await f.team.configuration.accepted(f.workspaceId,f.lead.memberId)).path;await writeFile(join(f.directory,path),'changed');await gitText(f.directory,['add','-f',path]);
  f.team.harness.approvals.decide(f.workspaceId,pending.id,'accept','');assert.match((await run).output,/stale_approval/);assert.throws(()=>f.team.harness.approvals.decide(f.workspaceId,pending.id,'accept',''),code('not_found'));
  const controller=new AbortController();const cancelled=f.team.harness.bash(f.lead.memberId,{command:'git commit -m Cancel'},controller.signal);await waitApproval(f);controller.abort();await assert.rejects(cancelled);assert.equal(f.team.harness.approvals.list(f.workspaceId).length,0);
}));
test('-a evaluates current tracked bytes, unknown paths refuse, and old git.scope metadata is removed',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);await initGit(f);await mkdir(join(f.directory,'src'));await writeFile(join(f.directory,'src/a'),'one');await gitText(f.directory,['add','src']);assert.equal((await f.team.harness.bash(member.memberId,{command:'git commit -m Initial'},signal())).exitCode,0);
  for(const value of ['two','six','ten','one']){
    await writeFile(join(f.directory,'src/a'),value);
    const update=await f.team.harness.bash(member.memberId,{command:'git commit -a -m Update'},signal());assert.equal(update.exitCode,0,update.output);assert.equal(await gitText(f.directory,['show','HEAD:src/a']),value);
  }
  await writeFile(join(f.directory,'outside'),'unrecognized');await gitText(f.directory,['add','outside']);assert.match((await f.team.harness.bash(member.memberId,{command:'git commit -m Wrong'},signal())).output,/unrecognized/);
  await assert.rejects(f.team.harness.bash(member.memberId,{command:'git status',metadata:{git:{scope:'implementation'}}},signal()),code('invalid_input'));
}));
test('committed design is authority and member activation stays separate from approved commit',()=>withTeam(async f=>{
  await acceptFiles(f,'.rsi/context/design','Design baseline');
  const path=(await f.team.configuration.accepted(f.workspaceId,f.lead.memberId)).path;const raw=JSON.parse(await readFile(join(f.directory,path),'utf8'));await writeFile(join(f.directory,path),JSON.stringify({...raw,responsibility:'Changed'}));
  const review=await acceptFiles(f);assert.equal(review.valid,true,JSON.stringify(review.issues));assert.notEqual((await f.team.member(f.workspaceId,f.lead.memberId)).responsibility,'Changed');
  await f.team.activateConfiguration(f.workspaceId,review.revision,review.digest);assert.equal((await f.team.member(f.workspaceId,f.lead.memberId)).responsibility,'Changed');
  assert.ok(Object.keys(await currentFiles(f.directory,'.rsi/members')).length);
}));

test('renames across protected and implementation categories refuse; explicit absolute Git and unsupported overrides cannot bypass review',()=>withTeam(async f=>{
  await worker(f,'Backend',['src']);await acceptFiles(f,'.rsi/context/design','Initial design');await mkdir(join(f.directory,'src'));
  await gitText(f.directory,['mv','.rsi/context/design/design.md','src/design.md']);
  const mixed=await f.team.harness.bash(f.lead.memberId,{command:'/usr/bin/git commit -m "Move design into code"'},signal());assert.match(mixed.output,/Split design\/member/);
  const unsupported=await f.team.harness.bash(f.lead.memberId,{command:'git -c user.name=Other commit -m "Do not bypass"'},signal());assert.equal(unsupported.exitCode,1);assert.match(unsupported.output,/Only explicit Git commit/);
  assert.equal(await gitText(f.directory,['log','-1','--format=%s']),'Initial design');
}));
