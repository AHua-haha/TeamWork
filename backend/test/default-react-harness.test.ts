import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, readFile, writeFile, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import type {StepScope} from '../src/core/agent/contracts.js';
import {DefaultReactHarness} from '../src/core/react-harness/default/harness.js';
import {teamTools} from '../src/core/team/member-tools.js';
import {withTeam, worker} from './team-fixture.js';
const scope = (agentId: string) => ({agentId,runId:'tools-run',signal:new AbortController().signal} as StepScope);
const text=(result:{content:{type:string;text?:string}[]})=>result.content.map(b=>b.type==='text'?b.text:'').join('');

test('Default React Harness owns native search and custom executors but never read/write/edit declarations',()=>withTeam(async f=>{
 const member=await worker(f,'Backend',['src']);
 await mkdir(join(f.directory,'other'));await writeFile(join(f.directory,'other/fact.txt'),'unassigned FACT\n');
 await writeFile(join(f.folder,'outside.txt'),'outside FACT');await symlink(join(f.folder,'outside.txt'),join(f.directory,'other/link.txt'));
 const harness=new DefaultReactHarness(f.directory);
 const tools=harness.tools();assert.deepEqual(tools.map(t=>t.definition.name).sort(),['bash','find','grep','ls']);
 const call=async(name:string,args:Record<string,unknown>)=>tools.find(t=>t.definition.name===name)!.execute(args as never,scope(member.memberId),{id:name} as never);
 assert.match(text(await call('ls',{path:'other'})),/fact.txt/);
 assert.match(text(await call('grep',{path:'other',pattern:'FACT'})),/fact.txt:1: unassigned FACT/);
 assert.match(text(await call('find',{path:f.folder,pattern:'outside.txt'})),/outside.txt/);
 const result=await call('bash',{cwd:f.folder,command:'printf unrestricted > outside.txt'});
 assert.equal(result.isError,false);assert.equal(await readFile(join(f.folder,'outside.txt'),'utf8'),'unrestricted');
 assert.match(await harness.systemPrompt(),/without design-scope/);
}));

test('custom management and Bash preserve content, metadata, recoverable errors and reset lifecycle',()=>withTeam(async f=>{
 const member=await worker(f,'Backend',['src']);
 const {management}=teamTools(f.team.service,f.team.configuration);
 const tools=new DefaultReactHarness(f.directory,management).tools();
 const call=async(name:string,args:Record<string,unknown>)=>tools.find(t=>t.definition.name===name)!.execute(args as never,scope(member.memberId),{id:name} as never);
 assert.match(text(await call('list_models',{})),/^## Workspace models[\s\S]*<metadata>/);
 assert.match(text(await call('validate_member_config',{path:'.rsi/members'})),/^## Member configuration validation/);
 const failure=await call('bash',{command:'printf problem >&2; false'});
 assert.equal(failure.isError,true);assert.match(text(failure),/^problem\n\n<metadata>/);
 await call('bash',{command:'export FLAG=old'});await f.team.runner.reset(f.workspaceId);
 const fresh=await call('bash',{command:'printf "${FLAG:-fresh}"'});
 assert.match(text(fresh),/^fresh/);assert.match(text(fresh),/shell_restarted: true/);
}));

test('Bash tool timeout keeps real output separate from metadata recovery instructions',{timeout:15000},()=>withTeam(async f=>{
 const tool=new DefaultReactHarness(f.directory).tools().find(t=>t.definition.name==='bash')!;
 const call=(args:Record<string,unknown>)=>tool.execute(args as never,scope(f.lead.memberId),{id:'timeout'} as never);
 const result=await call({command:"printf 'install-started\\n'; sleep 10",timeout:.15});
 assert.equal(result.isError,true);const output=text(result),boundary=output.lastIndexOf('<metadata>');
 assert.match(output.slice(0,boundary),/^install-started\n/);assert.doesNotMatch(output.slice(0,boundary),/hint:|execution limit/);
 assert.match(output.slice(boundary),/error_code: "tool_timeout"/);assert.match(output.slice(boundary),/not a network timeout/);assert.match(output.slice(boundary),/background: true/);
 const fresh=await call({command:'printf fresh'});assert.match(text(fresh),/^fresh\n\n<metadata>/);assert.match(text(fresh),/shell_restarted: true/);
 const network=await call({command:"printf 'Network timeout from installer' >&2; (exit 28)"});
 assert.equal(network.isError,true);assert.doesNotMatch(text(network),/tool_timeout|hint:/);
 const job=await call({command:'sleep .05',background:true});assert.ok((job.details as {job_id:number}).job_id);assert.equal(job.isError,false);
}));

test('native Git commits mixed files, honors hooks, amends and runs in background without an approval broker',()=>withTeam(async f=>{
 const {initGit}=await import('./git-fixture.js');await initGit(f);
 const tool=new DefaultReactHarness(f.directory).tools().find(t=>t.definition.name==='bash')!;
 const call=(command:string,background=false)=>tool.execute({command,background},scope(f.lead.memberId),{id:'git'} as never);
 await writeFile(join(f.directory,'source.txt'),'source');
 const hook=join(f.directory,'.git/hooks/pre-commit');await writeFile(hook,'#!/bin/sh\nprintf hook-ran > hook-result\n',{mode:0o755});
 const committed=await call('git add -f source.txt .rsi/project .rsi/members; git commit -m "Mixed native commit"');
 assert.equal(committed.isError,false,text(committed));assert.match(text(committed),/Mixed native commit/);
 assert.equal(await readFile(join(f.directory,'hook-result'),'utf8'),'hook-ran');
 const amended=await call('git commit --amend --no-edit');assert.equal(amended.isError,false,text(amended));
 const job=await call('git commit --allow-empty -m "Background commit" > git.log 2>&1',true);
 assert.equal(job.isError,false);const id=(job.details as {job_id:number}).job_id;assert.ok(id);
 const finished=await call(`wait %${id}; cat git.log; git log -1 --format=%s`);
 assert.equal(finished.isError,false,text(finished));assert.match(text(finished),/Background commit/);
}));
