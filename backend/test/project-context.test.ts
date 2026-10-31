import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {DesignService} from '../src/core/workspace/design.js';
import {WorkspaceService} from '../src/core/workspace/workspace.js';
import {migratedReference, projectNode, workspaceContext} from '../src/core/workspace/project-context.js';
import {TeamSystem} from '../src/core/team/team-system.js';
import {MemoryStore, testModels, testModelValidator, withFolder} from './memory-store.js';
import {FakeRuntime,stubConfig} from './team-fixture.js';
const code = (expected: string) => (error: unknown) => (error as {code?: string}).code === expected;

async function withProject(action: (f: {directory:string; workspaceId:string; store:MemoryStore; service:WorkspaceService; designs:DesignService})=>Promise<void>) {
  await withFolder(async folder => {
    const store = new MemoryStore(), service = new WorkspaceService(store, testModelValidator), directory = join(folder,'my-project');
    try {
      const {workspaceId} = await service.create({name:'A display name',directory,models:testModels(),adopt:false});
      await action({directory,workspaceId,store,service,designs:new DesignService(service)});
    } finally {await service.close();}
  });
}

test('fresh initialization creates project-named context with DESIGN only and a usable root-design lead',()=>withProject(async f=>{
  const layout = await workspaceContext(f.directory);
  assert.deepEqual(layout,{root:'.rsi/my-project',kind:'project',rootDesign:'_ctx/DESIGN.md'});
  assert.deepEqual(await readdir(join(f.directory,layout.root,'_ctx')),['DESIGN.md']);
  const root = await f.designs.read(f.workspaceId,layout.rootDesign);
  assert.deepEqual(root.implementation,['.']);
  assert.match(root.content,/A display name/);
  const team = new TeamSystem(f.store,f.service,stubConfig);
  try {
    const lead = (await team.service.team(f.workspaceId)).members[0]!;
    assert.equal(lead.ready,true); assert.deepEqual(lead.designScope.working,['_ctx/DESIGN.md']);
    assert.equal((await team.configuration.validate(lead.memberId,'.rsi/members')).valid,true);
    assert.equal('guidance' in team.memberWorkspace,false);
  } finally {await team.closeMaintenance();await team.runner.close();}
}));

test('only DESIGN entries define parts; contracts and internal notes are optional and do not create children',()=>withProject(async f=>{
  await mkdir(join(f.directory,'backend/src/agents'),{recursive:true});
  await mkdir(join(f.directory,'backend/src/agent'),{recursive:true});
  await writeFile(join(f.directory,'backend/src/agent/agent.ts'),'Agent source');
  const root=join(f.directory,'.rsi/my-project');
  for(const [path,content] of Object.entries({
    'backend/src/agent/_ctx/DESIGN.md':'# Agent design',
    'backend/src/agent/agent.ts.ctx/DESIGN.md':'# Agent file design',
    'backend/src/agent/_ctx/internal/files.md':'helpers.ts has no independent context',
    'backend/src/agent/_ctx/README.md':'A usage contract',
    'backend/src/agent/_ctx/internal/README.md':'Old internal notes',
    'backend/src/agents/_ctx/DESIGN.md':'# Sibling',
  })){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),content);}
  await f.designs.refresh(f.workspaceId);
  assert.deepEqual((await f.designs.list(f.workspaceId)).designs.map(d=>d.path),[
    '_ctx/DESIGN.md','backend/src/agent/_ctx/DESIGN.md','backend/src/agent/agent.ts.ctx/DESIGN.md','backend/src/agents/_ctx/DESIGN.md',
  ]);
  const own = await f.designs.working(f.workspaceId,['backend/src/agent/_ctx/DESIGN.md']);
  assert.deepEqual(own.map(d=>d.implementation[0]),['backend/src/agent','backend/src/agent/agent.ts']);
  const file = await f.designs.working(f.workspaceId,['backend/src/agent/agent.ts.ctx/DESIGN.md']);
  assert.equal(file.length,1);
  assert.equal((await f.designs.working(f.workspaceId,['_ctx/DESIGN.md'])).length,4);
  assert.throws(()=>projectNode('backend/_ctx/internal/foo/_ctx/DESIGN.md'),code('invalid_path'));
  assert.equal(projectNode('design/one.ts.ctx/DESIGN.md'),'design/one.ts');
}));

test('initialization preserves existing project context bytes, optional missing contracts and cleanup consent',()=>withFolder(async folder=>{
  const directory = join(folder,'project'), root = join(directory,'.rsi/project');
  const content = '# Existing user design\n';
  await mkdir(join(root,'_ctx'),{recursive:true}); await writeFile(join(root,'_ctx/DESIGN.md'),content);
  await mkdir(join(root,'src/foo.ts.ctx'),{recursive:true});await writeFile(join(root,'src/foo.ts.ctx/DESIGN.md'),'# File');
  await mkdir(join(directory,'src'),{recursive:true});await writeFile(join(directory,'src/foo.ts'),'Source');
  await mkdir(join(directory,'.rsi/members'),{recursive:true});await writeFile(join(directory,'.rsi/members/old.json'),'old');
  const store = new MemoryStore(), service = new WorkspaceService(store,testModelValidator);
  try {
    const review = await service.inspectInitialization({directory,adopt:true});
    assert.deepEqual(review.cleanupPaths,['.rsi/members']);
    await assert.rejects(service.create({name:'Project',directory,models:testModels(),adopt:true}),code('cleanup_required'));
    const w = await service.create({name:'Project',directory,models:testModels(),adopt:true,cleanupRevision:review.cleanupRevision});
    assert.equal(await readFile(join(root,'_ctx/DESIGN.md'),'utf8'),content);
    assert.deepEqual(await readdir(join(root,'_ctx')),['DESIGN.md']);
    assert.equal((await new DesignService(service).list(w.workspaceId)).designs.length,2);
  } finally {await service.close();}
}));

