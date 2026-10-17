import { seedDesign } from './design-fixture.js';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { designMetadata } from '../src/design.js';
import { commandAllowed, commandArgv, emptyHarness, harnessConfig } from '../src/harness-config.js';
import { executeCommand, parseBashInput } from '../src/harness-command.js';
import { code, configureHarness, withTeam, worker } from './team-fixture.js';

const signal = () => new AbortController().signal;
const git = (scope: string, command: string) => ({ command, metadata: { git: { scope } } });

test('assignment accepts design references only and never agent-owned implementation paths or authority metadata', () => {
  assert.deepEqual(designMetadata({implementation:['backend/']}),{implementation:['backend']});
  for (const path of ['../outside','.rsi/context/metadata.json','.git/config','.rsi/members']) assert.throws(()=>designMetadata({implementation:[path]}));
  const value={...emptyHarness(),designScope:{working:['.rsi/context/api/metadata.json'],dependencies:['contracts/metadata.json']},allowedCommands:[{kind:'exact',argv:['bash','-c','npm test']}]};
  assert.equal(harnessConfig(value).designScope.working[0],'api/metadata.json');
  assert.throws(()=>harnessConfig({...value,implementationScope:{paths:['.'],usePaths:[]}}));
  assert.throws(()=>harnessConfig({...value,designScope:{working:['user/a'],dependencies:['user/A']}}));
  assert.throws(()=>commandArgv([]));
  assert.equal(commandAllowed(harnessConfig(value).allowedCommands,['bash','-c','npm test']),true);
  assert.throws(()=>parseBashInput({command:'git status',metadata:{git:{scope:'design',approved:true}}}));
});

test('implementation access derives from accepted mappings; pending files do not expand it',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  const files=await f.team.harness.files(member.memberId);
  const path=join(files.root,'.rsi/context',member.harness.designScope.working[0]!);
  await files.write.writeFile(path,JSON.stringify({implementation:['outside']}));
  await assert.rejects(files.write.writeFile(join(files.root,'outside/x'),'no'),code('not_found'));
  const prepared=await f.team.harness.prepare(member.memberId,[]);
  assert.deepEqual(prepared.tools.map(t=>t.definition.name).sort(),['bash','edit','ls','read','write']);
  assert.deepEqual((await f.team.inspect(f.workspaceId,member.memberId)).harnesses.map(h=>h.id),['management','implementation','execute']);
}));

test('scoped Bash uses real Git staging and commits, preserving index across automatic checkpoints',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  const files=await f.team.harness.files(member.memberId);
  await files.write.mkdir(join(files.root,'src'));
  await files.write.writeFile(join(files.root,'src/a.txt'),'first');
  const first=await f.team.harness.bash(member.memberId,git('implementation','git add . && git diff --cached --stat'),signal());
  assert.equal(first.exitCode,0,first.stderr);assert.match(first.stdout,/src\/a.txt/);
  await files.write.writeFile(join(files.root,'src/a.txt'),'second');
  await f.team.harness.checkpoint(member.memberId,'r1');
  const commit=await f.team.harness.bash(member.memberId,git('implementation','git commit -m "Implement first" && git log --oneline && git diff'),signal());
  assert.equal(commit.exitCode,0,commit.stderr);assert.match(commit.stdout,/Implement first/);assert.match(commit.stdout,/second/);
  const history=await f.team.harness.history(member.memberId,'implementation');
  const accepted=history.find(h=>h.kind==='commit')!;
  assert.equal(await (await f.team.harness.environment(member.memberId)).history.readSnapshot(accepted.revision,'src/a.txt'),'first');
  await files.write.writeFile(join(files.root,'src/a.txt'),'uncheckpointed edit');
  const restore=await f.team.harness.bash(member.memberId,git('implementation','git restore -- src/a.txt'),signal());
  assert.equal(restore.exitCode,0,restore.stderr);assert.equal(await readFile(join(files.root,'src/a.txt'),'utf8'),'first');
  const log=await f.team.harness.bash(member.memberId,git('implementation','git log --all --oneline'),signal());
  assert.match(log.stdout,/Before Git restore/);
  const env=await f.team.harness.environment(member.memberId);
  const retained=await f.team.harness.history(member.memberId,'implementation');
  assert.ok((await Promise.all(retained.map(r=>env.history.readSnapshot(r.revision,'src/a.txt')))).includes('uncheckpointed edit'));

}));

