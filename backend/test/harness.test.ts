import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { seedDesign } from './design-fixture.js';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { test } from 'node:test';
import { designMetadata } from '../src/design.js';
import { commandArgv, emptyHarness, harnessConfig } from '../src/harness-config.js';
import { parseBashInput } from '../src/harness-command.js';
import { code, configureHarness, withTeam, worker } from './team-fixture.js';

const signal = () => new AbortController().signal;
const git = (scope: string, command: string) => ({ command, metadata: { git: { scope } } });

test('assignment accepts design references only and never agent-owned implementation paths or authority metadata', () => {
  assert.deepEqual(designMetadata({implementation:['backend/']}),{implementation:['backend']});
  for (const path of ['../outside','.rsi/context/design/metadata.json','.git/config','.rsi/members']) assert.throws(()=>designMetadata({implementation:[path]}));
  const value={...emptyHarness(),designScope:{working:['.rsi/context/design/api/metadata.json'],dependencies:['contracts/metadata.json']},allowedCommands:[{kind:'exact',argv:['bash','-c','npm test']}]};
  assert.equal(harnessConfig(value).designScope.working[0],'api/metadata.json');
  assert.throws(()=>harnessConfig({...value,implementationScope:{paths:['.'],usePaths:[]}}));
  assert.throws(()=>harnessConfig({...value,designScope:{working:['user/a'],dependencies:['user/A']}}));
  assert.throws(()=>commandArgv([]));
  assert.throws(()=>parseBashInput({command:'git status',metadata:{git:{scope:'design',approved:true}}}));
});

test('implementation access derives from accepted mappings; pending files do not expand it',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  const files=await f.team.harness.files(member.memberId);
  const path=join(files.root,'.rsi/context/design',member.harness.designScope.working[0]!);
  await assert.rejects(files.write.writeFile(path,JSON.stringify({implementation:['outside']})),code('access_denied'));
  const lead=await f.team.harness.files(f.lead.memberId);
  await lead.write.mkdir(join(lead.root,'.rsi/context/design/systems/backend'));
  await lead.write.writeFile(join(lead.root,'.rsi/context/design',member.harness.designScope.working[0]!),JSON.stringify({implementation:['outside']}));
  await assert.rejects(files.write.writeFile(join(files.root,'outside/x'),'no'),code('not_found'));
  const prepared=await f.team.harness.prepare(member.memberId,[]);
  assert.deepEqual(prepared.tools.map(t=>t.definition.name).sort(),['bash','edit','find','grep','ls','read','web_fetch','web_search','write']);
  assert.deepEqual((await f.team.inspect(f.workspaceId,member.memberId)).harnesses.map(h=>h.id),['management','implementation','execute']);
}));

test('scoped Bash uses real Git staging and commits, preserving index across automatic checkpoints',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  const files=await f.team.harness.files(member.memberId);
  await files.write.mkdir(join(files.root,'src'));
  await files.write.writeFile(join(files.root,'src/a.txt'),'first');
  const first=await f.team.harness.bash(member.memberId,git('implementation','git add . && git diff --cached --stat'),signal());
  assert.equal(first.exitCode,0,first.output);assert.match(first.output,/src\/a.txt/);
  await files.write.writeFile(join(files.root,'src/a.txt'),'second');
  await f.team.harness.checkpoint(member.memberId,'r1');
  const commit=await f.team.harness.bash(member.memberId,git('implementation','git commit -m "Implement first" && git log --oneline && git diff'),signal());
  assert.equal(commit.exitCode,0,commit.output);assert.match(commit.output,/Implement first/);assert.match(commit.output,/second/);
  const history=await f.team.harness.history(member.memberId,'implementation');
  const accepted=history.find(h=>h.kind==='commit')!;
  assert.equal(await (await f.team.harness.environment(member.memberId)).history.readSnapshot(accepted.revision,'src/a.txt'),'first');
  await files.write.writeFile(join(files.root,'src/a.txt'),'uncheckpointed edit');
  const restore=await f.team.harness.bash(member.memberId,git('implementation','git restore -- src/a.txt'),signal());
  assert.equal(restore.exitCode,0,restore.output);assert.equal(await readFile(join(files.root,'src/a.txt'),'utf8'),'first');
  const log=await f.team.harness.bash(member.memberId,git('implementation','git log --all --oneline'),signal());
  assert.match(log.output,/Implement first/);assert.doesNotMatch(log.output,/Before project Git restore/);
  const env=await f.team.harness.environment(member.memberId);
  const retained=await f.team.harness.history(member.memberId,'implementation');
  assert.ok((await Promise.all(retained.map(r=>env.history.readSnapshot(r.revision,'src/a.txt')))).includes('uncheckpointed edit'));

}));

