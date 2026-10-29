import { memberBash } from './team-fixture.js';
import { contextPageInput } from '../src/core/context-page.js';
import { acceptFiles,initGit } from './git-fixture.js';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { duplexPair } from 'node:stream';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { createAgentServer } from '../src/api/http.js';
import type { AgentRuntime } from '../src/core/agent/runtime.js';
import { emptyDesignScope } from '../src/core/team/data/assignment.js';
import { stubConfig, withTeam, worker, configureAssignment, type Fixture } from './team-fixture.js';

type Body = Record<string, any>;

function send(server: Server, path: string, method = 'GET', data?: unknown): Promise<IncomingMessage> {
  const [client, socket] = duplexPair();
  server.emit('connection', socket);
  return new Promise((resolve, reject) => {
    const json = data === undefined ? undefined : JSON.stringify(data);
    // A DELETE has no framing by default in Node's client; a real client sends the length.
    const headers = json === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(json)) };
    const request = httpRequest({ path, method, createConnection: () => client, headers }, resolve);
    request.on('error', reject);
    request.end(json);
  });
}

function withServer(run: (call: (path: string, init?: { method?: string; data?: unknown; status?: number }) => Promise<Body>, fixture: Fixture) => Promise<void>): Promise<void> {
  return withTeam(async fixture => {
    const server = createAgentServer(fixture.runtime as unknown as AgentRuntime, stubConfig, fixture.workspaces, fixture.team);
    const call = async (path: string, { method = 'GET', data, status = 200 }: { method?: string; data?: unknown; status?: number } = {}) => {
      const response = await send(server, path, method, data);
      const body = JSON.parse(await text(response)) as Body;
      assert.equal(response.statusCode, status, JSON.stringify(body));
      return body;
    };
    try { await run(call, fixture); }
    finally { server.closeAllConnections(); }
  });
}

test('workspace member metadata uses REST resources; legacy detailed inspection and roster routes are unavailable', () => withServer(async (call, fixture) => {
  const created = await worker(fixture, 'Backend', ['backend']);
  const root = join(fixture.folder, '.rsi-harness');
  await assert.rejects(stat(root));

  const workspace = await call(`/workspaces/${fixture.workspaceId}`);
  assert.equal(workspace.workspaceId, fixture.workspaceId);
  assert.equal('context' in workspace, false);
  const memberList = await call(`/workspaces/${fixture.workspaceId}/members`);
  assert.deepEqual(memberList.members.map((m: Body) => m.name), ['Lead', 'Backend']);
  const member = await call(`/workspaces/${fixture.workspaceId}/members/${created.memberId}`);
  assert.equal(member.memberId, created.memberId);
  assert.equal(member.name, 'Backend');
  assert.equal(member.running, false);
  assert.equal('harness' in member, false);
  assert.equal('settings' in member, false);
  assert.equal('issues' in member, false);
  assert.equal('ready' in member, false);
  await assert.rejects(stat(root), 'metadata reads do not resolve Harnesses or create Harness storage');

  await call(`/workspaces/${fixture.workspaceId}/team/roster`, { status: 404 });
  await call(`/workspaces/${fixture.workspaceId}/team/members/${created.memberId}`, { status: 404 });
  await call(`/workspaces/other/members/${created.memberId}`, { status: 404 });
  await call(`/workspaces/${fixture.workspaceId}/members/missing`, { status: 404 });
  await call(`/workspaces/${fixture.workspaceId}/members/${created.memberId}/harness`, { status: 404 });
  assert.deepEqual((await call(`/workspaces/${fixture.workspaceId}/members`)).members.map((m: Body) => m.memberId), [fixture.lead.memberId, created.memberId]);
}));

test('workspace input goes to group chat; direct member input is refused', () => withServer(async (call, fixture) => {
  const member = await worker(fixture, 'Backend');
  for (const id of [fixture.lead.memberId, member.memberId]) assert.equal((await call(`/agents/${id}/runs`, { method: 'POST', status: 409, data: { input: 'hello' } })).error.code, 'member_conversation');
  const base = `/workspaces/${fixture.workspaceId}/chat`;
  const accepted = await call(`${base}/messages`, { method: 'POST', status: 202, data: { text: 'Build a reading list' } });
  assert.deepEqual(accepted.message.author, { type: 'user' });
  assert.equal(accepted.runs[0].agentId, fixture.lead.memberId);
  assert.equal((await call(`${base}/messages`, { method: 'POST', status: 409, data: { text: 'again' } })).error.code, 'member_busy');
  assert.equal((await call(base)).messages.length, 1);
  assert.equal((await call(`${base}?after=2`, { status: 409 })).error.code, 'invalid_cursor');
  assert.equal((await call(`${base}?after=0&after=0`, { status: 400 })).error.code, 'invalid_input');
  assert.equal((await call(base, { method: 'PUT', data: { mentionLimit: 7 } })).mentionLimit, 7);
  await call(base, { method: 'PUT', status: 400, data: { mentionLimit: 0 } });
  await call(`${base}/stop`, { method: 'POST', status: 202 });
  assert.equal(fixture.runtime.last(fixture.lead.memberId)?.status, 'cancelled');
}));