test('management Git is user-approved, member metadata is protected, and scopes cannot be retargeted',()=>withTeam(async f=>{
  await f.team.configuration.materialize(f.lead.memberId);
  const files=await f.team.harness.files(f.lead.memberId),manifest=(await f.team.configuration.accepted(f.workspaceId,f.lead.memberId)).path;
  await files.write.writeFile(join(files.root,manifest),JSON.stringify({name:'Pending',designScope:{working:[],dependencies:[]}}));
  const staged=await f.team.harness.bash(f.lead.memberId,git('member-config','git add . && git commit -m "Change members"'),signal());
  assert.equal(staged.exitCode,1,staged.stderr);assert.match(staged.stderr,/approval_required/);
  const review=(await f.team.harness.inspect(f.lead.memberId)).parts.find(p=>p.state.part.id==='member-config')!;
  await f.team.harness.commit(f.lead.memberId,'member-config','Accept file change',{type:'user',memberId:f.lead.memberId},review.revision,review.state.committed);
  assert.equal((await f.team.service.get(f.workspaceId,f.lead.memberId)).name,'Lead','committed member bytes never activate settings');
  const status=await f.team.harness.bash(f.lead.memberId,git('member-config','git status --porcelain'),signal());
  assert.equal(status.exitCode,0,status.stderr);assert.equal(status.stdout,'');
  const denied=await f.team.harness.bash(f.lead.memberId,git('member-config','git --git-dir=/tmp/else status'),signal());
  assert.notEqual(denied.exitCode,0);assert.match(denied.stderr,/command_denied/);
  const member=await worker(f,'Backend',['src']);
  await assert.rejects(f.team.harness.bash(member.memberId,git('member-config','git status'),signal()),code('not_found'));
}));

test('Bash and nested processes cannot write management files, inspect peers, or bypass scoped Git',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['.']);
  await configureHarness(f,'Backend',{...member.harness,allowedCommands:[{kind:'executable',executable:'bash'}]});
  await f.team.configuration.materialize(f.lead.memberId);
  const files=await f.team.harness.files(member.memberId),leadRoot=(await f.team.harness.environment(f.lead.memberId)).root;
  const leadManifest=(await f.team.configuration.accepted(f.workspaceId,f.lead.memberId)).path;
  const node=JSON.stringify(process.execPath);
  const attempt=await f.team.harness.bash(member.memberId,{command:`${node} -e 'require("fs").writeFileSync(".rsi/context/${member.harness.designScope.working[0]}","escape")'`},signal());
  assert.notEqual(attempt.exitCode,0);assert.match(attempt.stderr,/permitted|EACCES|EPERM|denied/i);
  const hardlink=await f.team.harness.bash(member.memberId,{command:`ln .rsi/context/${member.harness.designScope.working[0]} alias.json && printf escape > alias.json`},signal());
  assert.notEqual(hardlink.exitCode,0,'hard links cannot make protected management writable');
  const read=await f.team.harness.bash(member.memberId,{command:`cat ${JSON.stringify(join(leadRoot,leadManifest))}`},signal());
  assert.notEqual(read.exitCode,0,'peer member source cannot be read');
  const raw=await f.team.harness.bash(member.memberId,{command:'/usr/bin/git status'},signal());
  assert.notEqual(raw.exitCode,0,'raw Git cannot access protected worktree metadata');
  const forwarded=await f.team.harness.bash(member.memberId,git('implementation',`${node} -e 'require("child_process").execFileSync("git",["status","--porcelain"],{stdio:"inherit"})'`),signal());
  assert.equal(forwarded.exitCode,0,forwarded.stderr);
  await files.write.writeFile(join(files.root,'a.txt'),'allowed');
}));

test('accepted design Git commits become authoritative for permission derivation and discovery',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['old']);
  const lead=await f.team.harness.files(f.lead.memberId);
  const designPath=member.harness.designScope.working[0]!;
  await lead.write.mkdir(join(lead.root,'.rsi/context/systems/backend'));
  await lead.write.writeFile(join(lead.root,'.rsi/context/systems/backend/design.md'),'New accepted design');
  await lead.write.writeFile(join(lead.root,'.rsi/context',designPath),JSON.stringify({implementation:['new']}));
  const review=(await f.team.harness.inspect(f.lead.memberId)).parts.find(p=>p.state.part.id==='design')!;
  await f.team.harness.commit(f.lead.memberId,'design','Accept new mapping',{type:'user',memberId:f.lead.memberId},review.revision,review.state.committed);
  assert.deepEqual((await f.team.service.get(f.workspaceId,member.memberId)).harness.implementationScope.paths,['new']);
  assert.equal((await f.team.designs.inspect(f.workspaceId,designPath)).design!.content,'New accepted design');
  assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs.find(d=>d.path===designPath)!.implementation,['new']);
}));

test('general Bash is denied without execute allowance while scoped Git stays available',()=>withTeam(async f=>{
  await assert.rejects(f.team.harness.bash(f.lead.memberId,{command:'printf arbitrary'},signal()),code('command_denied'));
  const result=await f.team.harness.bash(f.lead.memberId,git('design','git status --short'),signal());
  assert.equal(result.exitCode,0,result.stderr);
}));

