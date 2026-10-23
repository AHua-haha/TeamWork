import { acceptFiles, initGit } from './git-fixture.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { seedDesign } from './design-fixture.js';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { test } from 'node:test';
import { designMetadata } from '../src/core/design.js';
import { commandArgv, emptyHarness, harnessConfig } from '../src/core/harness-config.js';
import { parseBashInput } from '../src/core/harness-command.js';
import { code, configureHarness, withTeam, worker } from './team-fixture.js';

const signal = () => new AbortController().signal;
const git = (scope: string, command: string) => ({ command });

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

test('Bash writes the whole workspace, reads member files and permits native project Git',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
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
  await acceptFiles(f,'.rsi/context/design','Accept new mapping');
  assert.deepEqual((await f.team.service.get(f.workspaceId,member.memberId)).harness.implementationScope.paths,['new']);
  assert.equal((await f.team.designs.inspect(f.workspaceId,designPath)).design!.content,'New accepted design');
  assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs.find(d=>d.path===designPath)!.implementation,['new']);
}));

test('every member receives broad Bash independently of historical command rules',()=>withTeam(async f=>{
  const plain=await f.team.harness.bash(f.lead.memberId,{command:'printf arbitrary'},signal());
  assert.equal(plain.exitCode,0,plain.output);assert.equal(plain.output,'arbitrary');
  const inspection=await f.team.inspect(f.workspaceId,f.lead.memberId);
  assert.ok(inspection.harnesses.find(h=>h.id==='execute')!.tools.includes('bash'));
  const result=await f.team.harness.bash(f.lead.memberId,git('design','git init -q && git status --short'),signal());
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

test('Bash leaves ordinary implementation writes enabled; denied operations retain earlier effects',()=>withTeam(async f=>{
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

test('members share pending and committed implementation without synchronization or worktree creation',()=>withTeam(async f=>{
  const a=await worker(f,'Backend',['src']),b=await worker(f,'Other',['src']);
  await initGit(f);
  const af=await f.team.harness.files(a.memberId),bf=await f.team.harness.files(b.memberId);
  assert.equal(af.root,f.directory);assert.equal(bf.root,f.directory);
  await af.write.mkdir(join(af.root,'src'));await af.write.writeFile(join(af.root,'src/a.txt'),'First');
  assert.equal((await bf.read.readFile(join(bf.root,'src/a.txt'))).toString(),'First');
  const commit=await f.team.harness.bash(a.memberId,git('implementation','git add src && git commit -m "First"'),signal());assert.equal(commit.exitCode,0,commit.output);
  await bf.write.writeFile(join(bf.root,'src/a.txt'),'Second');
  const fresh=await f.team.harness.bash(b.memberId,git('implementation','git add src && git commit -m "Second" && git log --oneline'),signal());assert.equal(fresh.exitCode,0,fresh.output);
  assert.match(fresh.output,/First/);assert.match(fresh.output,/Second/);
  assert.equal(await readFile(join(af.root,'src/a.txt'),'utf8'),'Second');
  await assert.rejects(readFile(join(f.directory,'.rsi/harness/worktrees',a.memberId,'.git')),code('ENOENT'));
}));
