import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage,type ToolCall} from '@earendil-works/pi-ai';
import {AgentState,AgentContextState} from '../src/core/agent/data/state.js';
import {AgentMessageData,AgentTurnData} from '../src/core/agent/data/messages.js';
import type {RunState,CompletedMessage,ContextEntry} from '../src/core/agent/data/model.js';
const run:RunState={agentId:'agent',runId:'run',status:'running',phase:'tools',step:1,startedAt:1,endedAt:null,endPosition:null,activeMessageId:null,error:null};
const prior:ContextEntry={messageId:'prior',message:{role:'user',content:'retained',timestamp:1},metadata:{original:true}};
const entry=(id:string):ContextEntry=>({messageId:id,message:{role:'user',content:id,timestamp:1},metadata:{}});

test('direct data-model writes publish memory only after acknowledgement and leave failures unchanged',async()=>{
 const state=new AgentState(run,{revision:0,entries:[prior]},0);
 let acknowledge!:()=>void;
 const data=new AgentMessageData(state,{message:record=>new Promise(resolve=>{acknowledge=()=>resolve(record);})});
 const pending=data.append(entry('new'));
 assert.equal(state.context.entries.length,1);assert.equal(state.historyPosition,0);
 acknowledge();await pending;
 assert.equal(state.context.entries.length,2);assert.equal(state.historyPosition,1);
 const failed=new AgentMessageData(state,{message:async()=>{throw new Error('rollback');},contextPatched:async()=>{throw new Error('rollback');}});
 await assert.rejects(failed.append(entry('failed')),/rollback/);await assert.rejects(failed.updateMetadata([{messageId:'prior',metadata:{changed:true}}]),/rollback/);
 assert.equal(state.context.entries.length,2);assert.deepEqual(data.entry('prior')!.metadata,prior.metadata);
});

test('one turn records paired results once and defers private instructions until every result exists',async()=>{
 const calls:ToolCall[]=[{type:'toolCall',id:'a',name:'read',arguments:{}},{type:'toolCall',id:'b',name:'check',arguments:{}}];
 const response=fauxAssistantMessage(calls,{stopReason:'toolUse'}),state=new AgentState(run,{revision:0,entries:[]},0);
 const data=new AgentMessageData(state),assistant=await data.append({messageId:'assistant',message:response,metadata:{}});
 const turn=new AgentTurnData(data,assistant);turn.appendInstruction({role:'user',content:'private instruction',timestamp:2});
 await assert.rejects(turn.flushInstructions(),/Every tool call requires a result/);
 const output={content:[{type:'text' as const,text:'first result'}],isError:false};
 await turn.recordToolResult(calls[0]!,output);await turn.recordToolResult(calls[0]!,output);
 assert.equal(state.context.entries.filter(e=>e.message.role==='toolResult').length,1);
 await assert.rejects(turn.recordToolResult({...calls[1]!,id:'foreign'},output),/Unknown tool-call/);
 await turn.recordToolResult(calls[1]!,output);await turn.flushInstructions();
 assert.deepEqual(state.context.entries.map(e=>e.message.role),['assistant','toolResult','toolResult','user']);
 assert.deepEqual(turn.orderedResults().map(m=>m.toolCallId),['a','b']);
 const detached=turn.entry('assistant')!;detached.metadata.changed=true;assert.equal(data.entry('assistant')!.metadata.changed,undefined);
});

test('component message/state acknowledgement updates targeted metadata without rewriting original message content',async()=>{
 const state=new AgentState(run,{revision:0,entries:[prior]},0),history:CompletedMessage[]=[];
 const data=new AgentMessageData(state,{message:async r=>{history.push(structuredClone(r));return r;},componentMessage:async(r,effects)=>{assert.equal(effects.componentId,'files');history.push(structuredClone(r));return r;}});
 const effects={componentId:'files',revision:0,data:{file:'visible'},metadataUpdates:[{messageId:'prior',metadata:{original:true,hidden:true}}]};
 await data.append(entry('result'),effects);
 assert.equal(state.context.entries[0]!.message.content,'retained');assert.equal(data.entry('prior')!.metadata.hidden,true);
 assert.equal(history.length,1);assert.equal(history[0]!.metadata.hidden,undefined);assert.deepEqual(prior.metadata,{original:true});
});

test('preparation metadata and private instructions use the preparation model and acknowledged journal only',async()=>{
 const state=new AgentState(run,{revision:0,entries:[prior]},0),journal:unknown[]=[];
 const data=new AgentMessageData(state,{compactionMessage:async record=>record,compactionMetadata:async(id,updates)=>{journal.push([id,updates]);}});
 const draft=new AgentContextState(state.context),preparation=data.prepare('compact','before-model',draft);
 await preparation.updateMetadata([{messageId:'prior',metadata:{prepared:true}}]);
 assert.deepEqual(state.context.entries[0]!.metadata,{original:true});assert.deepEqual(draft.entry('prior')!.metadata,{prepared:true});assert.equal(journal.length,1);
 const assistant=await preparation.append({messageId:'prepared-assistant',message:fauxAssistantMessage('recap'),metadata:{}});
 const turn=new AgentTurnData(preparation,assistant);turn.appendInstruction({role:'user',content:'saved private instruction',timestamp:3});await turn.flushInstructions();
 assert.equal(state.context.entries.length,1);assert.equal(preparation.trace.length,2);assert.ok(preparation.trace.every(e=>e.metadata.source==='context-compaction'));
 const refused=new AgentMessageData(state,{compactionMessage:async r=>r}).prepare('bad','after-run',new AgentContextState(state.context));
 await assert.rejects(refused.updateMetadata([{messageId:'prior',metadata:{bad:true}}]),/requires journal persistence/);
 const failed=new AgentMessageData(state,{compactionMessage:async r=>r,compactionMetadata:async()=>{throw new Error('journal rollback');}}).prepare('bad','after-run',new AgentContextState(state.context));
 await assert.rejects(failed.updateMetadata([{messageId:'prior',metadata:{bad:true}}]),/could not be acknowledged/);
 assert.deepEqual(failed.entry('prior')!.metadata,{original:true});assert.deepEqual(refused.entry('prior')!.metadata,{original:true});
});
