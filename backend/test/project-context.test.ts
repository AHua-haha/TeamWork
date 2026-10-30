import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {DesignService} from '../src/core/workspace/design.js';
import {WorkspaceService} from '../src/core/workspace/workspace.js';
import {migratedBaseline, migratedReference, projectNode, workspaceContext} from '../src/core/workspace/project-context.js';
import {TeamSystem} from '../src/core/team/team-system.js';
import {MemoryStore, testModels, testModelValidator, withFolder} from './memory-store.js';
import {stubConfig} from './team-fixture.js';
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
    assert.equal((await team.currentConfiguration(f.workspaceId)).status.valid,true);
    const guidance = await team.memberWorkspace.guidance(lead.memberId);
    assert.match(guidance,/\.rsi\/my-project\/_ctx\/DESIGN.md/);
    assert.match(guidance,/optional `README.md`/);
  } finally {await team.closeMaintenance();await team.runner.close();}
}));

test('only DESIGN entries define parts; contracts and internal notes are optional and do not create children',()=>withProject(async f=>{
  const base = await f.service.context(f.workspaceId);
  for(const [path,content] of Object.entries({
    'backend/src/agent/_ctx/DESIGN.md':'# Agent design',
    'backend/src/agent/agent.ts.ctx/DESIGN.md':'# Agent file design',
    'backend/src/agent/_ctx/internal/files.md':'helpers.ts has no independent context',
    'backend/src/agent/_ctx/README.md':'A usage contract',
    'backend/src/agent/_ctx/internal/README.md':'Old internal notes',
    'backend/src/agents/_ctx/DESIGN.md':'# Sibling',
  })) await base.save(path,content,null,null);
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

test('migration aliases preserve existing assignments and accepted bytes without accepting pending content',()=>withFolder(async folder=>{
  const root = '.rsi/project'; await mkdir(join(folder,root,'_ctx/internal'),{recursive:true});
  await writeFile(join(folder,root,'_ctx/internal/context-migration.json'),JSON.stringify({
    references:{'metadata.json':'_ctx/DESIGN.md'},files:{'.rsi/context/design/design.md':root+'/_ctx/DESIGN.md'},
  }));
  const layout = await workspaceContext(folder);
  assert.equal(await migratedReference(folder,layout,'metadata.json'),'_ctx/DESIGN.md');
  assert.equal(await migratedReference(folder,layout,'src/a.ts.ctx/DESIGN.md'),'src/a.ts.ctx/DESIGN.md');
  await assert.rejects(migratedReference(folder,layout,'missing/metadata.json'),code('not_found'));
  const old = {'.rsi/context/design/design.md':'Accepted design'};
  await writeFile(join(folder,root,'_ctx/DESIGN.md'),'Pending edit');
  assert.deepEqual(await migratedBaseline(folder,layout,old),{[root+'/_ctx/DESIGN.md']:'Accepted design'});
  assert.deepEqual(old,{'.rsi/context/design/design.md':'Accepted design'});
}));

test('existing legacy projects keep their original context root',()=>withFolder(async folder=>{
  await mkdir(join(folder,'.rsi/context/design'),{recursive:true});
  assert.deepEqual(await workspaceContext(folder),{root:'.rsi/context',kind:'legacy',rootDesign:'metadata.json'});
  await mkdir(join(folder,'.rsi/new/_ctx'),{recursive:true});
  await assert.rejects(workspaceContext(folder),code('invalid_path'));
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

test('an existing workspace reopens after physical migration with old assignments, original acceptance and durable context history intact',()=>withFolder(async folder=>{
  const directory=join(folder,'project'),store=new MemoryStore();
  await mkdir(join(directory,'.rsi/context/design'),{recursive:true});
  await writeFile(join(directory,'.rsi/context/design/design.md'),'# Accepted user design');
  const first=new WorkspaceService(store,testModelValidator);
  const {workspaceId}=await first.create({name:'Project',directory,adopt:true,models:testModels()});
  const leadBefore=structuredClone([...store.members.values()][0]);
  const prior=await (await first.context(workspaceId)).read({path:'design/design.md'});
  await first.close();
  const root=join(directory,'.rsi/project/_ctx');await mkdir(join(root,'internal'),{recursive:true});
  await rename(join(directory,'.rsi/context/design/design.md'),join(root,'DESIGN.md'));
  await writeFile(join(root,'DESIGN.md'),'# Pending user design');
  await writeFile(join(root,'internal/context-migration.json'),JSON.stringify({references:{'metadata.json':'_ctx/DESIGN.md'},files:{'.rsi/context/design/design.md':'.rsi/project/_ctx/DESIGN.md'}}));
  await rm(join(directory,'.rsi/context'),{recursive:true});
  const second=new WorkspaceService(store,testModelValidator);
  try {
    const designs=new DesignService(second);
    assert.equal((await designs.read(workspaceId,'metadata.json')).content,'# Accepted user design');
    assert.equal((await designs.read(workspaceId,'_ctx/DESIGN.md')).content,'# Accepted user design');
    const base=await second.context(workspaceId);
    assert.equal((await base.read({path:'_ctx/DESIGN.md'})).content,'# Pending user design');
    assert.equal((await base.read({revision:prior.revision})).content,'# Accepted user design');
    assert.deepEqual([...store.members.values()][0],leadBefore);
  } finally {await second.close();}
}));
