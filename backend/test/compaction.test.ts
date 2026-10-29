import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxProvider, normalizeContext, type AssistantMessage } from '@earendil-works/pi-ai';
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate';
import { AgentExecution, fixedPolicy, type AgentObserver } from '../src/core/agent/agent.js';
import { compactedContext, estimateRequestTokens, validateCompactionSettings, type CompactionState } from '../src/core/agent/data/compaction.js';
import type { AgentConfiguration, ModelRequest, ModelStream, RuntimePolicy, RuntimeTool } from '../src/core/agent/contracts.js';
import type { ContextEntry, RunState } from '../src/core/agent/data/model.js';
import { groupEntry, groupSender } from '../src/core/team/data/group-chat.js';
import { agentPrompt } from '../src/core/agent/prompts.js';

const model = fauxProvider().getModel(), prompt = agentPrompt('context-compaction');
const initial: RunState = {agentId:'member',runId:'run',status:'running',phase:'model',step:0,startedAt:1,endedAt:null,endPosition:null,activeMessageId:null,error:null};
const input = (text: string): ContextEntry => ({messageId:'old',message:{role:'user',content:text,timestamp:1},metadata:{}});
function response(text: string, tokens = 10): AssistantMessage {
  const message = fauxAssistantMessage(text);
  message.usage = {...message.usage,input:tokens,output:0,cacheRead:0,cacheWrite:0,totalTokens:tokens};
  return message;
}
function shared(text = 'User objective') {
  const message = {workspaceId:'workspace',messageId:'g1',position:1,exchangeId:'exchange',author:{type:'user' as const},text,recipients:[],time:1};
  return {position:1,entry:groupEntry(message),sender:groupSender(message)};
}
function fixture(options: {
  entries?: ContextEntry[]; threshold?: number; tools?: RuntimeTool[]; observer?: AgentObserver;
  produce: (mode: string, request: ModelRequest, call: number) => AssistantMessage | Promise<AssistantMessage>;
  groupText?: string;
}) {
  const requests: {mode: string;request: ModelRequest}[] = [], modes = new WeakMap<ModelRequest,string>();
  const base = fixedPolicy(model,options.tools), group = shared(options.groupText);
  let publications=0;
  const policy: RuntimePolicy = {...base,
    groupContext:async()=>({id:'workspace',read:async after=>after<1?[group]:[]}),
    buildRequest:async(scope,history)=>{const request=await base.buildRequest(scope,history);modes.set(request,scope.mode??'work');return request;},
    shouldContinue:(_scope,message)=>{publications++;return message.content.some(block=>block.type==='toolCall');},
  };
  const stream:ModelStream=async function*(request){
    const mode=modes.get(request)!;requests.push({mode,request});
    const message=await options.produce(mode,request,requests.length);
    yield {type:'start',partial:{...message,content:[],stopReason:'pending'}};
    yield {type:'done',reason:message.stopReason as 'stop'|'toolUse'|'length',message};
  };
  const config:AgentConfiguration={model,tools:options.tools??[],systemPrompt:'',options:{},compaction:{thresholdTokens:options.threshold??200,prompt}};
  const agent=new AgentExecution(initial,{revision:0,entries:options.entries??[]},0,config,policy,stream,options.observer);
  return {agent,requests,publications:()=>publications};
}

test('token measurement delegates full normalized prompt/tools/images and reported usage to Pi',()=>{
  const request:ModelRequest={model,tools:[],context:{systemPrompt:'system '.repeat(100),tools:[{name:'inspect',description:'description',parameters:{type:'object',properties:{}}}],messages:[{role:'user',content:[{type:'text',text:'question'},{type:'image',mimeType:'image/png',data:'x'.repeat(10000)}],timestamp:1},response('short',20000)]}};
  assert.equal(estimateRequestTokens(request),estimateContextTokens(normalizeContext(request.context)).tokens);
  assert.equal(estimateRequestTokens(request),20000,'uses reported usage, not text size alone');
  request.context.messages=request.context.messages.slice(0,1);
  assert.ok(estimateRequestTokens(request)>1200,'includes system prompt and tool declarations with image estimate');
});