test('group timeline endpoints expose persisted reservations and paged changes', () => withServer(async (call, fixture) => {
  const base = `/workspaces/${fixture.workspaceId}/chat`;
  const accepted = await call(`${base}/messages`, { method: 'POST', data: { text: 'work' }, status: 202 });
  assert.deepEqual(accepted.entries.map((entry: { kind: string }) => entry.kind), ['user', 'member']);
  const page = await call(`${base}/timeline?after=0&limit=1`);
  assert.equal(page.changes.length, 1); assert.equal(page.more, true);
  const next = await call(`${base}/timeline?after=1`);
  assert.equal(next.changes[0].entry.position, 2);
}));

test('group history pages current entries separately from changes and guard older pages against reset', () => withServer(async (call, f) => {
  const base = `/workspaces/${f.workspaceId}/chat`;
  assert.deepEqual((await call(`${base}/history`)).entries, []);
  await call(`${base}/messages`, {method: 'POST', data: {text: 'work'}, status: 202});
  const first = await call(`${base}/history?limit=1`);
  assert.equal(first.entries.length, 1); assert.equal(first.entries[0].kind, 'member');
  assert.equal(first.cursor, 2); assert.equal(first.nextBefore, 2); assert.equal(first.hasOlder, true);
  const older = await call(`${base}/history?before=2&limit=1&resetCursor=0`);
  assert.equal(older.entries[0].kind, 'user'); assert.equal(older.hasOlder, false); assert.equal(older.nextBefore, null);
  for (const query of ['limit=0', 'limit=101', 'before=0&resetCursor=0', 'before=2', 'resetCursor=0', 'limit=1&limit=2', 'unknown=1']) await call(`${base}/history?${query}`, {status: 400});
  await call('/workspaces/missing/chat/history', {status: 404});
  await call(`${base}/history`, {method: 'POST', status: 404});
  await call(`${base}/stop`, {method: 'POST', status: 202});
  await new Promise(resolve => setImmediate(resolve));
  await call(`${base}/reset`, {method: 'POST'});
  assert.equal((await call(`${base}/history?before=2&resetCursor=0`, {status: 409})).error.code, 'history_reset');
  assert.deepEqual((await call(`${base}/history`)).entries, []);
}));

test('configuration review and separate user activation enforce exact input and whole-workspace idle state', () => withServer(async (call, f) => {
  const member = await worker(f, 'Backend', ['src']);
  const source = await f.team.configuration.accepted(f.workspaceId, member.memberId), files = await f.team.memberWorkspace.files(f.lead.memberId);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(files.root, source.path), JSON.stringify({ ...JSON.parse(source.files['member.json']!), responsibility: 'Validated update' }));
  const base = `/workspaces/${f.workspaceId}/team/configuration`;
  const pending = await call(base + '?source=pending'); assert.equal(pending.valid, true); assert.equal(pending.changes[0].type, 'update');
  await call(base + '?source=bad', {status:400});
  await acceptFiles(f);
  assert.equal((await f.team.service.get(f.workspaceId,member.memberId)).responsibility,member.responsibility);
  const accepted = await call(base), input = { revision:accepted.revision,digest:accepted.digest };
  await call(base+'/activate',{method:'POST',data:{...input,actor:'user'},status:400});
  await f.team.runner.postUser(f.workspaceId,'@Backend work');
  assert.equal((await call(base+'/activate',{method:'POST',data:input,status:409})).error.code,'workspace_busy');
  f.runtime.end(member.memberId);
  const { settle } = await import('./team-fixture.js'); await settle();
  const activated = await call(base+'/activate',{method:'POST',data:input}); assert.ok(activated.memberIds.includes(member.memberId));
  assert.equal((await f.team.service.get(f.workspaceId,member.memberId)).responsibility,'Validated update');
  assert.equal((await call(base+'/activate',{method:'POST',data:input,status:409})).error.code,'stale_revision');
}));

