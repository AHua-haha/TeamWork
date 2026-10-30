import {resolveAssignment} from '../src/core/team/member-workspace.js';
import { memberBash } from './team-fixture.js';
import { acceptFiles, initGit } from './git-fixture.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { seedDesign } from './design-fixture.js';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { test } from 'node:test';
import { emptyDesignScope, parseDesignScope } from '../src/core/team/data/assignment.js';
import { parseBashInput } from '../src/core/react-harness/default/bash.js';
import { code, configureAssignment, withTeam, worker } from './team-fixture.js';

const signal = () => new AbortController().signal;
const git = (scope: string, command: string) => ({ command });

test('assignment accepts design references only and never agent-owned implementation paths or authority metadata', () => {
  const value={working:['api/_ctx/DESIGN.md'],dependencies:['contracts/metadata.json']};
  assert.equal(parseDesignScope(value).working[0],'api/_ctx/DESIGN.md');
  assert.throws(()=>parseDesignScope({...value,allowedCommands:[]}));
  assert.throws(()=>parseDesignScope({working:['user/a'],dependencies:['user/A']}));
  assert.throws(()=>parseBashInput({command:'git status',metadata:{git:{scope:'design',approved:true}}}));
});


test('Bash writes the whole workspace, reads member files and permits native project Git',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  const manifest=(await f.team.configuration.activeSource(f.workspaceId,f.lead.memberId)).path;
  const command=`mkdir -p unrelated; printf broad > unrelated/result.txt; printf pending > .rsi/bash-test; cat ${JSON.stringify(manifest)}; /usr/bin/git init -q; /usr/bin/git status --porcelain`;
  const result=await memberBash(f.team, member.memberId,{command},signal());
  assert.equal(result.exitCode,0,result.output);
  assert.match(result.output,/Lead/);
  assert.equal(await readFile(join(f.directory,'unrelated/result.txt'),'utf8'),'broad');
  assert.equal(await readFile(join(f.directory,'.rsi/bash-test'),'utf8'),'pending');
  const scoped=await memberBash(f.team, member.memberId,git('implementation',`${JSON.stringify(process.execPath)} -e 'require("child_process").execFileSync("git",["status","--porcelain"],{stdio:"inherit"})'`),signal());
  assert.equal(scoped.exitCode,0,scoped.output);
}));

test('accepted design Git commits update assignment guidance and discovery',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['old']);
  const lead=await f.team.memberWorkspace.files(f.lead.memberId);
  const designPath=member.designScope.working[0]!;
  await lead.write.mkdir(join(lead.root,'.rsi/project/systems/backend'));
  await lead.write.mkdir(join(lead.root,'.rsi/project/systems/backend/_ctx'));
  await lead.write.writeFile(join(lead.root,'.rsi/project/systems/backend/_ctx/DESIGN.md'),'New accepted design');

  await acceptFiles(f,'.rsi/project','Accept new mapping');
  assert.deepEqual((await resolveAssignment(f.team.designs,f.workspaceId,(await f.team.service.get(f.workspaceId,member.memberId)).designScope)).working.flatMap(d=>d.implementation),['systems/backend']);
  assert.equal((await f.team.designs.inspect(f.workspaceId,designPath)).design!.content,'New accepted design');
  assert.deepEqual((await f.team.designs.list(f.workspaceId)).designs.find(d=>d.path==='systems/backend/_ctx/DESIGN.md')!.implementation,['systems/backend']);
}));

test('every member receives broad Bash independently of historical command rules',()=>withTeam(async f=>{
  const plain=await memberBash(f.team, f.lead.memberId,{command:'printf arbitrary'},signal());
  assert.equal(plain.exitCode,0,plain.output);assert.equal(plain.output,'arbitrary');
  assert.equal('harness' in await f.team.member(f.workspaceId,f.lead.memberId),false);
  const result=await memberBash(f.team, f.lead.memberId,git('design','git init -q && git status --short'),signal());
  assert.equal(result.exitCode,0,result.output);
}));

