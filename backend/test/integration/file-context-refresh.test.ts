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
 await f.invoke();assert.equal((await f.state()).data.messagesSinceRefresh,63);
 await f.add([user()]);
 const original=f.store.agents.getContext.bind(f.store.agents);f.store.agents.getContext=async()=>{throw Error('Refresh must not reload full context');};
 try{await f.invoke();}finally{f.store.agents.getContext=original;}
 const state=await f.state(),id=state.data.replacementMessageId as string;
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

test('failed SQL refresh rolls back visibility, insertion and harness state and can be retried after reload',()=>fixture(async f=>{
 await f.invoke();await f.add([user()]);const before=await f.store.agents.getContext('agent'),state=await f.state();
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
 await f.add([...Array.from({length:62},assistant),user()]);await f.invoke();
 const current=await f.store.agents.getContext('agent');assert.equal(current.messageCount,128);assert.equal((await f.state()).data.messagesSinceRefresh,0);
}));


test('concurrent first harness states for different members do not lock missing shared index ranges',()=>fixture(async f=>{
 const ids=Array.from({length:12},(_,index)=>`member-${index}`);
 for(const id of ids)await f.store.agents.createAgent(id);
 const states=await Promise.all(ids.map(id=>f.store.agents.saveComponentState(id,'file-content',0,{messagesSinceRefresh:1})));
 assert.ok(states.every(state=>state.revision===1));
 await assert.rejects(f.store.agents.saveComponentState(ids[0]!,'file-content',0,{}),(error:any)=>error.code==='context_conflict');
 assert.deepEqual(await f.store.agents.getComponentState(ids[0]!,'file-content'),states[0]);
}));