test('user model settings persist independently of member files, reject stale/foreign/extra writes and allow busy saves', () => withServer(async (call, f) => {
  const member = await worker(f, 'Backend', ['src']);
  const path = `/workspaces/${f.workspaceId}/members/${member.memberId}`;
  const initial = await call(path + '/model-settings');
  const value = { connectionId: 'conn', modelId: 'other-user-model', modelOptions: [{ connectionId: 'conn', modelId: 'other-user-model', reasoning: 'high', temperature: 0.5, maxTokens: 100, contextBudget: 2000 }] };
  const saved = await call(path + '/model-settings', { method: 'PUT', data: { revision: initial.revision, value } });
  assert.deepEqual(saved.value, value); assert.equal(saved.revision, initial.revision + 1);
  const memberMetadata = await call(path);
  assert.equal(memberMetadata.name, 'Backend');
  assert.equal('settings' in memberMetadata, false);
  assert.deepEqual((await call(`/workspaces/${f.workspaceId}/members`)).members.map((m: Body) => m.memberId), [f.lead.memberId, member.memberId]);
  const before = await f.team.service.find(member.memberId);
  await call(path+'/model-settings',{method:'PUT',status:400,data:{revision:saved.revision,value:{connectionId:'conn',modelId:'model'}}});
  await call(path + '/model-settings', { method:'PUT', status:409, data:{revision:initial.revision,value} });
  for (const extra of [{ prompt:'bypass' }, { toolOptionIds:['admin'] }, { designScope:{} }]) await call(path+'/model-settings',{method:'PUT',status:400,data:{revision:saved.revision,value:{...value,...extra}}});
  await call(path+'/model-settings',{method:'PUT',status:400,data:{revision:saved.revision,value:{...value,modelOptions:[{connectionId:'conn',modelId:'model',temperature:10}]}}});
  await call(`/workspaces/wrong/members/${member.memberId}/model-settings`,{status:404});
  assert.deepEqual(await f.team.service.find(member.memberId), before);
  await f.team.runner.postUser(f.workspaceId,'@Backend work');
  await call(path+'/model-settings',{method:'PUT',data:{revision:saved.revision,value:{...value,modelId:'third-model'}}});
  assert.equal(f.runtime.active(member.memberId)?.status,'running');
  f.runtime.end(member.memberId);
  const { settle } = await import('./team-fixture.js'); await settle();
  const current = await f.team.service.get(f.workspaceId,member.memberId);
  await f.team.service.retire(f.workspaceId,member.memberId,current.revision);
  await call(path+'/model-settings',{status:404});
  await call(path+'/model-settings',{method:'PUT',status:404,data:{revision:current.revision,value}});
}));

test('user reset endpoint clears idle conversations and rejects busy, unknown and invalid routes', () => withServer(async (call, f) => {
  const base = `/workspaces/${f.workspaceId}/chat`;
  await call(`${base}/messages`, { method: 'POST', status: 202, data: { text: 'Old chat' } });
  assert.equal((await call(`${base}/reset`, { method: 'POST', status: 409 })).error.code, 'workspace_busy');
  assert.equal((await call(base)).messages.length, 1);
  await call(`${base}/stop`, { method: 'POST', status: 202 });
  await new Promise(resolve => setImmediate(resolve));
  const result = await call(`${base}/reset`, { method: 'POST' });
  assert.equal(result.workspaceId, f.workspaceId);
  assert.ok(result.resetCursor > 0 && result.resetPosition > 0);
  assert.deepEqual((await call(`${base}/timeline`)).changes, []);
  assert.deepEqual((await call(base)).messages, []);
  await call(`${base}/reset`, { status: 404 });
  await call(`${base}/reset?unexpected=1`, { method: 'POST', status: 400 });
  await call('/workspaces/missing/chat/reset', { method: 'POST', status: 404 });
  assert.equal((await call(`/workspaces/${f.workspaceId}/members`)).members.length, 1);
}));

test('Changes endpoint returns only protected reviews and activation references without full configuration inspection', () => withServer(async (call, f) => {
  const path = `/workspaces/${f.workspaceId}/team/changes`;
  f.team.configuration.current = async () => { throw new Error('Comprehensive inspection must not run'); };
  const review = await call(path);
  assert.equal(review.leadId, f.lead.memberId);
  assert.equal(review.activation.hasChanges, false);
  assert.deepEqual(review.design.changes, []);
  assert.deepEqual(review.members.changes, []);
  assert.equal(review.current, undefined);
  assert.equal(review.activation.digest, undefined);
  await call(path + '?unknown=1', { status: 400 });
  await call(path, { method: 'POST', status: 404 });
  await call('/workspaces/missing/team/changes', { status: 404 });
}));