test('Bash exposes source and toolchains, filters backend secrets and preserves session state',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  await writeFile(join(f.directory,'other-source.txt'),'Readable project source');
  await writeFile(join(f.folder,'personal-secret.txt'),'Not project source');
  process.env.RSI_TEST_BACKEND_SECRET='must-not-be-inherited';
  try {
    const result=await memberBash(f.team, member.memberId,{command:`node -e 'const fs=require("node:fs"); console.log(JSON.stringify({cwd:process.cwd(),home:process.env.HOME,secret:process.env.RSI_TEST_BACKEND_SECRET??null,source:fs.readFileSync("other-source.txt","utf8")})); fs.writeFileSync("session-cache","cached")' && npm --version`},signal());
    assert.equal(result.exitCode,0,result.output);
    const info=JSON.parse(result.output.split('\n')[0]!);
    assert.equal(info.cwd,f.directory);assert.equal(info.home,homedir());assert.equal(info.secret,null);assert.equal(info.source,'Readable project source');
    const cached=await memberBash(f.team, member.memberId,{command:'cat session-cache'},signal());
    assert.equal(cached.output,'cached');
    const personal=await memberBash(f.team, member.memberId,{command:'cat ../personal-secret.txt'},signal());
    assert.equal(personal.exitCode,0,personal.output);assert.equal(personal.output,'Not project source');
    const outsideWrite=await memberBash(f.team, member.memberId,{command:'printf no > other-source.txt'},signal());
    assert.equal(outsideWrite.exitCode,0,outsideWrite.output);assert.equal(await readFile(join(f.directory,'other-source.txt'),'utf8'),'no');
  } finally { delete process.env.RSI_TEST_BACKEND_SECRET; }
}));

test('Bash permits project and outside writes without a policy layer',()=>withTeam(async f=>{
  const member=await worker(f,'Backend',['src']);
  const result=await memberBash(f.team, member.memberId,git('implementation','mkdir -p src && printf permitted > src/result.txt && printf denied > ../outside-denied'),signal());
  assert.equal(result.exitCode,0);
  assert.equal(await readFile(join(f.directory,'src/result.txt'),'utf8'),'permitted');
  assert.equal(await readFile(join(f.folder,'outside-denied'),'utf8'),'denied');
}));

test('Bash permits local binding and resolves localhost for HTTP requests',()=>withTeam(async f=>{
  const script='const http=require("node:http"); const server=http.createServer((req,res)=>res.end("local-ok")); server.listen(0,"127.0.0.1",async()=>{try{const response=await fetch("http://localhost:"+server.address().port); console.log(await response.text())}catch(error){console.error(error);process.exitCode=1}finally{server.close()}})';
  const result=await memberBash(f.team, f.lead.memberId,{command:`node -e '${script}'`},signal());
  assert.equal(result.exitCode,0,result.output);assert.match(result.output,/local-ok/);
}));

test('npm can install a local dependency into working implementation without a command allowance',()=>withTeam(async f=>{
  const member=await worker(f,'Frontend',['src']);
  const files=await f.team.memberWorkspace.files(member.memberId);
  await files.write.mkdir(join(f.directory,'src/local-package'));
  await files.write.writeFile(join(f.directory,'src/local-package/package.json'),JSON.stringify({name:'local-package',version:'1.0.0',main:'index.js'}));
  await files.write.writeFile(join(f.directory,'src/local-package/index.js'),'module.exports = "installed";');
  await files.write.writeFile(join(f.directory,'src/package.json'),JSON.stringify({name:'sandbox-test',version:'1.0.0',private:true,dependencies:{'local-package':'file:./local-package'}}));
  const result=await memberBash(f.team, member.memberId,{command:'cd src && npm install --offline --ignore-scripts --no-audit --no-fund --package-lock=false && node -e \'console.log(require("local-package"))\''},signal());
  assert.equal(result.exitCode,0,result.output);assert.match(result.output,/installed/);
}));

test('members share pending and committed implementation without synchronization or worktree creation',()=>withTeam(async f=>{
  const a=await worker(f,'Backend',['src']),b=await worker(f,'Other',['src']);
  await initGit(f);
  const af=await f.team.memberWorkspace.files(a.memberId),bf=await f.team.memberWorkspace.files(b.memberId);
  assert.equal(af.root,f.directory);assert.equal(bf.root,f.directory);
  await af.write.mkdir(join(af.root,'src'));await af.write.writeFile(join(af.root,'src/a.txt'),'First');
  assert.equal((await bf.read.readFile(join(bf.root,'src/a.txt'))).toString(),'First');
  const commit=await memberBash(f.team, a.memberId,git('implementation','git add src && git commit -m "First"'),signal());assert.equal(commit.exitCode,0,commit.output);
  await bf.write.writeFile(join(bf.root,'src/a.txt'),'Second');
  const fresh=await memberBash(f.team, b.memberId,git('implementation','git add src && git commit -m "Second" && git log --oneline'),signal());assert.equal(fresh.exitCode,0,fresh.output);
  assert.match(fresh.output,/First/);assert.match(fresh.output,/Second/);
  assert.equal(await readFile(join(af.root,'src/a.txt'),'utf8'),'Second');
  await assert.rejects(readFile(join(f.directory,'.rsi/harness/worktrees',a.memberId,'.git')),code('ENOENT'));
}));
