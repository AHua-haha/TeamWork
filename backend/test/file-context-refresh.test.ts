import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fauxAssistantMessage,type JsonObject,type ToolCall} from '@earendil-works/pi-ai';
import {AgentContextState,AgentState} from '../src/core/agent/data/state.js';
import {AgentMessageData,AgentTurnData} from '../src/core/agent/data/messages.js';
import {AgentInputData} from '../src/core/agent/data/input.js';
import {reactToUserInputs} from '../src/core/agent/input-reactions.js';
import {FileReactHarness} from '../src/core/react-harness/file/harness.js';
import {projectFileContextEntry} from '../src/core/react-harness/file/context.js';
import {ContextBaseManager} from '../src/core/workspace/context-base/index.js';
import type {ComponentState,CompletedMessage,ContextHistory,RunState,ComponentMessageEffects} from '../src/core/agent/data/model.js';
import {AgentExecution,fixedPolicy} from '../src/core/agent/agent.js';
import {fauxProvider} from '@earendil-works/pi-ai';
import type {ModelStream} from '../src/core/agent/contracts.js';
import type {StepScope} from '../src/core/agent/contracts.js';

const text=(entry:{message:CompletedMessage['message']})=>typeof entry.message.content==='string'?entry.message.content:entry.message.content.flatMap(block=>block.type==='text'?block.text:[]).join('\n');
async function fixture(t:TestContext){
 const folder=await realpath(await mkdtemp(join(tmpdir(),'context-refresh-')));t.after(()=>rm(folder,{recursive:true,force:true}));
 const root=join(folder,'project');
 const files:Record<string,string>={
  'frontend/app.ts':'WORKING_SOURCE','backend/impl.ts':'DEPENDENCY_PRIVATE_SOURCE','backend/included.ts':'INCLUDED_SOURCE_MUST_NOT_LOAD','auth/auth.ts':'AUTH_PRIVATE_SOURCE',
  '.rsi/project/_ctx/DESIGN.md':'# Project','.rsi/project/_ctx/README.md':'---\nsummary: Whole project\n---\nProject usage',
  '.rsi/project/frontend/_ctx/DESIGN.md':'# Frontend','.rsi/project/frontend/_ctx/README.md':'---\nsummary: User interface\n---\nFrontend usage',
  '.rsi/project/backend/_ctx/DESIGN.md':'DEPENDENCY_PRIVATE_DESIGN','.rsi/project/backend/_ctx/README.md':'---\nsummary: Durable storage\ninclude:\n - backend/included.ts\n - missing/not-readable.ts\n---\nBACKEND_USAGE_CONTRACT',
  '.rsi/project/auth/_ctx/DESIGN.md':'# Authentication',
 };
 for(const [path,content]of Object.entries(files)){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),content);}
 const manager=new ContextBaseManager(root);await manager.refresh();t.after(()=>manager.close());
 const source=async(refresh:boolean)=>{const snapshot=refresh?await manager.refresh():manager.snapshot()!;return {snapshot,workingDesigns:['frontend'],readme:(path:string)=>manager.loadUsageReadme(path,snapshot)};};
 let state:ComponentState={revision:0,data:{}},fail=false;
 const context=new AgentContextState({revision:0,entries:[]});
 const run:RunState={agentId:'agent',runId:'run',status:'running',phase:'model',step:0,startedAt:1,endedAt:null,endPosition:null,activeMessageId:null,error:null};
 const agent=new AgentState(run,context,0),history:CompletedMessage[]=[],effects:ComponentMessageEffects[]=[];
 const save=(effect:ComponentMessageEffects)=>{if(fail)throw Error('refused transaction');assert.equal(effect.revision,state.revision);state={revision:state.revision+1,data:structuredClone(effect.data)};effects.push(structuredClone(effect));};
 const messages=new AgentMessageData(agent,{message:async entry=>{history.push(structuredClone(entry));return entry;},componentMessage:async(entry,effect)=>{save(effect);history.push(structuredClone(entry));return entry;}});
 const inputData=()=>new AgentInputData(context,async(_revision,_patch,effect)=>{if(fail)throw Error('refused transaction');if(effect)save(effect);});
 let harness=new FileReactHarness(root,state,source);
 const scope={agentId:'agent',runId:'run',step:1,signal:new AbortController().signal} as StepScope;
 const append=async(message:CompletedMessage['message'],metadata:JsonObject={})=>messages.append({messageId:randomUUID(),message,metadata});
 const user=async()=>append({role:'user',content:'User request',timestamp:1});
 const input=async()=>reactToUserInputs('agent',inputData(),[harness],scope.signal);
 const read=async(path:string,offset?:number,limit?:number)=>{
  const call:ToolCall={type:'toolCall',id:randomUUID(),name:'read',arguments:{path,...(offset?{offset}:{}),...(limit?{limit}:{})}};
  const assistant=fauxAssistantMessage([call],{stopReason:'toolUse'}),record=await append(assistant),turn=new AgentTurnData(messages,record);
  await harness.handle(assistant,{scope,toolCalls:[call],data:turn,beforeToolCall:async()=>{},validateToolCall:()=>call.arguments,execute:async()=>{throw Error('File owns its executor');}});
 };
 const fill=async(target:number)=>{while((context.history.messageCount??0)<target)await append(fauxAssistantMessage('Private working message'));};
 return {root,context,manager,history,effects,scope,saveEffect:save,state:()=>state,harness:()=>harness,append,user,input,read,fill,inputData,restart:()=>{harness=new FileReactHarness(root,state,source);},fail:(value:boolean)=>{fail=value;}};
}