test('multipart HTTP publication stores scoped pictures, preserves image-only input and refuses atomically', () => withTeam(async fixture => {
  const { png } = await import('./image-fixture.js');
  const server = createAgentServer(fixture.runtime as unknown as AgentRuntime, stubConfig, fixture.workspaces, fixture.team);
  const base = `/workspaces/${fixture.workspaceId}/chat`;
  const upload = async (files: Uint8Array[], textValue = '') => {
    const form = new FormData(); form.set('text', textValue);
    files.forEach((bytes, i) => form.append('images', new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), `picture-${i}.png`));
    const encoded = new Request('http://localhost', { method: 'POST', body: form });
    const raw = Buffer.from(await encoded.arrayBuffer());
    const [client, socket] = duplexPair(); server.emit('connection', socket);
    return new Promise<IncomingMessage>((resolve, reject) => {
      const request = httpRequest({ path: `${base}/messages`, method: 'POST', createConnection: () => client, headers: { 'Content-Type': encoded.headers.get('content-type')!, 'Content-Length': raw.length } }, resolve);
      request.on('error', reject); request.end(raw);
    });
  };
  try {
    const refused = await upload([png(), Buffer.from('bad image')]);
    assert.equal(refused.statusCode, 400); await text(refused);
    assert.equal(fixture.store.chatImages.size, 0); assert.equal((await fixture.team.runner.snapshot(fixture.workspaceId)).messages.length, 0);
    const accepted = await upload([png()]); const payload = JSON.parse(await text(accepted));
    assert.equal(accepted.statusCode, 202); assert.equal(payload.message.text, '');
    const image = payload.message.attachments[0];
    assert.equal(JSON.stringify(payload).includes('base64'), false);
    const response = await send(server, `${base}/attachments/${image.id}`);
    assert.equal(response.statusCode, 200); assert.equal(response.headers['content-type'], 'image/png');
    const chunks: Buffer[] = []; for await (const chunk of response) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), png());
    const cross = await send(server, `/workspaces/other/chat/attachments/${image.id}`);
    assert.equal(cross.statusCode, 404); await text(cross);
    const busy = await upload([png()], 'try again'); assert.equal(busy.statusCode, 409); await text(busy);
    assert.equal(fixture.store.chatImages.size, 1);
    fixture.runtime.runs[0]!.settle('completed'); await new Promise(resolve => setImmediate(resolve));
    await fixture.team.runner.reset(fixture.workspaceId);
    const gone = await send(server, `${base}/attachments/${image.id}`); assert.equal(gone.statusCode, 404); await text(gone);
  } finally { server.closeAllConnections(); }
}));


test('context inspection routes are read-only, scoped, paged and independent of execution state', () => withServer(async (call, fixture) => {
  const base = `/workspaces/${fixture.workspaceId}`;
  const created = await worker(fixture, 'Inspector');
  const entry = { messageId: 'retained', message: { role: 'user', content: 'Retained context', timestamp: 1 }, metadata: { source: 'group-chat', marker: 'exact' } };
  const reads: { agentId: string; input: unknown }[] = [];
  Object.assign(fixture.runtime, { inspectContext: async (agentId: string, options: Parameters<typeof contextPageInput>[0]) => {
    const input = contextPageInput(options); reads.push({ agentId, input });
    return { revision: 7, offset: input.offset, total: 1, nextOffset: null, entries: [entry] };
  } });
  const member = await call(`${base}/members/${created.memberId}/context?limit=1`);
  assert.deepEqual(member, { revision: 7, offset: 0, total: 1, nextOffset: null, entries: [entry] });
  assert.equal(reads[0]!.agentId, created.memberId);
  await call(`${base}/members/${created.memberId}/context?offset=1&revision=7`);
  assert.deepEqual(reads[1]!.input, { offset: 1, limit: 50, revision: 7 });
  assert.deepEqual(await call(`${base}/chat/context`), { revision: 0, offset: 0, total: 0, nextOffset: null, entries: [] });
  for (const suffix of ['limit=0', 'limit=101', 'offset=1', 'offset=-1', 'revision=abc', 'limit=1&limit=2', 'unknown=1']) {
    await call(`${base}/members/${created.memberId}/context?${suffix}`, { status: 400 });
    await call(`${base}/chat/context?${suffix}`, { status: 400 });
  }
  for (const suffix of [`members/${created.memberId}/context`, 'chat/context']) {
    for (const method of ['POST', 'PUT', 'DELETE']) await call(`${base}/${suffix}`, { method, status: 404 });
    await call(`${base}/${suffix}/extra`, { status: 404 });
  }
  const before = reads.length;
  await call(`/workspaces/other/members/${created.memberId}/context`, { status: 404 });
  await call('/workspaces/other/chat/context', { status: 404 });
  await call(`${base}/members/missing/context`, { status: 404 });
  await fixture.team.service.retire(fixture.workspaceId, created.memberId, created.revision);
  await call(`${base}/members/${created.memberId}/context`, { status: 404 });
  assert.equal(reads.length, before, 'scope failures never read another member context');
  assert.equal(fixture.runtime.runs.length, 0, 'inspection never starts work');
}));

