import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GroupContextState } from '../src/core/team/data/group-context.js';
import { prepareGroupSummary, validateGroupSummary, validateGroupSummaryText } from '../src/core/team/data/group-summary.js';
import { groupContextMessage } from '../src/core/team/data/group-chat.js';
import { compactedContext } from '../src/core/agent/data/compaction.js';
import { AgentMessageContext } from '../src/core/agent/data/context.js';
import { acceptedSummary, summaryMessages } from './group-summary-fixture.js';

function state(count = 40) {
  const source = summaryMessages(count);
  return {source, model: new GroupContextState('workspace', {position: count, resetPosition: 0, entries: source.map(item => item.entry)})};
}

test('summary source excludes the latest 30 original messages and later merges only the new older prefix', () => {
  const source = summaryMessages();
  const first = prepareGroupSummary(source, 0);
  assert.equal(first.messages.length, 10); assert.equal(first.through, 10); assert.equal(first.analyzedThrough, 40);
  assert.ok(first.uncoveredTokens > 32000);
  const previous = acceptedSummary(source);
  const next = prepareGroupSummary(summaryMessages(60), 0, previous);
  assert.equal(next.previous?.text, previous.text);
  assert.deepEqual(next.messages.map(item => item.position), Array.from({length:20},(_, i)=>i+11));
  assert.equal(next.through, 30); assert.equal(next.analyzedThrough, 60);
  assert.equal(prepareGroupSummary(summaryMessages(30), 0).messages.length, 0);
  assert.equal(prepareGroupSummary(source, 0, previous).messages.length, 0);
});

test('shared full reads replace the prefix, preserve the pinned tail and preserve concurrent arrivals', () => {
  const {source, model} = state();
  const tail = source.slice(10).map(item => item.entry);
  model.apply({summary: acceptedSummary(source)});
  assert.equal(model.read(0).length, 31);
  assert.equal(model.read(0)[0]!.metadata.source, 'group-summary');
  assert.equal(model.read(0)[0]!.message.content, '<metadata>\nsender: system\n</metadata>\n\n' + acceptedSummary(source).text);
  assert.deepEqual(model.read(0).slice(1), tail);
  const all = summaryMessages(45);
  for (const item of all.slice(40)) model.apply({append: item.entry, before: item.position-1});
  assert.equal(model.read(0).length, 36);
  assert.deepEqual(model.read(0).slice(1), all.slice(10).map(item=>item.entry));
  assert.deepEqual(model.read(8), all.slice(8).map(item=>item.entry), 'incremental incorporation keeps original chronological messages');
  assert.deepEqual(model.source(), all.map(item=>item.entry), 'original source remains available for pinned reads/history');
  const copy = model.read(0); copy[0]!.message.content = 'forged';
  assert.notEqual(model.read(0)[0]!.message.content, 'forged');
});

test('an older member checkpoint cannot receive a summary of future messages', async () => {
  const {source, model} = state(); model.apply({summary: acceptedSummary(source)});
  assert.deepEqual(model.read(0, 8), source.slice(0,8).map(item=>item.entry));
  const initial = await new AgentMessageContext('member', {revision:0,entries:[]}).incoming({id:'workspace',read:async after=>source.filter(item=>item.position>after&&item.position<=8)});
  const result = await compactedContext('member', {revision:1,entries:initial!}, [], {id:'workspace',read:async (after,through)=>model.read(after,through).map(groupContextMessage)});
  assert.equal(result.length, 8);
  assert.ok(result.every(entry=>entry.metadata.source==='group-chat'));
  const current = await new AgentMessageContext('member', {revision:0,entries:[]}).incoming({id:'workspace',read:async after=>source.filter(item=>item.position>after)});
  const folded = await compactedContext('member', {revision:1,entries:current!}, [], {id:'workspace',read:async (after,through)=>model.read(after,through).map(groupContextMessage)});
  assert.equal(folded.length, 31); assert.equal(folded[0]!.metadata.source, 'group-summary');
});

test('summary digests bind the prefix and previous revision but permit later messages', () => {
  const first = prepareGroupSummary(summaryMessages(), 0);
  const concurrent = prepareGroupSummary(summaryMessages(45), 0, undefined, 40);
  assert.equal(concurrent.sourceDigest, first.sourceDigest);
  const changed = summaryMessages(); changed[0]!.entry.message.content = 'changed source';
  assert.notEqual(prepareGroupSummary(changed, 0).sourceDigest, first.sourceDigest);
  assert.throws(()=>prepareGroupSummary([],41,undefined,40), /boundary/);
  validateGroupSummary(acceptedSummary());
  assert.throws(()=>validateGroupSummary({...acceptedSummary(),analyzedThrough:41}), /fields/);
  for(const text of ['', '   ', 'x'.repeat(24001)]) assert.throws(()=>validateGroupSummaryText(text), /nonempty/);
});

test('reset removes the summary and no old coverage can be acknowledged into the new context', () => {
  const {source, model}=state(); const summary=acceptedSummary(source);model.apply({summary});model.apply({reset:41});
  assert.deepEqual(model.read(0),[]);assert.equal(model.summary(),undefined);
  assert.throws(()=>model.apply({summary}), /stale/);
});
