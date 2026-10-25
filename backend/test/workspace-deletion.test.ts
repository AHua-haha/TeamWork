import assert from 'node:assert/strict';
import {lstat, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {WorkspaceService} from '../src/core/workspace/workspace.js';
import {code, withTeam} from './team-fixture.js';
import {testModels, testModelValidator, MemoryStore, withFolder} from './memory-store.js';

async function files(directory: string): Promise<Record<string,string>> {
  const result:Record<string,string>={};
  const visit=async(prefix:string)=>{
    for(const name of await readdir(join(directory,prefix))){
      const path=prefix?`${prefix}/${name}`:name,info=await lstat(join(directory,path));
      if(info.isDirectory())await visit(path);
      else if(info.isFile())result[path]=(await readFile(join(directory,path))).toString('base64');
    }
  };
  await visit('');return result;
}

test('deleting a workspace preserves every file and permits reviewed re-adoption with a fresh lead',()=>withTeam(async f=>{
  await writeFile(join(f.directory,'keep.txt'),'project file');
  const before=await files(f.directory),oldLead=f.lead.memberId;
  const context=await f.workspaces.context(f.workspaceId);
  await f.team.deleteWorkspace(f.workspaceId);
  assert.deepEqual(await files(f.directory),before);
  assert.equal(await f.store.getMember(oldLead),null);
  assert.deepEqual(await f.workspaces.list(),[]);
  await assert.rejects(f.workspaces.get(f.workspaceId),code('not_found'));
  await assert.rejects(context.overview(),code('workspace_unavailable'));
  await assert.rejects(f.team.deleteWorkspace(f.workspaceId),code('not_found'));
  const review=await f.workspaces.inspectInitialization({directory:f.directory,adopt:true});
  assert.deepEqual(review.cleanupPaths,['.rsi/members']);
  const next=await f.workspaces.create({name:'Reopened',directory:f.directory,adopt:true,models:testModels(),cleanupRevision:review.cleanupRevision!});
  assert.notEqual(next.workspaceId,f.workspaceId);
  assert.notEqual((await f.team.team(next.workspaceId)).members[0]!.memberId,oldLead);
  for(const [path,content]of Object.entries(before).filter(([p])=>p.startsWith('.rsi/context/')))
    assert.equal((await readFile(join(f.directory,path))).toString('base64'),content);
}));

test('a running member blocks deletion without changing files or registration',()=>withTeam(async f=>{
  await f.team.runner.postUser(f.workspaceId,'Work');
  const before=await files(f.directory);
  await assert.rejects(f.team.deleteWorkspace(f.workspaceId),code('workspace_busy'));
  assert.ok(await f.store.getWorkspace(f.workspaceId));
  assert.ok(await f.store.getMember(f.lead.memberId));
  assert.deepEqual(await files(f.directory),before);
}));

test('failed database deletion invalidates closed context handles and allows durable state to reopen',()=>withFolder(async folder=>{
  const store=new MemoryStore(),service=new WorkspaceService(store,testModelValidator);
  try{
    const workspace=await service.create({name:'Failure',directory:join(folder,'project'),adopt:false,models:testModels()});
    const original=await service.context(workspace.workspaceId);
    store.deleteWorkspace=async()=>{throw new Error('database failed');};
    await assert.rejects(service.delete(workspace.workspaceId),/database failed/);
    assert.ok(await store.getWorkspace(workspace.workspaceId));
    const reopened=await service.context(workspace.workspaceId);
    assert.notEqual(reopened,original);assert.equal((await reopened.overview()).files,3);
  }finally{await service.close();}
}));

test('workspace removal does not require its project folder to exist',()=>withFolder(async folder=>{
  const store=new MemoryStore(),service=new WorkspaceService(store,testModelValidator);
  try{
    const directory=join(folder,'missing');
    const workspace=await service.create({name:'Missing',directory,adopt:false,models:testModels()});
    await rm(directory,{recursive:true});
    await service.delete(workspace.workspaceId);
    assert.equal(await store.getWorkspace(workspace.workspaceId),null);
    await assert.rejects(lstat(directory),code('ENOENT'));
  }finally{await service.close();}
}));

test('deletion stops a member shell and its background job without changing project files', {timeout:15000},()=>withTeam(async f=>{
  const signal=new AbortController().signal;
  const started=await f.team.harness.bash(f.lead.memberId,{command:'sleep 60',background:true},signal);
  assert.ok(started.jobId);
  const result=await f.team.harness.bash(f.lead.memberId,{command:'jobs -p'},signal);
  const pid=Number(result.output.trim());assert.ok(Number.isSafeInteger(pid)&&pid>0,result.output);
  const before=await files(f.directory);
  await f.team.deleteWorkspace(f.workspaceId);
  assert.throws(()=>process.kill(pid,0),code('ESRCH'));
  assert.deepEqual(await files(f.directory),before);
},false));

test('a delayed registry read cannot resurrect a deleted workspace in the service cache',()=>withFolder(async folder=>{
  const store=new MemoryStore(),first=new WorkspaceService(store,testModelValidator);
  const workspace=await first.create({name:'Delayed',directory:join(folder,'project'),adopt:false,models:testModels()});
  await first.close();
  const service=new WorkspaceService(store,testModelValidator),get=store.getWorkspace.bind(store);
  let release!:()=>void,entered!:()=>void,delay=true;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  const started=new Promise<void>(resolve=>{entered=resolve;});
  store.getWorkspace=async id=>{
    const value=await get(id);
    if(delay){delay=false;entered();await waiting;}
    return value;
  };
  try{
    const stale=service.record(workspace.workspaceId);
    await started;
    await service.delete(workspace.workspaceId);
    release();
    await assert.rejects(stale,code('workspace_busy'));
    await assert.rejects(service.record(workspace.workspaceId),code('not_found'));
  }finally{release();await service.close();}
}));