test('scoped management Git requires user acceptance and its broker scope cannot be retargeted',()=>withTeam(async f=>{
  await f.team.configuration.materialize(f.lead.memberId);
  const files=await f.team.harness.files(f.lead.memberId),manifest=(await f.team.configuration.accepted(f.workspaceId,f.lead.memberId)).path;
  await files.write.writeFile(join(files.root,manifest),JSON.stringify({name:'Pending',designScope:{working:[],dependencies:[]}}));
  const staged=await f.team.harness.bash(f.lead.memberId,git('member-config','git add . && git commit -m "Change members"'),signal());
  assert.equal(staged.exitCode,1,staged.output);assert.match(staged.output,/approval_required/);
  const review=(await f.team.harness.inspect(f.lead.memberId)).parts.find(p=>p.state.part.id==='member-config')!;
  await f.team.harness.commit(f.lead.memberId,'member-config','Accept file change',{type:'user',memberId:f.lead.memberId},review.revision,review.state.committed);
  assert.equal((await f.team.service.get(f.workspaceId,f.lead.memberId)).name,'Lead','committed member bytes never activate settings');
  const status=await f.team.harness.bash(f.lead.memberId,git('member-config','git status --porcelain'),signal());
  assert.equal(status.exitCode,0,status.output);assert.equal(status.output,'');
  const denied=await f.team.harness.bash(f.lead.memberId,git('member-config','git --git-dir=/tmp/else status'),signal());
  assert.notEqual(denied.exitCode,0);assert.match(denied.output,/command_denied/);
  const member=await worker(f,'Backend',['src']);
  await assert.rejects(f.team.harness.bash(member.memberId,git('member-config','git status'),signal()),code('not_found'));
}));

test('Bash writes the whole workspace, reads member files and permits native Git as well as optional scoped routing',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  await f.team.configuration.materialize(f.lead.memberId);
  const manifest=(await f.team.configuration.accepted(f.workspaceId,f.lead.memberId)).path;
  const command=`mkdir -p unrelated; printf broad > unrelated/result.txt; printf pending > .rsi/bash-test; cat ${JSON.stringify(manifest)}; /usr/bin/git init -q; /usr/bin/git status --porcelain`;
  const result=await f.team.harness.bash(member.memberId,{command},signal());
  assert.equal(result.exitCode,0,result.output);
  assert.match(result.output,/Lead/);
  assert.equal(await readFile(join(f.directory,'unrelated/result.txt'),'utf8'),'broad');
  assert.equal(await readFile(join(f.directory,'.rsi/bash-test'),'utf8'),'pending');
  const scoped=await f.team.harness.bash(member.memberId,git('implementation',`${JSON.stringify(process.execPath)} -e 'require("child_process").execFileSync("git",["status","--porcelain"],{stdio:"inherit"})'`),signal());
  assert.equal(scoped.exitCode,0,scoped.output);
}));

test('accepted design Git commits become authoritative for permission derivation and discovery',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['old']);
  const lead=await f.team.harness.files(f.lead.memberId);
  const designPath=member.harness.designScope.working[0]!;
  await lead.write.mkdir(join(lead.root,'.rsi/context/design/systems/backend'));
  await lead.write.writeFile(join(lead.root,'.rsi/context/design/systems/backend/design.md'),'New accepted design');
  await lead.write.writeFile(join(lead.root,'.rsi/context/design',designPath),JSON.stringify({implementation:['new']}));
  const review=(await f.team.harness.inspect(f.lead.memberId)).parts.find(p=>p.state.part.id==='design')!;
  await f.team.harness.commit(f.lead.memberId,'design','Accept new mapping',{type:'user',memberId:f.lead.memberId},review.revision,review.state.committed);
  assert.deepEqual((await f.team.service.get(f.workspaceId,member.memberId)).harness.implementationScope.paths,['new']);
  assert.equal((await f.team.designs.inspect(f.workspaceId,designPath)).design!.content,'New accepted design');
  assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs.find(d=>d.path===designPath)!.implementation,['new']);
}));