test('64 messages trigger replacement only on user input; refresh uses message IDs and README only',async t=>{
 const f=await fixture(t);await f.user();await f.input();
 const initial=f.state().data.replacementMessageId;
 await f.read('frontend/app.ts');await f.read('backend/impl.ts');await f.read('.rsi/project/backend/_ctx/DESIGN.md');
 await f.fill(64);assert.equal(f.state().data.replacementMessageId,initial,'never refresh during ordinary work');
 await f.user();assert.equal(f.context.history.messageCount,65);
 // The refresh must not enumerate or search the transcript. Entry lookup by ID remains available.
 const entries=f.context.history.entries,oldIterator=entries[Symbol.iterator];
 entries[Symbol.iterator]=()=>{throw Error('Full history scan forbidden');};
 try{await f.input();}finally{entries[Symbol.iterator]=oldIterator;}
 const id=f.state().data.replacementMessageId as string,entry=f.context.entry(id)!;
 assert.equal(entry.message.role,'user');assert.equal(entry.metadata.source,'file-context-refresh');
 const body=text(entry);assert.match(body,/<system_instruction>/);assert.match(body,/not a user request/);assert.match(body,/frontend\/ \[working\] — User interface/);
 assert.match(body,/backend\/ — Durable storage/);assert.match(body,/BACKEND_USAGE_CONTRACT/);
 assert.doesNotMatch(body,/INCLUDED_SOURCE_MUST_NOT_LOAD|DEPENDENCY_PRIVATE_SOURCE|DEPENDENCY_PRIVATE_DESIGN|File React Harness/);
 assert.equal(f.context.history.messageCount,65,'replacement does not count');assert.notEqual(id,initial);assert.equal(f.state().data.messagesSinceRefresh,0);
 const views=f.context.history.entries.filter(e=>typeof e.metadata.fileViewPath==='string');
 assert.equal(views.find(e=>String(e.metadata.fileViewPath).endsWith('frontend/app.ts'))!.metadata.modelContextHidden,undefined);
 assert.ok(views.filter(e=>String(e.metadata.fileViewPath).includes('/backend/')).every(e=>e.metadata.fileContextRefreshHidden===true));
 assert.ok(f.history.some(e=>text(e).includes('DEPENDENCY_PRIVATE_SOURCE')));assert.ok(f.history.every(e=>e.metadata.modelContextHidden!==true));
 const count=f.effects.length;await f.input();assert.equal(f.effects.length,count,'generated user-role entry does not recursively react');
});

