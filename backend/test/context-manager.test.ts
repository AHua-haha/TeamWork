import assert from 'node:assert/strict';
import {mkdir,readFile,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {ContextBaseManager,type ProjectContextNode} from '../src/core/workspace/context-base/index.js';
import {withFolder} from './memory-store.js';
const code=(value:string)=>(error:unknown)=>(error as {code?:string}).code===value;
async function put(root:string,path:string,content:string|Buffer){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),content);}
async function fixture(action:(root:string,manager:ContextBaseManager)=>Promise<void>){
 await withFolder(async folder=>{
  const root=await realpath(folder);
  await put(root,'.rsi/project/_ctx/DESIGN.md','# Project');
  const manager=new ContextBaseManager(root);
  try{await action(root,manager);}finally{await manager.close();}
 });
}
function flatten(node:ProjectContextNode):ProjectContextNode[]{return[node,...(node.children??[]).flatMap(flatten)];}

test('refresh indexes the real project hierarchy with explicit bindings and no document/source bodies',()=>fixture(async(root,manager)=>{
 await put(root,'backend/src/agent/agent.ts','SOURCE_BODY_MUST_NOT_BE_STORED');
 await put(root,'backend/src/agent/helpers.ts','HELPER_BODY');
 for(const path of ['backend/_ctx','backend/src/agent/_ctx','backend/src/agent/agent.ts.ctx'])await put(root,`.rsi/project/${path}/DESIGN.md`,'DESIGN_BODY_MUST_NOT_BE_STORED');
 await put(root,'.rsi/project/backend/src/agent/_ctx/README.md','---\nsummary: Agent execution\ninclude:\n  - backend/src/agent/\n---\nREADME_BODY_MUST_NOT_BE_STORED');
 await put(root,'.rsi/project/backend/src/agent/_ctx/internal/fake.ctx/DESIGN.md','Not a design system');
 assert.equal(manager.snapshot(),null);
 const snapshot=await manager.refresh(),nodes=new Map(flatten(snapshot.tree).map(n=>[n.projectPath,n]));
 assert.equal(nodes.get('backend')!.designSystemPath,'backend');
 assert.equal(nodes.get('backend/src')!.designSystemPath,undefined);
 assert.equal(nodes.get('backend/src/agent/helpers.ts')!.designSystemPath,undefined);
 assert.equal(nodes.get('backend/src/agent/agent.ts')!.designSystemPath,'backend/src/agent/agent.ts');
 assert.equal(nodes.has('.rsi'),false);
 assert.equal(Object.keys(snapshot.designSystems).length,4);
 assert.equal(snapshot.designSystems['backend/src/agent']!.metadata.summary,'Agent execution');
 assert.doesNotMatch(JSON.stringify(snapshot),/SOURCE_BODY|DESIGN_BODY|README_BODY|HELPER_BODY/);
 assert.throws(()=>{snapshot.tree.children!.push({projectPath:'invented',kind:'file'});},TypeError);
 assert.equal(manager.snapshot(),snapshot);
}));

test('refresh reads metadata headers only and does not open included source files',()=>fixture(async(root,manager)=>{
 await put(root,'source.bin',Buffer.from([255,254,0,0]));
 await put(root,'.rsi/project/_ctx/README.md','---\nsummary: Metadata only\ninclude:\n  - source.bin\n  - missing.ts\n---\n'+('x'.repeat(2*1024*1024)));
 const snapshot=await manager.refresh();
 assert.equal(snapshot.designSystems['.']!.metadataValid,true);
 assert.equal(snapshot.diagnostics.length,0);
 assert.deepEqual(snapshot.designSystems['.']!.metadata.include,['source.bin','missing.ts']);
 assert.equal(JSON.stringify(snapshot).includes('xxxxx'),false);
 await assert.rejects(manager.loadConsumerContext('.'),code('context_limit'));
}));

