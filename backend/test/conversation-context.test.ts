import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { AgentMessageContext, adoptRecordedContext, repairInterruptedTools, type GroupContextMessage } from '../src/core/agent/data/context.js';
import { groupEntry, groupSender, type ChatMessage } from '../src/core/team/data/group-chat.js';
import type { ContextEntry } from '../src/core/agent/data/model.js';
const contextInput = (text: string, metadata = {}): ContextEntry => ({ messageId: text.replace(/[^A-Za-z0-9_-]/g, '-'), message: { role: 'user', content: text, timestamp: 1 }, metadata });
test('interrupted tool exchange gets context-only missing results without modifying original history', () => {
  const assistant: ContextEntry = { messageId: 'calls', message: fauxAssistantMessage([{ type: 'toolCall', id: 'a', name: 'bash', arguments: { command: 'work' } }, { type: 'toolCall', id: 'b', name: 'read', arguments: { path: 'file' } }], { stopReason: 'toolUse' }), metadata: {} };
  const result: ContextEntry = { messageId: 'result', message: { role: 'toolResult', toolCallId: 'a', toolName: 'bash', content: [{ type: 'text', text: 'done' }], isError: false, timestamp: 1 }, metadata: {} };
  const original = [assistant, result, contextInput('Later failed activation', {})];
  const before = structuredClone(original), repaired = repairInterruptedTools(original);
  assert.deepEqual(original, before); assert.equal(repaired.length, 4);
  const missing = repaired[2]!;
  assert.equal(missing.message.role, 'toolResult');
  if (missing.message.role !== 'toolResult') throw new Error('missing error result');
  assert.equal(missing.message.toolCallId, 'b'); assert.equal(missing.message.isError, true);
  assert.match(JSON.stringify(missing.message), /not replayed/);
  assert.equal(repairInterruptedTools(repaired).length, repaired.length);
});

test('complete tool results are kept exactly without synthetic errors', () => {
  const entries = [contextInput('No tools were interrupted', {})];
  assert.deepEqual(repairInterruptedTools(entries), entries);
});

const group = (position: number, text: string, origin?: {agentId: string; messageId: string}): GroupContextMessage => {
  const message: ChatMessage = { workspaceId: 'workspace', messageId: `g${position}`, position, exchangeId: 'exchange', author: origin ? {type: 'member', memberId: origin.agentId, name: 'Lead', runId: 'run'} : {type: 'user'}, text, recipients: [], time: position };
  return {position, entry: groupEntry(message), sender: groupSender(message), ...(origin ? {origin} : {})};
};

test('Agent selects incoming shared messages using its own context, preserving chronology and source state', async () => {
  const g1 = group(1, 'First'), g2 = group(2, 'Next');
  const reads: number[] = [];
  const reference = {id: 'workspace', read: async (after: number) => { reads.push(after); return [g1,g2].filter(g => g.position > after); }};
  const first = await new AgentMessageContext('member', {revision:0,entries:[]}).incoming({...reference,read:async () => [g1]});
  const working = contextInput('Private result');
  const next = await new AgentMessageContext('member',{revision:1,entries:[...first!,working]}).incoming(reference);
  assert.deepEqual(reads,[1]);
  assert.deepEqual(next!.map(e => e.messageId),['g1','Private-result','g2']);
  assert.match(JSON.stringify(next![0]!.message), /Sender: User/);
  assert.equal(await new AgentMessageContext('member',{revision:2,entries:next!}).incoming(reference),undefined);
  assert.deepEqual(reads,[1,2]);
});

test('own accepted final retains signed original blocks and adds attribution/provenance without duplicating answer', async () => {
  const original: ContextEntry = {messageId:'final',message:fauxAssistantMessage([{type:'thinking',thinking:'private reasoning',thinkingSignature:'signed-reasoning'},{type:'text',text:'Done',textSignature:'opaque'}]),metadata:{}};
  const copy = structuredClone(original);
  const shared = group(1,'Done',{agentId:'lead',messageId:'final'});
  const reference = {id:'workspace',read:async (after: number) => after ? [] : [shared]};
  const entries = await new AgentMessageContext('lead',{revision:0,entries:[original]}).incoming(reference);
  assert.equal(entries!.length,1);
  assert.match(JSON.stringify(entries![0]!.message),/Sender: Lead/);
  assert.deepEqual((entries![0]!.message.content as unknown[])[0],(copy.message.content as unknown[])[0], 'thinking remains first and signed');
  assert.deepEqual((entries![0]!.message.content as unknown[]).at(-1),(copy.message.content as unknown[]).at(-1));
  assert.deepEqual(original,copy,'history/source values are untouched');
  assert.equal(entries![0]!.metadata.groupMessageId,'g1');
  assert.equal(await new AgentMessageContext('lead',{revision:1,entries:entries!}).incoming(reference),undefined);
  const other = await new AgentMessageContext('other',{revision:0,entries:[]}).incoming(reference);
  assert.equal(other![0]!.message.role,'user');
});

test('invalid group ordering refuses incorporation and does not mutate existing state', async () => {
  const context = {revision:0,entries:[contextInput('private')]};
  const before = structuredClone(context);
  await assert.rejects(new AgentMessageContext('member',context).incoming({id:'w',read:async () => [group(2,'two'),group(1,'one')]}),/strictly ordered/);
  assert.deepEqual(context,before);
});

test('one-time legacy adoption preserves recorded private work and original group provenance', () => {
  const final: ContextEntry={messageId:'final',message:fauxAssistantMessage('Done',{timestamp:2}),metadata:{}};
  const context=adoptRecordedContext('lead','workspace',[],[final],[group(1,'request'),group(3,'Done',{agentId:'lead',messageId:'final'})]);
  assert.deepEqual(context.map(e=>e.messageId),['g1','final']);
  assert.equal(context[1]!.metadata.groupPosition,3);
});

test('legacy adoption preserves tool/result pairing while group publications overlap private execution', () => {
  const call:ContextEntry={messageId:'call',message:fauxAssistantMessage([{type:'toolCall',id:'a',name:'bash',arguments:{command:'work'}}],{stopReason:'toolUse',timestamp:1}),metadata:{}};
  const result:ContextEntry={messageId:'result',message:{role:'toolResult',toolCallId:'a',toolName:'bash',content:[{type:'text',text:'done'}],isError:false,timestamp:3},metadata:{}};
  const adopted=adoptRecordedContext('member','workspace',[],[call,result],[group(2,'incoming')]);
  assert.deepEqual(adopted.map(entry=>entry.messageId),['call','result','g2']);
  assert.equal(adopted.some(entry=>entry.metadata.source==='interrupted-tool-result'),false);
});

test('legacy adoption regenerates context-only interrupted results once in the correct place', () => {
  const call:ContextEntry={messageId:'unfinished',message:fauxAssistantMessage([{type:'toolCall',id:'lost',name:'bash',arguments:{command:'work'}}],{stopReason:'toolUse',timestamp:1}),metadata:{}};
  const later=contextInput('later');
  const existing=repairInterruptedTools([call,later]);
  const adopted=adoptRecordedContext('member','workspace',existing,[call,later],[]);
  assert.equal(adopted.filter(entry=>entry.message.role==='toolResult').length,1);
  assert.deepEqual(adopted.map(entry=>entry.message.role),['assistant','toolResult','user']);
});