test('project root detection survives renamed checkouts, refuses ambiguous roots and symbolic context directories',()=>withFolder(async folder=>{
  await mkdir(join(folder,'.rsi/original/_ctx'),{recursive:true});
  assert.equal((await workspaceContext(folder)).root,'.rsi/original');
  await mkdir(join(folder,'.rsi/second/_ctx'),{recursive:true});
  await assert.rejects(workspaceContext(folder),code('invalid_path'));
  await rm(join(folder,'.rsi/second'),{recursive:true});
  await mkdir(join(folder,'outside')); await rm(join(folder,'.rsi/original/_ctx'),{recursive:true});
  await symlink(join(folder,'outside'),join(folder,'.rsi/original/_ctx'));
  await assert.rejects(workspaceContext(folder),code('invalid_path'));
}));

test('old context layouts are unsupported and their files remain untouched',()=>withFolder(async folder=>{
  await mkdir(join(folder,'.rsi/context'),{recursive:true});await writeFile(join(folder,'.rsi/context/keep.md'),'Keep');
  await assert.rejects(workspaceContext(folder),code('unsupported_context_layout'));
  assert.equal(await readFile(join(folder,'.rsi/context/keep.md'),'utf8'),'Keep');
}));

test('failed registration restores non-context metadata and preserves pre-existing project context',()=>withFolder(async folder=>{
  const directory=join(folder,'project'),root=join(directory,'.rsi/project/_ctx');
  await mkdir(root,{recursive:true});await writeFile(join(root,'DESIGN.md'),'Preserve user design');
  await mkdir(join(directory,'.rsi/members'),{recursive:true});await writeFile(join(directory,'.rsi/members/old.json'),'preserve member');
  const store = new MemoryStore(), service = new WorkspaceService(store,testModelValidator);
  store.createWorkspace=async()=>{throw new Error('registration failed');};
  try {
    const review=await service.inspectInitialization({directory,adopt:true});
    await assert.rejects(service.create({name:'Project',directory,adopt:true,models:testModels(),cleanupRevision:review.cleanupRevision}),/registration failed/);
    assert.equal(await readFile(join(root,'DESIGN.md'),'utf8'),'Preserve user design');
    assert.deepEqual(await readdir(root),['DESIGN.md']);
    assert.equal(await readFile(join(directory,'.rsi/members/old.json'),'utf8'),'preserve member');
  } finally {await service.close();}
}));

test('project context APIs use one resident filesystem index without SQL history or accepted baselines',()=>withProject(async f=>{
  const manager=await f.service.contextManager(f.workspaceId);
  assert.equal(await f.service.contextManager(f.workspaceId),manager);
  assert.equal('loadContext' in f.store,false);
  assert.equal('context' in f.service,false);
  const snapshot=await manager.refresh();
  manager.loadDesign=async()=>{throw new Error('Unexpected document body load for readiness');};
  assert.equal((await f.designs.list(f.workspaceId)).designs.length,1);
  await f.designs.checkAssignment(f.workspaceId,['_ctx/DESIGN.md']);
  assert.equal(manager.snapshot(),snapshot);
}));

test('admission refreshes metadata without embedding changing documents in harness system prompts',()=>withProject(async f=>{
  const manager=await f.service.contextManager(f.workspaceId),first=await manager.refresh();
  const team=new TeamSystem(f.store,f.service,stubConfig),runtime=new FakeRuntime(f.store);team.attach(runtime);
  try{
    const lead=(await team.service.team(f.workspaceId)).members[0]!;
    await writeFile(join(f.directory,'.rsi/my-project/_ctx/README.md'),'---\nsummary: Not system information\n---\nCONSUMER_SENTINEL');
    const accepted=await team.runner.postUser(f.workspaceId,'Hello');
    assert.notEqual(manager.snapshot()!.revision,first.revision);
    const factories=await team.policy({buildRequest:()=>{throw Error('Not used');}}).createReactHarnessFactories!(lead.memberId);
    const harnesses=factories.map(factory=>factory.create({revision:0,data:{}},async()=>{throw Error('Not used');}));
    const scope={runId:accepted.runs[0]!.runId} as any;
    const before=(await Promise.all(harnesses.map(h=>h.systemPrompt?.(scope)))).join('\n\n');
    assert.match(before,/Project context organization/);assert.match(before,/optional `README.md`/);
    assert.doesNotMatch(before,/CONSUMER_SENTINEL|Not system information|A display name|my-project/);
    await writeFile(join(f.directory,'.rsi/my-project/_ctx/DESIGN.md'),'CHANGING_DESIGN_SENTINEL');
    const after=(await Promise.all(harnesses.map(h=>h.systemPrompt?.({...scope,runId:'next-run'})))).join('\n\n');
    assert.equal(after,before);assert.equal('guidance' in team.memberWorkspace,false);
    runtime.end(lead.memberId,'Done');
  }finally{await team.closeMaintenance();await team.runner.close();}
}));