test('consumer context loads project-root-relative files/directories recursively and deduplicates overlaps',()=>fixture(async(root,manager)=>{
 await put(root,'src/a.ts','Implementation A');await put(root,'src/nested/b.ts','Implementation B');
 await put(root,'src/node_modules/large.ts','Dependency excluded');
 await put(root,'.rsi/project/_ctx/README.md','---\nsummary: Consumer context\ninclude:\n  - src/\n  - src/a.ts\n  - src/nested\n---\n# Usage contract\nInput, output, effects and expectations.');
 const snapshot=await manager.refresh(),context=await manager.loadConsumerContext('.');
 assert.match(context.readme.content,/Usage contract/);
 assert.deepEqual(context.files,[{path:'src/a.ts',content:'Implementation A'},{path:'src/nested/b.ts',content:'Implementation B'}]);
 assert.equal(context.revision,snapshot.revision);
 assert.doesNotMatch(JSON.stringify(manager.snapshot()),/Implementation A|Usage contract/);
 await put(root,'src/a.ts','Changed A');
 assert.equal((await manager.loadConsumerContext('.')).files[0]!.content,'Changed A');
}));

test('explicit refresh is the only metadata synchronization; file edits, deletion and restoration do not mutate old snapshots',()=>fixture(async(root,manager)=>{
 const path='.rsi/project/_ctx/README.md';await put(root,path,'---\nsummary: First\n---\nFirst body');
 const first=await manager.refresh();
 await put(root,path,'---\nsummary: Second\n---\nSecond body');
 assert.equal(manager.snapshot(),first);assert.equal(first.designSystems['.']!.metadata.summary,'First');
 await assert.rejects(manager.loadConsumerContext('.'),code('context_changed'));
 const second=await manager.refresh();assert.notEqual(second.revision,first.revision);
 assert.equal(second.designSystems['.']!.metadata.summary,'Second');
 await rm(join(root,path));assert.ok(manager.snapshot()!.designSystems['.']!.documents.readme);
 const third=await manager.refresh();assert.equal(third.designSystems['.']!.documents.readme,undefined);
 await assert.rejects(manager.loadConsumerContext('.'),code('consumer_context_unavailable'));
 await rm(join(root,'.rsi/project/_ctx/DESIGN.md'));
 const fourth=await manager.refresh();assert.equal(fourth.designSystems['.'],undefined);
 assert.equal(fourth.tree.designSystemPath,undefined);assert.ok(fourth.diagnostics.some(d=>d.code==='invalid_design'));
 await put(root,'.rsi/project/_ctx/DESIGN.md','# Restored');assert.ok((await manager.refresh()).designSystems['.']);
}));

test('invalid YAML and field values produce diagnostics without hiding the design; old README without metadata remains readable',()=>fixture(async(root,manager)=>{
 for(const header of ['summary: First\nsummary: Duplicate','include: src','include: [../outside]','summary: 123','summary: &x hi\ninclude: [*x]','summary: [']){
  await put(root,'.rsi/project/_ctx/README.md',`---\n${header}\n---\nBody`);
  const snapshot=await manager.refresh();assert.ok(snapshot.designSystems['.']);assert.equal(snapshot.tree.designSystemPath,'.');
  assert.equal(snapshot.designSystems['.']!.metadataValid,false,header);
  assert.ok(snapshot.diagnostics.some(d=>d.code==='invalid_metadata'));
  await assert.rejects(manager.loadConsumerContext('.'),code('invalid_metadata'));
 }
 await put(root,'.rsi/project/_ctx/README.md','# Existing contract\nNo header yet.');
 const snapshot=await manager.refresh();assert.equal(snapshot.designSystems['.']!.metadataValid,true);
 assert.deepEqual(snapshot.designSystems['.']!.metadata,{summary:null,include:[]});
 assert.match((await manager.loadConsumerContext('.')).readme.content,/Existing contract/);
}));

test('YAML front matter supports CRLF, multiline summaries, quoted paths, comments and final boundary without newline',()=>fixture(async(root,manager)=>{
 await put(root,'src/file name.ts','Contents');
 await put(root,'.rsi/project/_ctx/README.md','\uFEFF---\r\nsummary: >-\r\n  Runs agents\r\n  and tools.\r\ninclude: ["src/file name.ts"] # Project relative\r\n---\r\nBody');
 const snapshot=await manager.refresh();assert.equal(snapshot.designSystems['.']!.metadata.summary,'Runs agents and tools.');
 assert.equal((await manager.loadConsumerContext('.')).files[0]!.content,'Contents');
 await put(root,'.rsi/project/_ctx/README.md','---\nsummary: Last\n---');
 assert.equal((await manager.refresh()).designSystems['.']!.metadata.summary,'Last');
 assert.ok((await manager.loadConsumerContext('.')).readme);
}));