test('pre-call compaction retains the complete new trace, resumes the same loop and invalidates old usage',async()=>{
  const stable:ContextEntry[]=[], starts:CompactionState[]=[];
  const tool:RuntimeTool={definition:{name:'inspect',description:'read facts',parameters:{type:'object',properties:{}}},execute:async(_args,scope)=>{
    assert.equal(scope.mode,'compaction');return {content:[{type:'text',text:'retrieved precise state'}],isError:false};
  }};
  let preparation=0;
  const f=fixture({entries:[input('OLD PRIVATE '.repeat(1000))],tools:[tool],observer:{compactionStarted:async state=>{starts.push(state);},compactionMessage:async record=>{stable.push(structuredClone(record));return record;}},produce:(mode)=>{
    if(mode==='work')return response('Ordinary final',20);
    if(++preparation===1)return fauxAssistantMessage([{type:'toolCall',id:'lookup',name:'inspect',arguments:{}}],{stopReason:'toolUse'});
    return response('Current state and exact references.\n\n## Next steps\nFinish the existing objective.',100000);
  }});
  const terminal=await f.agent.run(new AbortController().signal);
  assert.equal(terminal.status,'completed');
  assert.deepEqual(f.requests.map(item=>item.mode),['compaction','compaction','work']);
  assert.equal(f.publications(),1,'private preparation never invokes ordinary continuation/publication');
  assert.equal(starts.length,1);assert.equal(starts[0]!.trigger,'before-model');
  const context=f.agent.snapshot().context.entries;
  assert.doesNotMatch(JSON.stringify(context),/OLD PRIVATE|This message marks a replacement boundary/);
  assert.match(JSON.stringify(context),/User objective|retrieved precise state|Next steps/);
  assert.deepEqual(context.map(entry=>entry.message.role),['user','assistant','toolResult','assistant','assistant']);
  const retained=context.find(entry=>entry.metadata.contextUsageInvalidated&&entry.message.role==='assistant'&&entry.message.stopReason==='stop')!;
  assert.equal(retained.message.role==='assistant'&&retained.message.usage.totalTokens,0);
  const stableFinal=stable.at(-1)!.message;
  assert.equal(stableFinal.role==='assistant'&&stableFinal.usage.totalTokens,100000,'stable usage is unchanged');
  assert.ok(estimateRequestTokens(f.requests.at(-1)!.request)<200,'discarded prefix usage does not retrigger finishing compaction');
});

test('finishing compaction uses the same threshold and awaits cutover without another ordinary call',async()=>{
  let release!:()=>void, entered!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve), saving=new Promise<void>(resolve=>entered=resolve);
  const f=fixture({threshold:200,observer:{compactionFinished:async(state,revision,entries)=>{assert.equal(state.trigger,'after-run');entered();await gate;return {revision:revision+1,entries};}},produce:mode=>mode==='work'?response('Original public answer',1000):response('Finished state; no remaining work.',1000)});
  const running=f.agent.run(new AbortController().signal);await saving;
  assert.match(JSON.stringify(f.agent.snapshot().context.entries),/Original public answer/,'old context remains until acknowledgement');
  release();assert.equal((await running).status,'completed');
  assert.deepEqual(f.requests.map(item=>item.mode),['work','compaction']);
  assert.equal(f.publications(),1);
  assert.match(JSON.stringify(f.agent.snapshot().context.entries),/Finished state/);
  assert.doesNotMatch(JSON.stringify(f.agent.snapshot().context.entries),/Original public answer/,'the original private prefix was replaced');
});

test('unchanged large group history gets one attempt per checkpoint, never recursive compaction',async()=>{
  const f=fixture({groupText:'SHARED '.repeat(500),produce:mode=>response(mode==='work'?'Answer':'Continuation',mode==='work'?1000:10)});
  assert.equal((await f.agent.run(new AbortController().signal)).status,'completed');
  assert.deepEqual(f.requests.map(item=>item.mode),['compaction','work','compaction']);
  assert.equal(f.publications(),1);
  assert.match(JSON.stringify(f.agent.snapshot().context.entries),/SHARED/);
});

test('failed pre-call preparation preserves old context and recorded tool effects without resuming work',async()=>{
  let calls=0;
  const tool:RuntimeTool={definition:{name:'inspect',description:'inspect',parameters:{type:'object',properties:{}}},execute:async()=>{calls++;return {content:[{type:'text',text:'observed external state'}],isError:false};}};
  let modelCalls=0;
  const f=fixture({entries:[input('OLD RESULT '.repeat(1000))],tools:[tool],produce:()=>{
    if(++modelCalls===1)return fauxAssistantMessage([{type:'toolCall',id:'effect',name:'inspect',arguments:{}}],{stopReason:'toolUse'});
    throw new Error('provider failed during preparation');
  }});
  const terminal=await f.agent.run(new AbortController().signal);
  assert.equal(terminal.status,'failed');assert.equal(terminal.error!.code,'compaction_failed');assert.equal(calls,1);
  const context=JSON.stringify(f.agent.snapshot().context.entries);
  assert.match(context,/OLD RESULT|observed external state/);assert.match(context,/No old context was discarded/);
  assert.equal(f.requests.length,2);assert.equal(f.publications(),0);
});

