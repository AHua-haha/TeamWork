import assert from 'node:assert/strict';
import {lstat,mkdir,readFile,readdir,realpath,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {WorkspaceService} from '../src/core/workspace/workspace.js';
import {MemoryStore,testModels,testModelValidator,withFolder} from './memory-store.js';
const code=(expected:string)=>(error:unknown)=>(error as {code?:string}).code===expected;
function withService(run:(service:WorkspaceService,folder:string,store:MemoryStore)=>Promise<void>){return withFolder(async folder=>{
 const store=new MemoryStore(),service=new WorkspaceService(store,testModelValidator);
 try{await run(service,await realpath(folder),store);}finally{await service.close();}
});}

test('registration initializes root DESIGN and lead without a SQL context overview or resident file index',()=>withService(async(service,folder,store)=>{
 const directory=join(folder,'alpha'),workspace=await service.create({workspaceId:'alpha',name:'Alpha',directory,models:testModels(),adopt:false});
 assert.deepEqual(Object.keys(workspace).sort(),['createdAt','directory','name','workspaceId']);
 assert.deepEqual(await readdir(join(directory,'.rsi/alpha/_ctx')),['DESIGN.md']);
 assert.equal((await service.contextManager('alpha')).snapshot(),null);
 assert.equal((await store.listMembers('alpha')).length,1);
 assert.equal('context' in service,false);
 assert.deepEqual((await service.get('alpha')),workspace);
 await assert.rejects(service.get('missing'),code('not_found'));
}));

test('registration refuses overlapping directories and nonempty new folders',()=>withService(async(service,folder)=>{
 const outer=join(folder,'outer');await service.create({name:'Outer',directory:outer,models:testModels(),adopt:false});
 await assert.rejects(service.create({name:'Inner',directory:join(outer,'inner'),models:testModels(),adopt:false}),code('workspace_exists'));
 await assert.rejects(service.create({name:'Parent',directory:folder,models:testModels(),adopt:true}),code('workspace_exists'));
 await mkdir(join(folder,'full'));await writeFile(join(folder,'full/source.ts'),'Source');
 await assert.rejects(service.create({name:'Full',directory:join(folder,'full'),models:testModels(),adopt:false}),code('file_exists'));
}));

test('failed SQL registration removes only generated files and preserves source/context and staged member state',()=>withService(async(service,folder,store)=>{
 const directory=join(folder,'project'),context=join(directory,'.rsi/project/_ctx');
 await mkdir(context,{recursive:true});await writeFile(join(context,'DESIGN.md'),'User design');
 await writeFile(join(directory,'source.ts'),'Source');await mkdir(join(directory,'.rsi/members'),{recursive:true});await writeFile(join(directory,'.rsi/members/old.json'),'Old');
 const review=await service.inspectInitialization({directory,adopt:true});
 store.createWorkspace=async()=>{throw new Error('SQL registration failed');};
 await assert.rejects(service.create({name:'Project',directory,models:testModels(),adopt:true,cleanupRevision:review.cleanupRevision}),/SQL registration failed/);
 assert.equal(await readFile(join(context,'DESIGN.md'),'utf8'),'User design');assert.equal(await readFile(join(directory,'source.ts'),'utf8'),'Source');
 assert.equal(await readFile(join(directory,'.rsi/members/old.json'),'utf8'),'Old');assert.deepEqual(await service.list(),[]);
}));

test('cleanup consent covers only non-context state and rejects changes after review',()=>withService(async(service,folder)=>{
 const directory=join(folder,'project'),context=join(directory,'.rsi/project/_ctx');await mkdir(context,{recursive:true});await writeFile(join(context,'DESIGN.md'),'Design');
 await mkdir(join(directory,'.rsi/members'),{recursive:true});await writeFile(join(directory,'.rsi/members/old'),'Old');
 const input={name:'Project',directory,models:testModels(),adopt:true};const review=await service.inspectInitialization(input);
 assert.deepEqual(review.cleanupPaths,['.rsi/members']);await assert.rejects(service.create(input),code('cleanup_required'));
 await writeFile(join(directory,'.rsi/members/old'),'Changed');await assert.rejects(service.create({...input,cleanupRevision:review.cleanupRevision}),code('cleanup_required'));
 const current=await service.inspectInitialization(input);await service.create({...input,cleanupRevision:current.cleanupRevision});
 assert.equal(await readFile(join(context,'DESIGN.md'),'utf8'),'Design');
}));

test('old context layouts are refused without migration or deletion',()=>withService(async(service,folder)=>{
 const directory=join(folder,'old');await mkdir(join(directory,'.rsi/context'),{recursive:true});await writeFile(join(directory,'.rsi/context/notes.md'),'Preserve');
 await assert.rejects(service.create({name:'Old',directory,models:testModels(),adopt:true}),code('unsupported_context_layout'));
 assert.equal(await readFile(join(directory,'.rsi/context/notes.md'),'utf8'),'Preserve');assert.deepEqual(await service.list(),[]);
}));

test('initialization refuses linked RSI roots without following them',()=>withService(async(service,folder)=>{
 const directory=join(folder,'project'),outside=join(folder,'outside');await mkdir(directory);await mkdir(outside);await symlink(outside,join(directory,'.rsi'));
 await assert.rejects(service.create({name:'Project',directory,models:testModels(),adopt:true}),code('file_exists'));
 assert.ok((await lstat(join(directory,'.rsi'))).isSymbolicLink());assert.deepEqual(await readdir(outside),[]);
}));
