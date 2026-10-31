import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fauxAssistantMessage,type JsonObject} from '@earendil-works/pi-ai';
import {CoreData} from '../../src/core/data.js';
import {MySqlStorage} from '../../src/storage/mysql.js';
import {AgentInputData} from '../../src/core/agent/data/input.js';
import {FileReactHarness} from '../../src/core/react-harness/file/harness.js';
import {ContextBaseManager} from '../../src/core/workspace/context-base/index.js';
import type {ContextEntry} from '../../src/core/agent/data/model.js';

const url=process.env.TEST_DATABASE_URL;if(!url)throw Error('Set TEST_DATABASE_URL to a disposable MySQL database');
const assistant=():ContextEntry=>({messageId:randomUUID(),message:fauxAssistantMessage('Private work'),metadata:{}});
const user=():ContextEntry=>({messageId:randomUUID(),message:{role:'user',content:'New request',timestamp:1},metadata:{}});
async function fixture(run:(f:Awaited<ReturnType<typeof prepare>>)=>Promise<void>){
 const admin=new MySqlStorage(url!),name='refresh_'+randomUUID().replaceAll('-',''),location=new URL(url!);location.pathname='/'+name;
 await admin.pool.query(`CREATE DATABASE ${name}`);const store=new CoreData(new MySqlStorage(location.toString()));
 let f:Awaited<ReturnType<typeof prepare>>|undefined;
 try{await store.migrate();f=await prepare(store,location.toString());await run(f);}
 finally{if(f){await f.manager.close();await rm(f.folder,{recursive:true,force:true});}await store.close();await admin.pool.query(`DROP DATABASE ${name}`);await admin.close();}
}
async function prepare(store:CoreData,url:string){
 const folder=await realpath(await mkdtemp(join(tmpdir(),'sql-refresh-'))),root=join(folder,'project');
 for(const [path,body]of Object.entries({'frontend/app.ts':'OWN','backend/impl.ts':'PRIVATE_DEPENDENCY',
  '.rsi/project/_ctx/DESIGN.md':'# Project','.rsi/project/frontend/_ctx/DESIGN.md':'# Frontend','.rsi/project/backend/_ctx/DESIGN.md':'# Backend',
  '.rsi/project/backend/_ctx/README.md':'---\nsummary: Storage\ninclude:\n - missing/file.ts\n---\nUSAGE_ONLY'})){
  await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),body);
 }
 const manager=new ContextBaseManager(root);await manager.refresh();
 const source=async(refresh:boolean)=>({snapshot:refresh?await manager.refresh():manager.snapshot()!,workingDesigns:['frontend'],readme:(path:string)=>manager.loadUsageReadme(path)});
 const filePath=join(root,'backend/impl.ts'),viewId=randomUUID(),callId=randomUUID();
 const initial:ContextEntry[]=[{messageId:randomUUID(),message:fauxAssistantMessage([{type:'toolCall',id:callId,name:'read',arguments:{path:filePath}}],{stopReason:'toolUse'}),metadata:{}},
  {messageId:viewId,message:{role:'toolResult',toolCallId:callId,toolName:'read',content:[{type:'text',text:'PRIVATE_DEPENDENCY'}],isError:false,timestamp:1},metadata:{fileViewPath:filePath}},
  ...Array.from({length:60},assistant),user()];
 await store.agents.createAgent('agent',initial);
 await store.agents.saveComponentState('agent','file-content',0,{files:{[filePath]:{ranges:[{start:1,end:1}],visibleMessageId:viewId}}});
 const state=()=>store.agents.getComponentState('agent','file-content');
 const invoke=async()=>{
  const context=await store.agents.residentContext('agent'),harness=new FileReactHarness(root,await state(),source);
  await harness.onInput!({agentId:'agent',input:user(),signal:new AbortController().signal,data:new AgentInputData(context,(revision,patch,effects)=>store.agents.commitComponentContext('agent',revision,patch,effects))});
 };
 const add=async(entries:ContextEntry[])=>{const context=await store.agents.residentContext('agent');await store.agents.patchContext('agent',context.history.revision,{append:entries,update:[]});};
 return {store,url,folder,root,manager,source,viewId,filePath,state,invoke,add};
}