test('every member receives broad Bash independently of historical command rules',()=>withTeam(async f=>{
  const plain=await f.team.harness.bash(f.lead.memberId,{command:'printf arbitrary'},signal());
  assert.equal(plain.exitCode,0,plain.output);assert.equal(plain.output,'arbitrary');
  const inspection=await f.team.inspect(f.workspaceId,f.lead.memberId);
  assert.ok(inspection.harnesses.find(h=>h.id==='execute')!.tools.includes('bash'));
  const result=await f.team.harness.bash(f.lead.memberId,git('design','git status --short'),signal());
  assert.equal(result.exitCode,0,result.output);
}));

test('Bash exposes source and toolchains, isolates the backend environment, and preserves session caches',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  await writeFile(join(f.directory,'other-source.txt'),'Readable project source');
  await writeFile(join(f.folder,'personal-secret.txt'),'Not project source');
  process.env.RSI_TEST_BACKEND_SECRET='must-not-be-inherited';
  try {
    const result=await f.team.harness.bash(member.memberId,{command:`node -e 'const fs=require("node:fs"); console.log(JSON.stringify({cwd:process.cwd(),home:process.env.HOME,secret:process.env.RSI_TEST_BACKEND_SECRET??null,source:fs.readFileSync("other-source.txt","utf8")})); fs.writeFileSync(process.env.XDG_CACHE_HOME+"/warm","cached")' && npm --version`},signal());
    assert.equal(result.exitCode,0,result.output);
    const info=JSON.parse(result.output.split('\n')[0]!);
    assert.equal(info.cwd,f.directory);assert.notEqual(info.home,homedir());assert.equal(info.secret,null);assert.equal(info.source,'Readable project source');
    const cached=await f.team.harness.bash(member.memberId,{command:'cat "$XDG_CACHE_HOME/warm"'},signal());
    assert.equal(cached.output,'cached');
    const personal=await f.team.harness.bash(member.memberId,{command:'cat ../personal-secret.txt'},signal());
    assert.equal(personal.exitCode,0,personal.output);assert.equal(personal.output,'Not project source');
    const outsideWrite=await f.team.harness.bash(member.memberId,{command:'printf no > other-source.txt'},signal());
    assert.equal(outsideWrite.exitCode,0,outsideWrite.output);assert.equal(await readFile(join(f.directory,'other-source.txt'),'utf8'),'no');
  } finally { delete process.env.RSI_TEST_BACKEND_SECRET; }
}));

test('Git metadata leaves ordinary implementation writes enabled; denied operations retain earlier effects',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  const result=await f.team.harness.bash(member.memberId,git('implementation','mkdir -p src && printf permitted > src/result.txt && printf denied > ../outside-denied'),signal());
  assert.notEqual(result.exitCode,0);
  assert.equal(await readFile(join(f.directory,'src/result.txt'),'utf8'),'permitted');
  await assert.rejects(readFile(join(f.folder,'outside-denied')),code('ENOENT'));
}));

test('Bash permits local binding and resolves localhost for HTTP requests',()=>withTeam(async f=>{
  const script='const http=require("node:http"); const server=http.createServer((req,res)=>res.end("local-ok")); server.listen(0,"127.0.0.1",async()=>{try{const response=await fetch("http://localhost:"+server.address().port); console.log(await response.text())}catch(error){console.error(error);process.exitCode=1}finally{server.close()}})';
  const result=await f.team.harness.bash(f.lead.memberId,{command:`node -e '${script}'`},signal());
  assert.equal(result.exitCode,0,result.output);assert.match(result.output,/local-ok/);
}));

