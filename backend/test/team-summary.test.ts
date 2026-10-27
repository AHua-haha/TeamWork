import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { AgentRuntime, fixedPolicy } from '../src/core/agent/runtime.js';
import type { AgentData } from '../src/core/agent/data/repository.js';
import type { AgentConfiguration, ResolvedRunConfig, StepScope } from '../src/core/agent/contracts.js';
import { AppError, type RunState } from '../src/core/agent/data/model.js';
import { prepareGroupSummary, validateGroupSummaryText, type GroupSummary, type GroupSummarySubmission } from '../src/core/team/data/group-summary.js';
import { summaryMessages } from './group-summary-fixture.js';
import { withTeam, settle, type Fixture } from './team-fixture.js';

function terminal(status: RunState['status']='completed'): RunState {
  return {agentId:'maintenance',runId:'run',status,phase:'finished',step:1,startedAt:1,endedAt:2,endPosition:0,activeMessageId:null,error:null};
}
function summaryFixture(f: Fixture, count=40, size=4000) {
  const source=summaryMessages(count,size,f.workspaceId);let saved:GroupSummary|undefined;let reads=0;
  const config: ResolvedRunConfig={model:fauxProvider().getModel(),options:{},tools:[],systemPrompt:'Lead rules',source:{appRevision:0,agentRevision:0,catalogRevisions:{}}};
  Object.assign(f.team.runConfig,{resolveForRun:async(id:string)=>{assert.equal(id,f.lead.memberId);return config;}});
  Object.assign(f.store,{
    summaryInput:async()=>{reads++;return prepareGroupSummary(source,0,saved);},
    submitGroupSummary:async(workspaceId:string,input:GroupSummarySubmission)=>{
      assert.equal(workspaceId,f.workspaceId);validateGroupSummaryText(input.text);
      const expected=prepareGroupSummary(source,0,saved);
      for(const key of ['baseRevision','from','through','analyzedThrough','sourceDigest'] as const) assert.equal(input[key],expected[key]);
      saved={revision:input.baseRevision+1,from:input.from,through:input.through,analyzedThrough:input.analyzedThrough,sourceDigest:input.sourceDigest,text:input.text,messageId:`summary-${input.baseRevision+1}`,time:1};return saved;
    },
  });
  const submit=async(configuration:AgentConfiguration)=>{
    assert.equal(configuration.tools.length,1);const tool=configuration.tools[0]!;
    assert.equal(tool.definition.name,'submit_group_summary');
    await tool.execute({summary:'Current shared goals, decisions and remaining work.'},{} as StepScope,{type:'toolCall',id:'submit',name:tool.definition.name,arguments:{summary:'Current shared goals, decisions and remaining work.'}});
  };
  return {source,config,submit,get saved(){return saved;},get reads(){return reads;}};
}

test('startup generates a shared summary for existing eligible context with pinned metadata owned by Team',()=>withTeam(async f=>{
  const data=summaryFixture(f);let calls=0;
  Object.assign(f.runtime,{async runMaintenance(configuration:AgentConfiguration,entries:unknown[],signal:AbortSignal){
    assert.equal(this,f.runtime);assert.equal(signal.aborted,false);assert.equal(entries.length,10,'latest 30 are not passed to summarizer');
    assert.equal(configuration.compaction,undefined);assert.match(configuration.systemPrompt??'',/messages 1 through 10/);calls++;await data.submit(configuration);return terminal();
  }});
  await f.team.startMaintenance();assert.equal(calls,1);assert.equal(data.saved?.through,10);assert.equal(data.saved?.analyzedThrough,40);
  assert.equal(f.runtime.runs.length,0);await f.team.startMaintenance();assert.equal(calls,1);
}));

