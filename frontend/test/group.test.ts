import assert from 'node:assert/strict';
import test from 'node:test';
import { GroupClient, type GroupEntry } from '../src/client/group-client.js';
import { runActivity, mentionAt, mentionToken, toolSetSummary, workToolSummary, type ActivityItem } from '../src/ui/group-work.js';
import { assistant, record, run, streamResponse, until, agentId, runId } from './fixtures.js';
const workspaceId = 'w1';
const user: GroupEntry = { workspaceId, entryId: 'u1', position: 1, revision: 1, exchangeId: 'e1', time: 1, kind: 'user', messageId: 'u1', text: 'work' };
const member: Extract<GroupEntry, { kind: 'member' }> = { workspaceId, entryId: runId, position: 2, revision: 2, exchangeId: 'e1', time: 1, kind: 'member', memberId: agentId, name: 'Backend', run: run(), working: { after: 0, through: null }, finalRef: null, text: null };
const frame = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ version: 1, workspaceId, type, ...data })}\n\n`;
const change = (cursor: number, entry: GroupEntry) => frame('entry', { change: { cursor, entry } });

test('POST reserves immediately without skipping unseen changes; stale acknowledgement cannot replace a final', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  let accept!: (response: Response) => void;
  const ack = new Promise<Response>(resolve => { accept = resolve; });
  const client = new GroupClient(workspaceId, { fetcher: async (_url, init) => init?.method === 'POST' ? ack : streamResponse(body) });
  client.follow();
  const pending = client.send('work');
  controller.enqueue(new TextEncoder().encode(change(1, user) + change(2, member) + frame('sync', { cursor: 2 })));
  await until(() => client.getSnapshot().cursor === 2);
  const completed: GroupEntry = { ...member, revision: 3, run: run('completed'), working: { after: 0, through: 1 }, finalRef: { agentId, runId, messageId: 'final', position: 1 }, text: '# Finished' };
  controller.enqueue(new TextEncoder().encode(change(3, completed)));
  await until(() => client.getSnapshot().cursor === 3);
  accept(new Response(JSON.stringify({ entries: [user, member] }), { status: 202 }));
  await pending;
  assert.equal(client.getSnapshot().entries.length, 2);
  assert.equal(client.getSnapshot().entries[1]!.revision, 3);
  assert.equal(client.getSnapshot().entries[1]!.position, 2);
  client.dispose(); controller.close();
});

test('acknowledgement ahead of feed does not advance cursor; reconnect fills gaps and updates older positions', async () => {
  const requests: string[] = [];
  let hold!: ReadableStreamDefaultController<Uint8Array>;
  const retained = new ReadableStream<Uint8Array>({ start(value) { hold = value; } });
  const later: GroupEntry = { ...user, entryId: 'u2', messageId: 'u2', position: 3, revision: 3, text: 'later' };
  const done: GroupEntry = { ...member, revision: 4, run: run('cancelled'), working: { after: 0, through: 1 } };
  let follows = 0;
  const client = new GroupClient(workspaceId, { retryDelayMs: () => 0, fetcher: async (url, init) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ entries: [later] }), { status: 202 });
    requests.push(String(url)); follows++;
    return follows === 1 ? streamResponse(change(1, user) + change(2, member) + frame('sync', { cursor: 2 })) : streamResponse(retained);
  } });
  await client.send('later'); assert.equal(client.getSnapshot().cursor, 0);
  client.follow();
  await until(() => requests.length === 2);
  assert.match(requests[1]!, /after=2$/);
  hold.enqueue(new TextEncoder().encode(change(3, later) + change(4, done) + frame('sync', { cursor: 4 })));
  await until(() => client.getSnapshot().cursor === 4);
  assert.deepEqual(client.getSnapshot().entries.map(entry => entry.entryId), ['u1', runId, 'u2']);
  assert.equal(client.getSnapshot().entries[1]!.revision, 4);
  client.dispose(); hold.close();
});

test('refusal leaves no optimistic entry; malformed/gapped updates stop without advancing cursor', async () => {
  const client = new GroupClient(workspaceId, { fetcher: async (_url, init) => init?.method === 'POST'
    ? new Response(JSON.stringify({ error: { code: 'member_busy', message: 'Backend is working' } }), { status: 409 })
    : streamResponse(change(2, member)) });
  await assert.rejects(client.send('work'), /Backend is working/);
  assert.equal(client.getSnapshot().entries.length, 0);
  assert.match(client.getSnapshot().commandError!, /working/);
  client.follow(); await until(() => client.getSnapshot().connection === 'error');
  assert.equal(client.getSnapshot().cursor, 0); client.dispose();
});

const snapshot = (completed: ReturnType<typeof record>[] = [], live: import('../src/client/protocol.js').LiveMessage[] = []): import('../src/client/protocol.js').ClientSnapshot => ({ agentId, completed, live, historyPosition: completed.at(-1)?.position ?? 0, synchronized: true, connection: 'following', run: run(), sending: false, error: null });
const call = (position: number, name = 'read', id = `call-${position}`) => ({ ...record(position, `m-${position}`, ''), message: { ...assistant(''), content: [{ type: 'toolCall' as const, id, name, arguments: { path: String(position) } }] } });
const result = (position: number, id: string, text: string) => ({ ...record(position, `r-${position}`, ''), message: { role: 'toolResult' as const, toolCallId: id, toolName: 'read', content: [{ type: 'text' as const, text }], isError: false, timestamp: 1 } });
const tools = (items: ActivityItem[]) => items.flatMap(item => item.kind === 'tools' ? item.tools : []);

test('ordinary text streams immediately in one flow while thinking remains hidden', () => {
  const partial = { ...assistant(''), content: [{type:'thinking' as const,thinking:'hidden'}, {type:'text' as const,text:'Let me check'}] };
  const live = {messageId:'live',runId,message:partial,nextSequence:2,lastEvent:{type:'text_delta' as const,contentIndex:1,delta:'Let me check',partial}};
  assert.deepEqual(runActivity(snapshot([], [live]), member), [{id:'live-1',kind:'text',text:'Let me check'}]);
  const extended = {...partial,content:[...partial.content.slice(0,1),{type:'text' as const,text:'Let me check the files.'}]};
  assert.equal(runActivity(snapshot([], [{...live,message:extended}]), member)[0]?.kind, 'text');
  assert.equal((runActivity(snapshot([], [{...live,message:extended}]), member)[0] as {text:string}).text,'Let me check the files.');
});

test('consecutive tools merge across assistant messages and hidden thinking or empty text', () => {
  const thought = {...record(3,'thought',''),message:{...assistant(''),content:[{type:'thinking' as const,thinking:'hidden'},{type:'text' as const,text:'  '}]}};
  const state = snapshot([call(1),result(2,'call-1','first'),thought,call(4,'run_command'),result(5,'call-4','second')]);
  const before = structuredClone(state);
  const items = runActivity(state,member);
  assert.equal(items.length,1);
  assert.deepEqual(tools(items).map(tool=>[tool.text,tool.result]),[['read','first'],['run_command','second']]);
  assert.equal(toolSetSummary(tools(items)), '1 read · 1 command');
  assert.deepEqual(state,before,'grouping leaves stored records intact');
});

test('visible text separates tool sets in the original block order', () => {
  const mixed={...record(2,'mixed',''),message:{...assistant(''),content:[{type:'text' as const,text:'Found the file'},{type:'toolCall' as const,id:'next',name:'edit',arguments:{}}]}};
  const items=runActivity(snapshot([call(1),mixed]),member);
  assert.deepEqual(items.map(item=>item.kind),['tools','text','tools']);
  assert.equal(items[1]?.kind==='text'&&items[1].text,'Found the file');
});

test('late tool calls extend the visible stream instead of creating a provisional final', () => {
  const partial=assistant('I will inspect it');
  const live={messageId:'live',runId,message:partial,nextSequence:2,lastEvent:{type:'text_delta' as const,contentIndex:0,delta:'I will inspect it',partial}};
  const withTool={...partial,content:[...partial.content,{type:'toolCall' as const,id:'late',name:'read',arguments:{path:'src'}}]};
  assert.deepEqual(runActivity(snapshot([], [{...live,message:withTool}]),member).map(item=>item.kind),['text','tools']);
});

test('only accepted exact final text blocks leave the activity flow', () => {
  const final={...record(2,'final',''),message:{...assistant(''),content:[{type:'thinking' as const,thinking:'hidden'},{type:'text' as const,text:'Working commentary'},{type:'text' as const,text:'Answer'}]}};
  const state=snapshot([record(1,'earlier','Earlier work'),final]);
  assert.deepEqual(runActivity(state,member).map(item=>item.kind==='text'?item.text:''),['Earlier work','Working commentary','Answer']);
  const accepted={...member,run:run('completed'),working:{after:0,through:2},finalRef:{agentId,runId,messageId:'final',position:2,contentIndices:[2]},text:'Answer'};
  assert.deepEqual(runActivity(state,accepted).map(item=>item.kind==='text'?item.text:''),['Earlier work','Working commentary']);
});

test('tool results retain call order across parallel completion and reused IDs', () => {
  const state=snapshot([call(1,'read','same'),result(2,'same','first'),call(3,'read','same'),call(4,'read','other'),result(5,'other','other result'),result(6,'same','second')]);
  assert.deepEqual(tools(runActivity(state,member)).map(tool=>tool.result),['first','second','other result']);
});

test('projection respects run and stable range boundaries and excludes terminal partials', () => {
  const old={...record(1,'old','old'),runId:'old-run'}, next={...record(4,'next','next'),runId:'next-run'};
  const partial=assistant('unfinished');
  const live={messageId:'live',runId,message:partial,nextSequence:1,lastEvent:{type:'start' as const,partial}};
  const state=snapshot([old,record(2,'candidate','private candidate'),record(3,'final','Answer'),next],[live]);
  const entry={...member,run:run('failed'),working:{after:1,through:3}};
  assert.deepEqual(runActivity(state,entry).map(item=>item.kind==='text'?item.text:''),['private candidate','Answer']);
});

test('refused attempts and feedback stay visible; empty work has no placeholder', () => {
  const feedback={...record(2,'feedback',''),message:{role:'user' as const,content:'Publication refused',timestamp:1}};
  assert.deepEqual(runActivity(snapshot([record(1,'candidate','Candidate'),feedback]),member).map(item=>item.kind==='text'?item.text:''),['Candidate','Publication refused']);
  const accepted={...member,run:run('completed'),working:{after:0,through:1},finalRef:{agentId,runId,messageId:'final',position:1,contentIndices:[0]},text:'Answer'};
  assert.deepEqual(runActivity(snapshot([record(1,'final','Answer')]),accepted),[]);
});

test('three similar report attempts remain two refused private candidates and one accepted final', () => {
  const feedback = (position: number) => ({ ...record(position, `feedback-${position}`, ''), metadata: { source: 'publication-feedback' }, message: { role: 'user' as const, content: 'Group publication refused: No active member named "joplin".', timestamp: 1 } });
  const accepted = { ...member, run: run('completed'), working: { after: 0, through: 5 }, finalRef: { agentId, runId, messageId: 'accepted', position: 5, contentIndices: [0] }, text: 'The report.' };
  const state = snapshot([record(1, 'attempt-1', 'The report.'), feedback(2), record(3, 'attempt-2', 'The report.'), feedback(4), record(5, 'accepted', 'The report.')]);
  const before = structuredClone(state);
  const work = runActivity(state, accepted);
  assert.deepEqual(work.map(item => item.id), ['attempt-1-0', 'feedback-2', 'attempt-2-0', 'feedback-4']);
  assert.equal(work.filter(item => item.kind === 'text' && item.text === accepted.text).length, 2, 'distinct unpublished attempts are retained, not text-deduplicated');
  assert.ok(!work.some(item => item.id === 'accepted-0'), 'accepted source is not also rendered inside Work');
  assert.deepEqual(state, before);
});

test('historical accepted references exclude only their original final content', () => {
  const historical={...member,run:run('completed'),working:{after:0,through:2},finalRef:{agentId,runId,messageId:'final',position:2},text:'Answer'};
  assert.deepEqual(runActivity(snapshot([record(1,'earlier','Earlier work'),record(2,'final','Answer')]),historical),[{id:'earlier-0',kind:'text',text:'Earlier work'}]);
  const oldCall={...record(1,'old-action',''),message:{...assistant(''),content:[{type:'text' as const,text:'Earlier work'},{type:'toolCall' as const,id:'historical',name:'final_response',arguments:{text:'Answer'}}]}};
  const oldAck={...result(2,'historical','Prepared'),message:{...result(2,'historical','Prepared').message,toolName:'final_response'}};
  assert.deepEqual(runActivity(snapshot([oldCall,oldAck]),{...historical,finalRef:{agentId,runId,messageId:'old-action',position:1,toolCallId:'historical'}}),[{id:'old-action-0',kind:'text',text:'Earlier work'}]);
});

test('mention insertion and compact tool summaries retain their existing behavior', () => {
  assert.equal(mentionToken('Frontend Worker'),'@{Frontend Worker}');
  assert.equal(mentionToken('Backend'),'@Backend');
  assert.equal(mentionAt('mail@example',12),null);
  assert.deepEqual(mentionAt('Hi @Back',8),{start:3,query:'Back'});
  assert.deepEqual(workToolSummary({id:'tool',kind:'tool',text:'run_command',args:'{"argv":["node","--version"]}',result:'v26'}),{icon:'terminal',label:'Ran node --version'});
  assert.deepEqual(workToolSummary({id:'bash',kind:'tool',text:'bash',args:'{"command":"git status","metadata":{"git":{"scope":"design"}}}',result:'clean'}),{icon:'terminal',label:'Ran git status'});
  assert.equal(workToolSummary({id:'partial',kind:'tool',text:'edit',args:'null'}).label,'Updating file');
});