test('group summary inspection returns saved text or null without starting maintenance', () => withServer(async (call, fixture) => {
  const path = `/workspaces/${fixture.workspaceId}/chat/summary`;
  assert.deepEqual(await call(path), { summary: null, retainedMessages: 30 });
  const summary = { revision: 2, from: 1, through: 8, analyzedThrough: 38, sourceDigest: 'a'.repeat(64), text: 'Accepted shared goals and remaining work', messageId: 'summary-2', time: 1 };
  let reads = 0;
  Object.assign(fixture.store, { readGroupSummary: async (workspaceId: string) => { reads++; assert.equal(workspaceId, fixture.workspaceId); return structuredClone(summary); } });
  assert.deepEqual(await call(path), { summary, retainedMessages: 30 });
  assert.equal(reads, 1);
  await call('/workspaces/missing/chat/summary', { status: 404 });
  assert.equal(reads, 1, 'scope is checked before reading the summary');
  for (const suffix of ['?unknown=1', '?revision=2', '?revision=2&revision=2']) await call(path + suffix, { status: 400 });
  for (const method of ['POST', 'PUT', 'DELETE']) await call(path, { method, status: 404 });
  await call(path + '/extra', { status: 404 });
  await call(`/workspaces/${fixture.workspaceId}/chat/semantic-index`, { status: 404 });
  assert.equal(reads, 1, 'invalid requests never read the summary');
  assert.equal(fixture.runtime.runs.length, 0, 'inspection starts no member run');
}));

test('REST workspace resources expose lightweight member metadata and keep chat/context inspection separate', () => withServer(async (call, fixture) => {
  const workerView = await worker(fixture, 'Builder', ['backend']);
  const retired = await worker(fixture, 'Retired');
  await fixture.team.service.retire(fixture.workspaceId, retired.memberId, retired.revision);
  const fail = async () => { throw new Error('Heavy inspection must not run for metadata reads'); };
  fixture.team.designs.working = fail;
  fixture.team.designs.read = fail;
  fixture.team.service.issues = fail;
  const workspace = await call(`/workspaces/${fixture.workspaceId}`);
  assert.equal(workspace.workspaceId, fixture.workspaceId);
  assert.equal('context' in workspace, false);
  const base = `/workspaces/${fixture.workspaceId}/members`;
  const result = await call(base);
  assert.deepEqual(result.members.map((m:Body)=>m.name), ['Lead','Builder']);
  const builder = await call(`${base}/${workerView.memberId}`);
  assert.equal(builder.running,false);
  assert.equal(builder.responsibility, workerView.responsibility);
  assert.equal('harness' in builder,false);assert.equal('settings' in builder,false);
  assert.equal('ready' in builder,false);assert.equal('issues' in builder,false);
  await call('/workspaces/missing/members',{status:404});
  await call(`${base}?details=1`,{status:400});
  await call(`${base}/extra`,{status:404});
  await call(`${base}/${workerView.memberId}/harness`,{status:404});
  await call(`/workspaces/${fixture.workspaceId}/team/roster`,{status:404});
  await call(`/workspaces/${fixture.workspaceId}/team/members/${workerView.memberId}`,{status:404});
  await call(`/workspaces/${fixture.workspaceId}/team/chat`,{status:404});
  assert.equal(fixture.runtime.runs.length,0);
}));

test('retired Git approval endpoints are unavailable',()=>withServer(async(call,f)=>{
 const base=`/workspaces/${f.workspaceId}/team/commit-approvals`;
 await call(base,{status:404}); await call(`${base}/anything`,{status:404});
}));
