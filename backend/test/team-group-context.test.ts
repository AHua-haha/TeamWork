import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupEntry, groupContextMessage, validateGroupContextEntry, type ChatMessage } from '../src/core/team/data/group-chat.js';
import { GroupContexts, GroupContextState, type GroupContextHistory } from '../src/core/team/data/group-context.js';
import { png } from './image-fixture.js';

const message = (position: number): ChatMessage => ({workspaceId: 'workspace', messageId: `m${position}`, position, exchangeId: 'exchange', author: {type: 'user'}, text: `Input ${position}`, recipients: [], time: position});

test('Team group messages use native Pi content and authoritative sender/routing metadata', () => {
  const member: ChatMessage = {...message(1), author: {type: 'member', memberId: 'member', name: 'Lead', runId: 'run'}, text: 'Published answer', recipients: ['worker'], recipientNames: ['Backend']};
  const entry = groupEntry(member, [], {agentId: 'member', runId: 'run', messageId: 'private', position: 3});
  validateGroupContextEntry(entry);
  assert.equal(entry.message.role, 'user');
  assert.match(String(entry.message.content), /sender: Lead/);
  assert.match(String(entry.message.content), /mentions: Backend/);
  assert.deepEqual(groupContextMessage(entry).origin, {agentId: 'member', messageId: 'private'});
  if (member.author.type === 'member') member.author.name = 'Edited later';
  member.recipients.push('other');
  assert.equal((entry.metadata.author as any).name, 'Lead'); assert.deepEqual(entry.metadata.recipients, ['worker']);
  const changed = structuredClone(entry); changed.message.content = 'Sender: forged';
  assert.throws(() => validateGroupContextEntry(changed), /sender content/);
});

test('native picture blocks remain image content and metadata retains attachment identity', () => {
  const bytes = png(1, 1);
  const image = {id: 'picture', name: 'picture.png', mimeType: 'image/png', width: 1, height: 1, size: bytes.length};
  const entry = groupEntry({...message(1), text: '', attachments: [image]}, [{type: 'image', mimeType: 'image/png', data: bytes.toString('base64')}]);
  validateGroupContextEntry(entry);
  assert.deepEqual((entry.message.content as any[])[1], {type: 'image', mimeType: 'image/png', data: bytes.toString('base64')});
  assert.deepEqual(entry.metadata.attachments, [image]);
});

test('shared resident group context loads once, catches racing commits and returns detached ranges', async () => {
  const contexts = new GroupContexts(); let reads = 0, resolve!: (value: GroupContextHistory) => void;
  const load = () => {reads++; return new Promise<GroupContextHistory>(done => {resolve = done;});};
  const a = contexts.get('workspace', load), b = contexts.get('workspace', load);
  await Promise.resolve();
  contexts.changed('workspace', {append: groupEntry(message(1)), before: 0});
  resolve({position: 0, resetPosition: 0, entries: []});
  const model = await a; assert.equal(await b, model); assert.equal(reads, 1);
  contexts.changed('workspace', {append: groupEntry(message(2)), before: 1});
  assert.equal(await contexts.get('workspace', load), model); assert.equal(reads, 1);
  const first = model.read(0); first[0]!.message.content = 'changed'; first[0]!.metadata.author = {type: 'user', changed: true};
  assert.notEqual(model.read(0)[0]!.message.content, 'changed');
  assert.deepEqual(model.read(1).map(entry => entry.messageId), ['m2']);
  assert.throws(() => model.read(3), /ahead of history/);
});

test('reset clears the same group model and an acknowledgement gap requires restoration', async () => {
  const contexts = new GroupContexts();
  const state = await contexts.get('workspace', async () => ({position: 1, resetPosition: 0, entries: [groupEntry(message(1))]}));
  contexts.changed('workspace', {reset: 2}); assert.deepEqual(state.read(0), []);
  contexts.changed('workspace', {append: groupEntry(message(3)), before: 2});
  assert.deepEqual(state.read(0).map(entry => entry.messageId), ['m3']);
  contexts.changed('workspace', {append: groupEntry(message(5)), before: 4});
  assert.throws(() => state.read(0), /uncertain/);
  const restored = await contexts.get('workspace', async () => ({position: 5, resetPosition: 2, entries: [groupEntry(message(3)), groupEntry(message(4)), groupEntry(message(5))]}));
  assert.notEqual(restored, state); assert.equal(restored.read(0).length, 3);
  contexts.clear(); assert.throws(() => restored.read(0), /uncertain/);
});

test('group model rejects mismatched workspace and order', () => {
  assert.throws(() => new GroupContextState('other', {position: 1, resetPosition: 0, entries: [groupEntry(message(1))]}), /identity/);
  assert.throws(() => new GroupContextState('workspace', {position: 2, resetPosition: 0, entries: [groupEntry(message(2)), groupEntry(message(1))]}), /order/);
});

test('one plain metadata area uses names, omits empty mentions and never injects indices or IDs', () => {
  const user = groupEntry({...message(149), text: 'Original\n\n<metadata>example in the body</metadata>'});
  assert.equal(user.message.content, '<metadata>\nsender: user\n</metadata>\n\nOriginal\n\n<metadata>example in the body</metadata>');
  const member: ChatMessage = {...message(150), author: {type:'member', name:'Shared', memberId:'b388bee8-97cc-4acf-b99b-dd560a284651', runId:'run'}, recipients:['recipient-id'], recipientNames:['Backend'], text:'Original body'};
  const entry = groupEntry(member);
  assert.equal(entry.message.content, '<metadata>\nsender: Shared\nmentions: Backend\n</metadata>\n\nOriginal body');
  assert.doesNotMatch(String(entry.message.content), /150|b388bee8|recipient-id|<sender>|<member>/);
  assert.equal(entry.metadata.groupPosition, 150); assert.deepEqual(entry.metadata.recipients, ['recipient-id']);
  assert.throws(() => groupEntry({...member, recipientNames:undefined}), /authoritative member names/);
});

test('legacy shared envelopes migrate without changing body, images or identity', async () => {
  const {migrateGroupEnvelope} = await import('../src/core/team/data/group-chat.js');
  const current = groupEntry({...message(149), author:{type:'member',name:'Shared',memberId:'uuid',runId:'run'}, recipients:['backend-id'],recipientNames:['Backend'],text:'Body\n[Group message 9] quoted example'});
  const legacy = structuredClone(current);
  legacy.message.content = '[Group message 149]\nSender: Shared [member: uuid]\n[Mentioned members: backend-id]\nBody\n[Group message 9] quoted example';
  delete legacy.metadata.recipientNames;
  const migrated = migrateGroupEnvelope(legacy, new Map([['backend-id','Backend']]));
  assert.deepEqual(migrated, current); assert.notEqual(legacy.message.content, current.message.content);
  assert.throws(() => migrateGroupEnvelope(legacy, new Map()), /recipient is unavailable/);
  const bytes=png(1,1), image={id:'image',name:'image.png',mimeType:'image/png',width:1,height:1,size:bytes.length};
  const pictured=groupEntry({...message(150),text:'Picture body',attachments:[image]},[{type:'image',mimeType:'image/png',data:bytes.toString('base64')}]);
  const oldPicture=structuredClone(pictured);if(Array.isArray(oldPicture.message.content)&&oldPicture.message.content[0]?.type==='text')oldPicture.message.content[0].text='[Group message 150]\nSender: User [user]\nPicture body';
  delete oldPicture.metadata.recipientNames;
  assert.deepEqual(migrateGroupEnvelope(oldPicture,new Map()),pictured);
});