test('SQL refresh is incremental, excludes its own entry, survives restart and directly replaces the previous message',()=>fixture(async f=>{
 await f.invoke();assert.equal((await f.state()).data.messagesSinceRefresh,0);
 const initial=(await f.state()).data.replacementMessageId;
 await f.add([user()]);
 const original=f.store.agents.getContext.bind(f.store.agents);f.store.agents.getContext=async()=>{throw Error('Refresh must not reload full context');};
 try{await f.invoke();}finally{f.store.agents.getContext=original;}
 const state=await f.state(),id=state.data.replacementMessageId as string;
 assert.equal(id,initial,'below-threshold user input and restored state retain the initial instruction');
 assert.equal(state.data.messagesSinceRefresh,1);
 const context=await f.store.agents.getContext('agent');assert.equal(context.messageCount,64);assert.equal(context.entries.length,65);
 const hidden=context.entries.find(e=>e.messageId===f.viewId)!;assert.equal(hidden.metadata.modelContextHidden,true);assert.equal((hidden.message.content as {text:string}[])[0]!.text,'PRIVATE_DEPENDENCY');
 assert.match(context.entries.find(e=>e.messageId===id)!.message.content as string,/USAGE_ONLY/);
 const [history]=await f.store.pool.query<any[]>('SELECT COUNT(*) AS count FROM messages');assert.equal(history[0].count,0,'private refresh does not rewrite or invent stable history');
 const reopened=new CoreData(new MySqlStorage(f.url));
 try{assert.deepEqual(await reopened.agents.getComponentState('agent','file-content'),state);assert.deepEqual(await reopened.agents.getContext('agent'),context);}finally{await reopened.close();}
 await f.add([...Array.from({length:63},assistant),user()]);
 await writeFile(join(f.root,'.rsi/project/backend/_ctx/README.md'),'---\nsummary: Storage\n---\nUPDATED_USAGE');
 await f.invoke();
 const next=await f.store.agents.getContext('agent');assert.equal(next.messageCount,128);assert.equal(next.entries.find(e=>e.messageId===id)!.metadata.modelContextHidden,true);
 const nextState=await f.state();assert.notEqual(nextState.data.replacementMessageId,id);assert.deepEqual(nextState.data.discoveredDependencyDesigns,['backend']);assert.equal(nextState.data.messagesSinceRefresh,0);
 assert.match(next.entries.find(e=>e.messageId===nextState.data.replacementMessageId)!.message.content as string,/UPDATED_USAGE/);
}));

for (const phase of ['initial', 'threshold']) test(`failed SQL ${phase} refresh rolls back visibility, insertion and harness state and can be retried after reload`,()=>fixture(async f=>{
 if(phase==='threshold'){await f.invoke();await f.add([...Array.from({length:63},assistant),user()]);}
 const before=await f.store.agents.getContext('agent'),state=await f.state();
 await f.store.pool.query("CREATE TRIGGER refuse_refresh BEFORE UPDATE ON agent_assistant_response_handler_state FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='refused refresh state'");
 await assert.rejects(f.invoke(),/refused refresh state/);
 const restored=new CoreData(new MySqlStorage(f.url));
 try{assert.deepEqual(await restored.agents.getContext('agent'),before);assert.deepEqual(await restored.agents.getComponentState('agent','file-content'),state);}finally{await restored.close();}
 await f.store.pool.query('DROP TRIGGER refuse_refresh');await f.invoke();assert.equal((await f.state()).data.messagesSinceRefresh,0);assert.ok((await f.state()).data.replacementMessageId);
}));

test('context replacement keeps the append counter and missing old references do not cause history lookup',()=>fixture(async f=>{
 await f.invoke();await f.add([user()]);await f.invoke();
 const context=await f.store.agents.residentContext('agent'),before=context.history.messageCount!;
 await f.store.agents.replaceContext('agent',context.history.revision,[assistant()]);
 assert.equal((await f.store.agents.getContext('agent')).messageCount,before+1);
 await f.invoke();
 const current=await f.store.agents.getContext('agent');assert.equal(current.messageCount,before+1);assert.equal((await f.state()).data.messagesSinceRefresh,0);
 assert.deepEqual((await f.state()).data.discoveredDependencyDesigns,['backend'],'dependencies survive removal of their original views');
 assert.equal(current.entries.filter(entry=>entry.metadata.fileContextReplacement===true).length,1);
}));


test('concurrent first harness states for different members do not lock missing shared index ranges',()=>fixture(async f=>{
 const ids=Array.from({length:12},(_,index)=>`member-${index}`);
 for(const id of ids)await f.store.agents.createAgent(id);
 const states=await Promise.all(ids.map(id=>f.store.agents.saveComponentState(id,'file-content',0,{messagesSinceRefresh:1})));
 assert.ok(states.every(state=>state.revision===1));
 await assert.rejects(f.store.agents.saveComponentState(ids[0]!,'file-content',0,{}),(error:any)=>error.code==='context_conflict');
 assert.deepEqual(await f.store.agents.getComponentState(ids[0]!,'file-content'),states[0]);
}));

