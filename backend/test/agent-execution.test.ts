import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { AgentExecution, fixedPolicy, type AgentObserver } from '../src/core/agent/agent.js';
import type { ModelStream, AgentConfiguration } from '../src/core/agent/contracts.js';
import type { RunState } from '../src/core/agent/types.js';

const model = fauxProvider().getModel();
const config: AgentConfiguration = { model, tools: [], systemPrompt: '', options: {} };
const initial: RunState = { agentId: 'agent', runId: 'run', status: 'running', phase: 'model', step: 0, startedAt: 1, endedAt: null, endPosition: null, activeMessageId: null, error: null };
function execution(observer?: AgentObserver) {
  const response = fauxAssistantMessage('answer');
  const stream: ModelStream = async function* () {
    yield { type: 'start', partial: { ...response, content: [], stopReason: 'pending' } };
    yield { type: 'done', reason: 'stop', message: response };
  };
  return new AgentExecution(initial, { revision: 0, entries: [] }, 0, config, fixedPolicy(model), stream, observer);
}

test('one Agent executes entirely in memory without a persistence provider', async () => {
  const agent = execution();
  const terminal = await agent.run(new AbortController().signal);
  assert.equal(terminal.status, 'completed'); assert.equal(terminal.endPosition, 1);
  const snapshot = agent.snapshot();
  assert.equal(snapshot.context.entries.length, 1);
  assert.equal(snapshot.context.entries[0]!.message.role, 'assistant');
  snapshot.context.entries.length = 0;
  assert.equal(agent.snapshot().context.entries.length, 1, 'public state is detached');
  await assert.rejects(agent.run(new AbortController().signal), /already started/);
});

test('caller acknowledgement completes before dependent finalization and can assign stable record positions', async () => {
  let release!: () => void, entered!: () => void, finished = false;
  const gate = new Promise<void>(resolve => release = resolve), recording = new Promise<void>(resolve => entered = resolve);
  const agent = execution({
    messageStart: async () => 8,
    message: async record => { entered(); await gate; return record; },
    finished: async state => { finished = true; return state; },
  });
  const running = agent.run(new AbortController().signal);
  await recording;
  assert.equal(finished, false);
  assert.equal(agent.snapshot().context.entries.length, 0);
  release();
  const terminal = await running;
  assert.equal(finished, true); assert.equal(terminal.endPosition, 9);
});

test('caller persistence failure becomes failed execution and terminal acknowledgement failure is observable', async () => {
  let state: RunState | undefined;
  const agent = execution({ message: async () => { throw new Error('caller write failed'); }, finished: async value => { state = value; } });
  const result = await agent.run(new AbortController().signal);
  assert.equal(state?.status, 'failed'); assert.match(result.error!.message, /caller write failed/);
  assert.equal(agent.snapshot().context.entries.length, 0);
  const terminalFailure = execution({ finished: async () => { throw new Error('terminal write failed'); } });
  await assert.rejects(terminalFailure.run(new AbortController().signal), /terminal write failed/);
  assert.equal(terminalFailure.snapshot().run.status, 'completed', 'memory execution is terminal even when caller persistence fails');
});

test('Agent reads its shared reference only at work boundaries and carries private work into the next activation', async () => {
  const { groupEntry, groupSender } = await import('../src/core/team/group-chat.js');
  const groups = [1].map(position => {
    const shared = {workspaceId:'workspace',messageId:`g${position}`,position,exchangeId:'exchange',author:{type:'user' as const},text:`request ${position}`,recipients:[],time:position};
    return {position,entry:groupEntry(shared),sender:groupSender(shared)};
  });
  const reads: number[] = [], requests: string[] = [];
  const reference = {id:'workspace',read:async (after:number) => {reads.push(after);return groups.filter(message=>message.position>after);}};
  const tool = {definition:{name:'check',description:'check',parameters: {type:'object' as const,properties:{}}},execute:async () => {
    const shared={workspaceId:'workspace',messageId:'g2',position:2,exchangeId:'exchange',author:{type:'user' as const},text:'arrived during work',recipients:[],time:2};
    groups.push({position:2,entry:groupEntry(shared),sender:groupSender(shared)});
    return {content:[{type:'text' as const,text:'private tool result'}],isError:false};
  }};
  let step=0;
  const stream:ModelStream=async function*(request) {
    requests.push(JSON.stringify(request.context.messages));
    const response=++step===1 ? fauxAssistantMessage([{type:'toolCall',id:'check1',name:'check',arguments:{}}],{stopReason:'toolUse'}) : fauxAssistantMessage('private final');
    yield {type:'start',partial:{...response,content:[],stopReason:'pending'}};
    yield {type:'done',reason:response.stopReason as 'stop'|'toolUse',message:response};
  };
  const policy={...fixedPolicy(model,[tool]),groupContext:async () => reference};
  const agent=new AgentExecution(initial,{revision:0,entries:[]},0,{...config,tools:[tool]},policy,stream);
  assert.equal((await agent.run(new AbortController().signal)).status,'completed');
  assert.deepEqual(reads,[0,1]);
  assert.equal(requests.some(text=>text.includes('arrived during work')),false);
  const snapshot=agent.snapshot();
  assert.equal(snapshot.context.entries.at(-1)!.messageId,'g2');
  assert.deepEqual(snapshot.context.entries.map(entry=>entry.message.role),['user','assistant','toolResult','assistant','user']);
  const next=new AgentExecution({...initial,runId:'next'},snapshot.context,snapshot.historyPosition,config,{...fixedPolicy(model),groupContext:async()=>reference},stream);
  await next.run(new AbortController().signal);
  assert.match(requests.at(-1)!,/private tool result/);
  assert.match(requests.at(-1)!,/arrived during work/);
  assert.equal(next.snapshot().context.entries.filter(entry=>entry.messageId==='g1').length,1);
});

test('refused context persistence cannot advance Agent-owned incorporation state', async () => {
  const input={messageId:'g1',message:{role:'user' as const,content:'Sender: User\nrequest',timestamp:1},metadata:{}};
  const stream:ModelStream=async function*(){throw new Error('model must not run before context acknowledgement');};
  const agent=new AgentExecution(initial,{revision:0,entries:[]},0,config,{...fixedPolicy(model),groupContext:async()=>({id:'workspace',read:async()=>[{position:1,entry:input,sender:'Sender: User'}]})},stream,{
    contextChanged:async()=>{throw new Error('context persistence refused');},
  });
  assert.equal((await agent.run(new AbortController().signal)).status,'failed');
  assert.deepEqual(agent.snapshot().context,{revision:0,entries:[]});
});