test('npm can install a local dependency into working implementation without a command allowance',()=>withTeam(async f=>{
  const member=await worker(f,'Frontend',['src']);
  const files=await f.team.harness.files(member.memberId);
  await files.write.mkdir(join(f.directory,'src/local-package'));
  await files.write.writeFile(join(f.directory,'src/local-package/package.json'),JSON.stringify({name:'local-package',version:'1.0.0',main:'index.js'}));
  await files.write.writeFile(join(f.directory,'src/local-package/index.js'),'module.exports = "installed";');
  await files.write.writeFile(join(f.directory,'src/package.json'),JSON.stringify({name:'sandbox-test',version:'1.0.0',private:true,dependencies:{'local-package':'file:./local-package'}}));
  const result=await f.team.harness.bash(member.memberId,{command:'cd src && npm install --offline --ignore-scripts --no-audit --no-fund --package-lock=false && node -e \'console.log(require("local-package"))\''},signal());
  assert.equal(result.exitCode,0,result.output);assert.match(result.output,/installed/);
}));

test('independent scope staging survives implementation commits while Bash can write dependencies',()=>withTeam(async f=>{
  const backend=await worker(f,'Backend',['src']);
  const member=f.lead;
  await seedDesign(f.workspaces, f.workspaceId, 'dependency/metadata.json', {content:'Read only',implementation:['src/shared']});
  await configureHarness(f,'Lead',{designScope:{working:backend.harness.designScope.working,dependencies:['dependency/metadata.json']},allowedCommands:[{kind:'executable',executable:'bash'}]});
  const files=await f.team.harness.files(member.memberId);
  const design=join(files.root,'.rsi/context/design/systems/backend/design.md');
  await files.write.mkdir(join(files.root,'.rsi/context/design/systems/backend'));
  await files.write.writeFile(design,'Pending');
  await files.write.writeFile(join(files.root,'.rsi/context/design/systems/backend/metadata.json'),JSON.stringify({implementation:['src']}));
  await files.write.mkdir(join(files.root,'src'));await files.write.writeFile(join(files.root,'src/a.txt'),'Own implementation');
  assert.equal((await f.team.harness.bash(member.memberId,git('design','git add .'),signal())).exitCode,0);
  const committed=await f.team.harness.bash(member.memberId,git('implementation','git add . && git commit -m "Implement independently"'),signal());
  assert.equal(committed.exitCode,0,committed.output);
  const staged=await f.team.harness.bash(member.memberId,git('design','git diff --cached'),signal());
  assert.match(staged.output,/Pending/);assert.doesNotMatch(staged.output,/Own implementation/);
  const read=await f.team.harness.bash(member.memberId,{command:'cat .rsi/context/design/dependency/design.md'},signal());
  assert.equal(read.exitCode,0,read.output);assert.match(read.output,/Read only/);
  const write=await f.team.harness.bash(member.memberId,{command:'mkdir -p src/shared && printf escape > src/shared/x.txt'},signal());
  assert.equal(write.exitCode,0,write.output);assert.equal(await readFile(join(f.directory,'src/shared/x.txt'),'utf8'),'escape');
}));

test('members share pending and committed implementation without synchronization or worktree creation',()=>withTeam(async f=>{
  const a=await worker(f,'Backend',['src']),b=await worker(f,'Other',['src']);
  const af=await f.team.harness.files(a.memberId),bf=await f.team.harness.files(b.memberId);
  assert.equal(af.root,f.directory);assert.equal(bf.root,f.directory);
  await af.write.mkdir(join(af.root,'src'));await af.write.writeFile(join(af.root,'src/a.txt'),'First');
  assert.equal((await bf.read.readFile(join(bf.root,'src/a.txt'))).toString(),'First');
  const commit=await f.team.harness.bash(a.memberId,git('implementation','git add . && git commit -m "First"'),signal());assert.equal(commit.exitCode,0,commit.output);
  await bf.write.writeFile(join(bf.root,'src/a.txt'),'Second');
  const fresh=await f.team.harness.bash(b.memberId,git('implementation','git add . && git commit -m "Second" && git log --oneline'),signal());assert.equal(fresh.exitCode,0,fresh.output);
  assert.match(fresh.output,/First/);assert.match(fresh.output,/Second/);
  assert.equal(await readFile(join(af.root,'src/a.txt'),'utf8'),'Second');
  await assert.rejects(readFile(join(f.directory,'.rsi/harness/worktrees',a.memberId,'.git')),code('ENOENT'));
}));