test('missing include paths are not read during refresh and fail explicitly on demand; traversal and links never escape the project',()=>fixture(async(root,manager)=>{
 await put(root,'.rsi/project/_ctx/README.md','---\ninclude: [missing.ts]\n---\nBody');
 assert.equal((await manager.refresh()).diagnostics.length,0);
 await assert.rejects(manager.loadConsumerContext('.'),code('not_found'));
 await put(root,'target.ts','Target');await symlink(join(root,'target.ts'),join(root,'link.ts'));
 await put(root,'.rsi/project/_ctx/README.md','---\ninclude: [link.ts]\n---\nBody');
 const snapshot=await manager.refresh();assert.ok(snapshot.diagnostics.some(d=>d.path==='link.ts'));
 await assert.rejects(manager.loadConsumerContext('.'),code('invalid_path'));
 await put(root,'.rsi/project/_ctx/README.md','---\ninclude: [/absolute.ts]\n---\nBody');
 assert.equal((await manager.refresh()).designSystems['.']!.metadataValid,false);
}));

test('failed refresh preserves the published model and the queue remains usable; restarting reconstructs metadata with a new revision epoch',()=>fixture(async(root,manager)=>{
 await put(root,'.rsi/project/_ctx/README.md','---\nsummary: Durable only on disk\n---\nBody');
 const first=await manager.refresh();
 const restarted=new ContextBaseManager(root);
 try{
  assert.equal(restarted.snapshot(),null);
  const other=await restarted.refresh();assert.notEqual(other.revision,first.revision);assert.deepEqual(other.designSystems,first.designSystems);
  const [a,b]=await Promise.all([restarted.refresh(),restarted.refresh()]);assert.notEqual(a.revision,b.revision);assert.equal(restarted.snapshot(),b);
 }finally{await restarted.close();}
 const limited=new ContextBaseManager(root,{maxProjectEntries:2});
 try{
  const empty=await limited.refresh();await put(root,'one.ts','One');await put(root,'two.ts','Two');
  await assert.rejects(limited.refresh(),code('context_limit'));assert.equal(limited.snapshot(),empty);
  await rm(join(root,'two.ts'));assert.equal(flatten((await limited.refresh()).tree).length,2);
 }finally{await limited.close();}
}));

test('metadata and consumer limits fail explicitly without silent truncation or retaining loaded bodies',()=>fixture(async(root)=>{
 await put(root,'a.ts','12345');await put(root,'b.ts','67890');
 await put(root,'.rsi/project/_ctx/README.md','---\ninclude: [a.ts, b.ts]\n---\nContract');
 const manager=new ContextBaseManager(root,{maxConsumerFiles:1});
 try{await manager.refresh();await assert.rejects(manager.loadConsumerContext('.'),code('context_limit'));assert.doesNotMatch(JSON.stringify(manager.snapshot()),/12345|67890|Contract/);}finally{await manager.close();}
 const headerLimit=new ContextBaseManager(root,{maxMetadataBytes:16});
 try{assert.equal((await headerLimit.refresh()).designSystems['.']!.metadataValid,false);}finally{await headerLimit.close();}
}));

test('orphan and wrong-kind context entries are diagnosed without inventing source nodes',()=>fixture(async(root,manager)=>{
 await put(root,'one.ts','Source');
 await put(root,'.rsi/project/missing/_ctx/DESIGN.md','# Missing source');
 await put(root,'.rsi/project/one.ts/_ctx/DESIGN.md','# Wrong kind');
 const snapshot=await manager.refresh();assert.equal(Object.keys(snapshot.designSystems).length,1);
 assert.equal(snapshot.diagnostics.filter(d=>d.code==='unrepresented_node').length,2);
 assert.equal(flatten(snapshot.tree).some(n=>n.projectPath==='missing'),false);
}));

test('manager never creates or migrates context files; closing drops the resident snapshot',()=>fixture(async(root,manager)=>{
 const design=join(root,'.rsi/project/_ctx/DESIGN.md'),before=await readFile(design);
 await manager.refresh();await manager.loadDesign('.');await manager.close();
 assert.equal(manager.snapshot(),null);assert.deepEqual(await readFile(design),before);
 await assert.rejects(manager.refresh(),code('workspace_unavailable'));
 assert.throws(()=>manager.design('.'),code('workspace_unavailable'));
}));