test('output bounds, timeout and cancellation terminate process groups',()=>withTeam(async f=>{
  const output=await executeCommand(f.directory,[process.execPath,'-e','process.stdout.write("x".repeat(100000))'],signal());
  assert.equal(Buffer.byteLength(output.stdout),65536);assert.equal(output.truncated,true);
  const timeout=await executeCommand(f.directory,[process.execPath,'-e','setInterval(()=>{},1000)'],signal(),100);assert.equal(timeout.timedOut,true);
  const controller=new AbortController();const pending=executeCommand(f.directory,[process.execPath,'-e','setInterval(()=>{},1000)'],controller.signal);setTimeout(()=>controller.abort(),100);await assert.rejects(pending);
}));

test('independent scope staging survives implementation commits and dependency files stay read-only in Bash',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  await seedDesign(f.workspaces, f.workspaceId, 'dependency/metadata.json', {content:'Read only',implementation:['src/shared']});
  await configureHarness(f,'Backend',{designScope:{working:member.harness.designScope.working,dependencies:['dependency/metadata.json']},allowedCommands:[{kind:'executable',executable:'bash'}]});
  const files=await f.team.harness.files(member.memberId);
  const design=join(files.root,'.rsi/context/systems/backend/design.md');
  await files.write.writeFile(design,'Pending');
  await files.write.mkdir(join(files.root,'src'));await files.write.writeFile(join(files.root,'src/a.txt'),'Own implementation');
  assert.equal((await f.team.harness.bash(member.memberId,git('design','git add .'),signal())).exitCode,0);
  const committed=await f.team.harness.bash(member.memberId,git('implementation','git add . && git commit -m "Implement independently"'),signal());
  assert.equal(committed.exitCode,0,committed.stderr);
  const staged=await f.team.harness.bash(member.memberId,git('design','git diff --cached'),signal());
  assert.match(staged.stdout,/Pending/);assert.doesNotMatch(staged.stdout,/Own implementation/);
  const read=await f.team.harness.bash(member.memberId,{command:'cat .rsi/context/dependency/design.md'},signal());
  assert.equal(read.exitCode,0,read.stderr);assert.match(read.stdout,/Read only/);
  const write=await f.team.harness.bash(member.memberId,{command:'mkdir -p src/shared && printf escape > src/shared/x.txt'},signal());
  assert.notEqual(write.exitCode,0);
}));

test('scoped Git rejects stale commits and explicitly restores latest accepted scope without affecting another scope',()=>withTeam(async f=>{
  const a=await worker(f,'Backend',['src']),b=await worker(f,'Other',['src']);
  const af=await f.team.harness.files(a.memberId),bf=await f.team.harness.files(b.memberId);
  await af.write.mkdir(join(af.root,'src'));await af.write.writeFile(join(af.root,'src/a.txt'),'First');
  const commit=await f.team.harness.bash(a.memberId,git('implementation','git add . && git commit -m "First"'),signal());assert.equal(commit.exitCode,0,commit.stderr);
  await bf.write.mkdir(join(bf.root,'src'));await bf.write.writeFile(join(bf.root,'src/a.txt'),'Stale');
  const stale=await f.team.harness.bash(b.memberId,git('implementation','git add . && git commit -m "Stale"'),signal());assert.match(stale.stderr,/stale_revision/);
  const latest=(await f.team.harness.inspect(b.memberId)).parts.find(p=>p.state.part.id==='implementation')!.state.committed;
  const restored=await f.team.harness.bash(b.memberId,git('implementation',`git restore --staged --worktree --source=${latest} .`),signal());assert.equal(restored.exitCode,0,restored.stderr);
  await bf.write.writeFile(join(bf.root,'src/a.txt'),'Second');
  const fresh=await f.team.harness.bash(b.memberId,git('implementation','git add . && git commit -m "Second"'),signal());assert.equal(fresh.exitCode,0,fresh.stderr);
  assert.equal(await readFile(join(af.root,'src/a.txt'),'utf8'),'First');
}));

test('a file-sized implementation scope stages and commits inside the managed worktree',()=>withTeam(async f=>{
  const member=await worker(f,'File Worker',['src/result.txt']);
  const files=await f.team.harness.files(member.memberId);
  await files.write.mkdir(join(files.root,'src')); await files.write.writeFile(join(files.root,'src/result.txt'),'Done');
  const result=await f.team.harness.bash(member.memberId,git('implementation','git status --short && git add . && git diff --cached && git commit -m "Implement file"'),signal());
  assert.equal(result.exitCode,0,JSON.stringify(result));
  assert.ok((await f.team.harness.history(member.memberId,'implementation')).some(r=>r.kind==='commit' && r.actor.type==='agent'));
}));