test('a file-sized implementation scope stages and commits inside the shared project repository',()=>withTeam(async f=>{
  const member=await worker(f,'File Worker',['src/result.txt']);
  const files=await f.team.harness.files(member.memberId);
  await files.write.mkdir(join(files.root,'src')); await files.write.writeFile(join(files.root,'src/result.txt'),'Done');
  const result=await f.team.harness.bash(member.memberId,git('implementation','git status --short && git add . && git diff --cached && git commit -m "Implement file"'),signal());
  assert.equal(result.exitCode,0,JSON.stringify(result));
  assert.ok((await f.team.harness.history(member.memberId,'implementation')).some(r=>r.kind==='commit' && r.actor.type==='agent'));
  await files.write.writeFile(join(files.root,'src/result.txt'),'Changed');
  const restored=await f.team.harness.bash(member.memberId,git('implementation','git restore -- src/result.txt'),signal());
  assert.equal(restored.exitCode,0,restored.output);
  assert.equal(await readFile(join(files.root,'src/result.txt'),'utf8'),'Done');
}));


test('project Git preserves user branch/history and refuses unrelated shared-index staging',()=>withTeam(async f=>{
  const exec=promisify(execFile);
  await exec('git',['init','-b','user-review',f.directory]);
  await writeFile(join(f.directory,'user.txt'),'User initial');
  await exec('git',['-C',f.directory,'add','user.txt']);
  await exec('git',['-C',f.directory,'-c','user.name=User','-c','user.email=user@localhost','commit','-m','User baseline']);
  const head=(await exec('git',['-C',f.directory,'rev-parse','HEAD'])).stdout.trim();
  const member=await worker(f,'Backend',['src']);
  const files=await f.team.harness.files(member.memberId);
  await files.write.mkdir(join(files.root,'src'));
  await files.write.writeFile(join(files.root,'src/result.txt'),'Implementation');
  await writeFile(join(f.directory,'user.txt'),'User pending');
  await exec('git',['-C',f.directory,'add','user.txt']);
  const denied=await f.team.harness.bash(member.memberId,git('implementation','git add . && git commit -m "Must not include user changes"'),signal());
  assert.equal(denied.exitCode,1);assert.match(denied.output,/outside your implementation scope/);
  assert.equal((await exec('git',['-C',f.directory,'show',':user.txt'])).stdout,'User pending');
  assert.equal((await exec('git',['-C',f.directory,'rev-parse','HEAD'])).stdout.trim(),head);
  await exec('git',['-C',f.directory,'restore','--staged','--','user.txt']);
  const committed=await f.team.harness.bash(member.memberId,git('implementation','git commit -m "Implement result"'),signal());
  assert.equal(committed.exitCode,0,committed.output);
  assert.equal((await exec('git',['-C',f.directory,'branch','--show-current'])).stdout.trim(),'user-review');
  assert.equal((await exec('git',['-C',f.directory,'rev-parse','HEAD^'])).stdout.trim(),head);
  assert.equal((await exec('git',['-C',f.directory,'show','HEAD:user.txt'])).stdout,'User initial');
  assert.equal(await readFile(join(f.directory,'user.txt'),'utf8'),'User pending');
  assert.equal((await exec('git',['-C',f.directory,'show','HEAD:src/result.txt'])).stdout,'Implementation');
}));


test('root implementation checkpoints omit Git-ignored dependencies and build output',()=>withTeam(async f=>{
  const member=await worker(f,'Root',['.']);
  await writeFile(join(f.directory,'.gitignore'),'node_modules/\ndist/\n.rsi/\n');
  const files=await f.team.harness.files(member.memberId);
  await files.write.mkdir(join(files.root,'node_modules'));
  await files.write.writeFile(join(files.root,'node_modules/cache.txt'),'Generated dependency');
  await files.write.writeFile(join(files.root,'source.txt'),'Source');
  const revisions=await f.team.harness.checkpoint(member.memberId,'root-check');
  const revision=revisions.find((_,i)=>i===0)!;
  const env=await f.team.harness.environment(member.memberId);
  assert.ok((await env.history.paths(revision.revision)).includes('source.txt'));
  assert.ok(!(await env.history.paths(revision.revision)).some(p=>p.startsWith('node_modules/')));
}));