test('full maintenance Agent loop corrects schema and submission failures before saving a summary',t=>withTeam(async f=>{
  const data=summaryFixture(f),warnings:unknown[][]=[];t.mock.method(console,'warn',(...args:unknown[])=>{warnings.push(args);});
  const ownership={acquireRuntime:async()=>{},assertRuntime:()=>{},releaseRuntime:async()=>{},recoverCompactions:async()=>{},recoverInterruptedRuns:async()=>{}} as unknown as AgentData;
  let calls=0;
  const runtime=new AgentRuntime(ownership,{resolveForRun:async()=>data.config},fixedPolicy(data.config.model),async function*(request){
    calls++;
    assert.equal(request.context.messages[0]?.role,'user');assert.doesNotMatch(JSON.stringify(request.context.messages),/Message (?:1[1-9]|[23][0-9]|40):/);
    const args={summary:calls===1?'':calls===2?'   ':'Preserved project goals and decisions.'};
    if(calls===2||calls===3){const error=request.context.messages.filter(message=>message.role==='toolResult').at(-1);assert.ok(error&&error.role==='toolResult'&&error.isError);const before=data.saved;assert.equal(before,undefined);}
    if(calls===3)assert.match(JSON.stringify(request.context.messages.at(-1)),/nonempty summary text/);
    if(calls===4){const result=request.context.messages.filter(message=>message.role==='toolResult').at(-1);assert.ok(result&&result.role==='toolResult'&&!result.isError);}
    const message=calls<=3?fauxAssistantMessage([{type:'toolCall',id:`submit${calls}`,name:'submit_group_summary',arguments:args}],{stopReason:'toolUse'}):fauxAssistantMessage('Summary saved.');
    yield {type:'start',partial:{...message,content:[],stopReason:'pending'}};yield {type:'done',reason:calls<=3?'toolUse':'stop',message};
  });
  await runtime.open();f.team.attach(runtime);
  try{await f.team.startMaintenance();assert.equal(calls,4);assert.equal(data.saved?.revision,1);assert.equal(warnings.length,2);}
  finally{await f.team.closeMaintenance();await runtime.close();}
}));

test('startup skips short context and context with only 30 recent messages',async()=>{
  for(const [count,size]of [[40,20],[30,5000]])await withTeam(async f=>{
    const data=summaryFixture(f,count,size);Object.assign(f.runtime,{runMaintenance:async()=>assert.fail('not eligible')});
    await f.team.startMaintenance();assert.equal(data.reads,1);assert.equal(data.saved,undefined);
  });
});

test('publication and startup deduplicate summary jobs and covered sources do not regenerate',()=>withTeam(async f=>{
  const data=summaryFixture(f);let calls=0,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  Object.assign(f.runtime,{async runMaintenance(configuration:AgentConfiguration){assert.equal(this,f.runtime);calls++;await gate;await data.submit(configuration);return terminal();}});
  await f.team.runner.postUser(f.workspaceId,'Continue');const scan=f.team.startMaintenance();await settle();assert.equal(calls,1);release();await scan;
  f.runtime.end(f.lead.memberId);await settle();await f.team.runner.postUser(f.workspaceId,'Continue again');await settle();assert.equal(calls,1);
}));

test('failed summary jobs are visible and retry on a later publication without claiming acceptance',t=>withTeam(async f=>{
  const data=summaryFixture(f),errors:unknown[][]=[];t.mock.method(console,'error',(...args:unknown[])=>{errors.push(args);});let calls=0;
  Object.assign(f.runtime,{async runMaintenance(configuration:AgentConfiguration){calls++;if(calls===1)throw new Error('Fixture generation failure');await data.submit(configuration);return terminal();}});
  await f.team.startMaintenance();const before=data.saved;assert.equal(before,undefined);assert.match(JSON.stringify(errors),/Fixture generation failure/);
  await f.team.runner.postUser(f.workspaceId,'Retry');await settle();assert.equal(calls,2);assert.equal(data.saved?.revision,1);
}));

test('maintenance cannot succeed without accepted text and shutdown drains active summary work',async t=>{
  await withTeam(async f=>{summaryFixture(f);const errors:unknown[][]=[];t.mock.method(console,'error',(...args:unknown[])=>{errors.push(args);});Object.assign(f.runtime,{runMaintenance:async()=>terminal()});await f.team.startMaintenance();assert.match(JSON.stringify(errors),/without an accepted group summary/);});
  await withTeam(async f=>{summaryFixture(f);let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});let calls=0;Object.assign(f.runtime,{async runMaintenance(_config:AgentConfiguration,_entries:unknown[],signal:AbortSignal){calls++;started();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return terminal('cancelled');}});const scan=f.team.startMaintenance();await ready;await f.team.closeMaintenance();await scan;assert.equal(calls,1);});
});

test('stale summary source aborts maintenance instead of asking the model to repair backend metadata',t=>withTeam(async f=>{
  summaryFixture(f);t.mock.method(console,'error',()=>{});Object.assign(f.store,{submitGroupSummary:async()=>{throw new AppError('context_conflict','Source reset',409);}});
  let aborted=false;
  Object.assign(f.runtime,{async runMaintenance(configuration:AgentConfiguration,_entries:unknown[],signal:AbortSignal){try{await configuration.tools[0]!.execute({summary:'Valid text'},{} as StepScope,{type:'toolCall',id:'submit',name:'submit_group_summary',arguments:{summary:'Valid text'}});}catch{}aborted=signal.aborted;return terminal('cancelled');}});
  await f.team.startMaintenance();assert.equal(aborted,true);
}));