test('finishing preparation failure preserves the ordinary outcome and does not retry',async()=>{
  const f=fixture({produce:mode=>{if(mode==='work')return response('Accepted answer',1000);throw new Error('compaction unavailable');}});
  const terminal=await f.agent.run(new AbortController().signal);
  assert.equal(terminal.status,'completed');assert.equal(terminal.error,null);
  assert.deepEqual(f.requests.map(item=>item.mode),['work','compaction']);
  assert.match(JSON.stringify(f.agent.snapshot().context.entries),/Accepted answer/);
  assert.match(JSON.stringify(f.agent.snapshot().context.entries),/No old context was discarded/);
});

test('cutover refusal leaves old context intact and does not claim completed preparation',async()=>{
  const f=fixture({entries:[input('OLD STATE '.repeat(1000))],observer:{compactionFinished:async()=>{throw new Error('cutover refused');}},produce:()=>response('Prepared continuation')});
  await assert.rejects(f.agent.run(new AbortController().signal),/cutover refused/);
  assert.equal(f.agent.snapshot().run.status,'failed');
  assert.match(JSON.stringify(f.agent.snapshot().context.entries),/OLD STATE/);
  assert.equal(f.requests.length,1);
});

test('rebuilding preserves only incorporated group coverage and defers arrivals during preparation',async()=>{
  const first=shared(),second={...shared('Late shared message'),position:2,entry:{...groupEntry({workspaceId:'workspace',messageId:'g2',position:2,exchangeId:'exchange',author:{type:'user'},text:'Late shared message',recipients:[],time:2})}};
  const before={revision:1,entries:[{...first.entry,metadata:{...first.entry.metadata,groupContextId:'workspace',groupPosition:1}}]};
  const retained=[{messageId:'prepared',message:response('Continuation',5000),metadata:{}}];
  const rebuilt=await compactedContext('member',before,retained,{id:'workspace',read:async()=>[first,second]});
  assert.deepEqual(rebuilt.map(entry=>entry.messageId),['g1','prepared']);
  assert.equal(retained[0]!.message.usage.totalTokens,5000);
});

test('compaction requires a positive token threshold and a maintained instruction',()=>{
  for(const thresholdTokens of [0,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateCompactionSettings({thresholdTokens,prompt}),/positive/);
  assert.throws(()=>validateCompactionSettings({thresholdTokens:200,prompt:''}),/instruction/);
  validateCompactionSettings({thresholdTokens:1,prompt});
  assert.match(prompt,/Next steps/);assert.match(prompt,/next concrete action/);assert.match(prompt,/Do not invent/);
});

test('the before-call checkpoint runs again after tools settle within the same ordinary run',async()=>{
  const tool:RuntimeTool={definition:{name:'inspect',description:'inspect',parameters:{type:'object',properties:{}}},execute:async()=>({content:[{type:'text',text:'exact tool facts'}],isError:false})};
  let work=0;
  const f=fixture({tools:[tool],produce:mode=>{
    if(mode==='compaction')return response('Preserved exact tool facts.\n## Next steps\nFinish answer.',10000);
    if(++work===1){const call=fauxAssistantMessage([{type:'toolCall',id:'read',name:'inspect',arguments:{}}],{stopReason:'toolUse'});call.usage={...call.usage,input:1000,totalTokens:1000};return call;}
    return response('Finished answer',10);
  }});
  assert.equal((await f.agent.run(new AbortController().signal)).status,'completed');
  assert.deepEqual(f.requests.map(item=>item.mode),['work','compaction','work']);
  assert.match(JSON.stringify(f.requests[1]!.request.context.messages),/exact tool facts/,'tool results settle before preparation');
});

test('a completed publication cannot hide a finishing cutover acknowledgement failure',async()=>{
  const f=fixture({observer:{compactionFinished:async()=>{throw new Error('uncertain SQL acknowledgement');},finished:async state=>({...state,status:'completed',error:null})},produce:mode=>response(mode==='work'?'Accepted public answer':'Continuation',1000)});
  await assert.rejects(f.agent.run(new AbortController().signal),/uncertain SQL acknowledgement/);
  assert.match(JSON.stringify(f.agent.snapshot().context.entries),/Accepted public answer/);
});