test('dependencies accumulate across restart and refresh; old replacement is hidden and missing README is explicit',async t=>{
 const f=await fixture(t);await f.user();await f.input();await f.read('backend/impl.ts');await f.fill(64);await f.user();await f.input();
 const old=f.state().data.replacementMessageId as string;f.restart();await f.read('auth/auth.ts');
 await f.fill(128);await f.user();await f.input();
 assert.deepEqual(f.state().data.discoveredDependencyDesigns,['auth','backend']);assert.equal(f.state().data.messagesSinceRefresh,0);
 const previous=f.context.entry(old)!;assert.equal(previous.metadata.modelContextHidden,true);assert.match(text(previous),/BACKEND_USAGE_CONTRACT/);
 assert.equal(projectFileContextEntry(structuredClone(previous)),null);
 const current=f.context.entry(f.state().data.replacementMessageId as string)!;
 assert.match(text(current),/BACKEND_USAGE_CONTRACT/);assert.match(text(current),/### auth\n\nNo README available\./);
 assert.equal(f.context.history.messageCount,129);assert.equal(f.context.pendingInputs().length,0);
});

test('failed refresh keeps the previous reference and counter; restart can retry without losing source views',async t=>{
 const f=await fixture(t);await f.user();await f.input();await f.read('backend/impl.ts');await f.fill(64);await f.user();
 const before=structuredClone(f.context.history),state=structuredClone(f.state());f.fail(true);
 await assert.rejects(f.input(),/refused transaction/);assert.deepEqual(f.state(),state);
 f.context.replace(before);f.fail(false);f.restart();await f.input();
 assert.equal(f.state().data.messagesSinceRefresh,0);assert.match(text(f.context.entry(f.state().data.replacementMessageId as string)!),/BACKEND_USAGE_CONTRACT/);
});

test('assistant and tool messages count while runtime-generated and peer messages never trigger the user-input hook',async t=>{
 const f=await fixture(t);await f.user();await f.input();const initial=f.state().data.replacementMessageId;await f.fill(65);
 await f.append({role:'user',content:'Private feedback',timestamp:1},{source:'publication-feedback'});
 await f.append({role:'user',content:'Peer message',timestamp:1},{source:'group-chat',author:{type:'member',name:'Peer'}});
 await f.input();assert.equal(f.state().data.replacementMessageId,initial);
 await f.user();await f.input();assert.notEqual(f.state().data.replacementMessageId,initial);
});

test('Agent execution reacts before the model and never refreshes when work crosses the threshold mid-run',async t=>{
 const f=await fixture(t);await f.user();await f.input();const initial=f.state().data.replacementMessageId;await f.fill(63);await f.user();
 const model=fauxProvider().getModel(),requests:string[]=[];let calls=0;
 const stream:ModelStream=async function*(request){
  requests.push(JSON.stringify(request.context.messages));
  const response=calls++===0?fauxAssistantMessage([{type:'toolCall',id:'read-dependency',name:'read',arguments:{path:'backend/impl.ts'}}],{stopReason:'toolUse'}):fauxAssistantMessage('Done');
  yield {type:'start',partial:response};yield {type:'done',reason:response.stopReason as 'stop'|'toolUse',message:response};
 };
 const run=(id:string):RunState=>({agentId:'agent',runId:id,status:'running',phase:'model',step:0,startedAt:1,endedAt:null,endPosition:null,activeMessageId:null,error:null});
 const observer={message:async(entry:CompletedMessage)=>{f.history.push(structuredClone(entry));return entry;},componentMessage:async(entry:CompletedMessage,effects:ComponentMessageEffects)=>{f.saveEffect(effects);f.history.push(structuredClone(entry));return entry;},contextPatched:async(_revision:number,_patch:unknown,effects?:ComponentMessageEffects)=>{if(effects)f.saveEffect(effects);}};
 const first=new AgentExecution(run('first'),f.context,0,{model,tools:[],systemPrompt:'Fixed',options:{}},fixedPolicy(model),stream,observer,undefined,64,[f.harness()]);
 assert.equal((await first.run(f.scope.signal)).status,'completed');
 assert.equal(f.context.history.messageCount,67);assert.equal(f.state().data.replacementMessageId,initial);assert.ok(requests.every(request=>request.includes('<system_instruction>')&&!request.includes('BACKEND_USAGE_CONTRACT')));
 await f.user();
 const second=new AgentExecution(run('second'),f.context,f.history.length,{model,tools:[],systemPrompt:'Fixed',options:{}},fixedPolicy(model),stream,observer,undefined,64,[f.harness()]);
 assert.equal((await second.run(f.scope.signal)).status,'completed');
 assert.match(requests.at(-1)!,/system_instruction/);assert.match(requests.at(-1)!,/BACKEND_USAGE_CONTRACT/);
 assert.doesNotMatch(requests.at(-1)!,/DEPENDENCY_PRIVATE_SOURCE/);assert.ok(f.state().data.replacementMessageId);
});