for(const outcome of ['success','failure'] as const) test(`runtime compaction ${outcome} keeps File state consistent and refreshes only on later user input`,{timeout:30_000},()=>fixture(async f=>{
 const {AgentRuntime,fixedPolicy}=await import('../../src/core/agent/runtime.js');
 const {fileReactHarnessFactory}=await import('../../src/core/react-harness/file/harness.js');
 const {fauxProvider}=await import('@earendil-works/pi-ai');
 for(const [path,body]of Object.entries({'auth/auth.ts':'NEW_DEPENDENCY', '.rsi/project/auth/_ctx/DESIGN.md':'# Auth', '.rsi/project/auth/_ctx/README.md':'AUTH_USAGE'})){
  await mkdir(dirname(join(f.root,path)),{recursive:true});await writeFile(join(f.root,path),body);
 }
 await f.invoke();
 const initialId=(await f.state()).data.replacementMessageId;
 await f.add([{messageId:randomUUID(),message:{role:'user',content:'OLD PRIVATE '.repeat(40000),timestamp:1},metadata:{runtimeGenerated:true}}]);
 const model=fauxProvider().getModel(),base=fixedPolicy(model),modes=new WeakMap<object,string>();
 const settings={thresholdTokens:10000,prompt:'Prepare continuation and preserve useful context.'};
 let preparations=0,ordinary=0,beforeContext:Awaited<ReturnType<typeof f.store.agents.getContext>>|undefined,beforeState:Awaited<ReturnType<typeof f.state>>|undefined;
 const runtime=new AgentRuntime(f.store.agents,{resolveForRun:async()=>({model,tools:[],systemPrompt:'',options:{},source:{appRevision:0,agentRevision:0,catalogRevisions:{}}})},{...base,
  createReactHarnessFactories:()=>[fileReactHarnessFactory(f.root,f.source)],
  buildRequest:async(scope,history)=>{const request=await base.buildRequest(scope,history);modes.set(request,scope.mode!);return request;},
 },async function*(request){
  let response;
  if(modes.get(request)==='compaction'){
   if(++preparations===1){
    beforeContext=await f.store.agents.getContext('agent');beforeState=await f.state();
    response=fauxAssistantMessage([
     {type:'toolCall',id:'new-dependency',name:'read',arguments:{path:'auth/auth.ts'}},
     {type:'toolCall',id:'working-source',name:'read',arguments:{path:'frontend/app.ts'}},
    ],{stopReason:'toolUse'});
   }else{
    assert.deepEqual(await f.store.agents.getContext('agent'),beforeContext,'preparation messages and visibility stay isolated');
    assert.deepEqual(await f.state(),beforeState,'preparation discoveries and file references do not advance live state');
    if(outcome==='failure')throw Error('provider failed during preparation');
    response=fauxAssistantMessage('Prepared continuation.');
   }
  }else{
   ordinary++;
   const context=await f.store.agents.getContext('agent'),state=await f.state();
   if(ordinary===1&&outcome==='success'){
    assert.equal(state.data.replacementMessageId,null);
    assert.equal(context.entries.filter(entry=>entry.metadata.fileContextReplacement===true).length,0,'compaction never inserts a generated instruction');
    assert.deepEqual(state.data.discoveredDependencyDesigns,['auth','backend'],'old discoveries accumulate even when their views are dropped');
    const files=state.data.files as Record<string,{visibleMessageId:string}>;
    assert.deepEqual(Object.keys(files).sort(),[join(f.root,'auth/auth.ts'),join(f.root,'frontend/app.ts')].sort());
    assert.ok(Object.values(files).every(file=>context.entries.some(entry=>entry.messageId===file.visibleMessageId&&entry.metadata.modelContextHidden!==true)));
   }else{
    const generated=context.entries.filter(entry=>entry.metadata.fileContextReplacement===true&&entry.metadata.modelContextHidden!==true);
    assert.equal(generated.length,1);
    const text=generated[0]!.message.content as string;
    if(outcome==='success'){
     assert.notEqual(state.data.replacementMessageId,initialId);
     assert.match(text,/AUTH_USAGE/);assert.match(text,/USAGE_ONLY/);
    }else{
     assert.equal(state.data.replacementMessageId,initialId);
     assert.deepEqual(state.data.discoveredDependencyDesigns,['backend']);
     assert.doesNotMatch(text,/AUTH_USAGE/);
    }
   }
   response=fauxAssistantMessage('Done.');
  }
  yield {type:'start',partial:response};yield {type:'done',reason:response.stopReason as 'stop'|'toolUse',message:response};
 },{compaction:settings});
 try{
  await runtime.open();
  const first=await runtime.start('agent','Continue the task');
  assert.equal((await runtime.finished('agent',first.runId)).status,outcome==='success'?'completed':'failed');
  if(outcome==='failure'){
   assert.deepEqual(await f.store.agents.getContext('agent'),beforeContext);
   assert.deepEqual(await f.state(),beforeState);
   assert.match(JSON.stringify(await f.store.agents.runMessages('agent',first.runId)),/NEW_DEPENDENCY/,'stable evidence is retained without replay');
  }
  const retained=await f.store.agents.getContext('agent'),state=await f.state();
  await runtime.close();await runtime.open();
  assert.deepEqual(await f.store.agents.getContext('agent'),retained,'restart alone never inserts an instruction');
  assert.deepEqual(await f.state(),state);
  settings.thresholdTokens=10_000_000;
  const next=await runtime.start('agent','Next real user input');
  assert.equal((await runtime.finished('agent',next.runId)).status,'completed');
  assert.equal(preparations,2,'failed preparation tools are never replayed');
 }finally{await runtime.close();}
}));
