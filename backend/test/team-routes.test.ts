import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { duplexPair } from 'node:stream';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { createAgentServer } from '../src/http.js';
import type { AgentRuntime } from '../src/runtime.js';
import { emptyHarness } from '../src/harness-config.js';
import { stubConfig, withTeam, worker, configureHarness, type Fixture } from './team-fixture.js';

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

test('member inspection is read-only, returns accepted configuration and three harnesses without opening a worktree', () => withServer(async (call, fixture) => {
  const base = `/workspaces/${fixture.workspaceId}/team`;
  const created = await worker(fixture, 'Backend', ['backend']);
  const root = join(fixture.folder, '.rsi-harness');
  await assert.rejects(stat(root));
  const view = await call(`${base}/members/${created.memberId}`);
  assert.equal(view.member.name, 'Backend');
  assert.equal(JSON.parse(view.configuration.files['member.json']).name, 'Backend');
  assert.deepEqual(view.harnesses.map((h: Body) => h.id), ['management', 'implementation', 'execute']);
  assert.ok(!view.harnesses[0].parts.some((p: Body) => p.id === 'design'));
  assert.deepEqual(view.harnesses[0].tools,['ls','read']);
  await assert.rejects(stat(root), 'inspection creates no harness Git storage');
  const before = await fixture.team.service.find(created.memberId);
  for (const [method, path, data] of [
    ['POST', `${base}/members`, { name: 'Other', role: 'developer' }],
    ['PUT', `${base}/members/${created.memberId}`, { revision: created.revision, value: {} }],
    ['DELETE', `${base}/members/${created.memberId}`, { revision: created.revision }],
    ['GET', `${base}/members/${created.memberId}/config`, undefined],
  ] as const) await call(path, { method, data, status: 404 });
  assert.deepEqual(await fixture.team.service.find(created.memberId), before);
  await call(`/workspaces/other/team/members/${created.memberId}`, { status: 404 });
  const lead = await call(`${base}/members/${fixture.lead.memberId}`);
  assert.ok(lead.harnesses[0].tools.includes('bash'));
  assert.ok(!lead.harnesses[0].tools.includes('submit_member_config'));
  assert.equal(lead.harnesses[0].parts.find((p: Body) => p.id === 'member-config').commit, 'user');
  assert.deepEqual((await call(base)).members.map((m: Body) => m.name), ['Lead', 'Backend']);
}));

test('workspace input goes to group chat; direct member input is refused', () => withServer(async (call, fixture) => {
  const member = await worker(fixture, 'Backend');
  for (const id of [fixture.lead.memberId, member.memberId]) assert.equal((await call(`/agents/${id}/runs`, { method: 'POST', status: 409, data: { input: 'hello' } })).error.code, 'member_conversation');
  const base = `/workspaces/${fixture.workspaceId}/team/chat`;
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
  const base = `/workspaces/${fixture.workspaceId}/team/chat`;
  const accepted = await call(`${base}/messages`, { method: 'POST', data: { text: 'work' }, status: 202 });
  assert.deepEqual(accepted.entries.map((entry: { kind: string }) => entry.kind), ['user', 'member']);
  const page = await call(`${base}/timeline?after=0&limit=1`);
  assert.equal(page.changes.length, 1); assert.equal(page.more, true);
  const next = await call(`${base}/timeline?after=1`);
  assert.equal(next.changes[0].entry.position, 2);
}));

test('harness review and user commit endpoints pin the reviewed revision and enforce member boundaries', () => withServer(async (call, fixture) => {
  const backend = await worker(fixture, 'Backend', ['src']);
  await configureHarness(fixture,'Lead',{designScope:{working:backend.harness.designScope.working,dependencies:[]},allowedCommands:[]});
  const member = fixture.lead;
  const endpoint = `/workspaces/${fixture.workspaceId}/team/members/${member.memberId}/harness`;
  const files = await fixture.team.harness.files(member.memberId);
  const path = join(files.root, '.rsi/context/design/design.md');
  await files.write.writeFile(path, 'Pending');
  const review = await call(endpoint);
  const design = review.parts.find((p: Body) => p.state.part.id === 'design');
  const implementation = review.parts.find((p: Body) => p.state.part.id === 'implementation');
  assert.match(design.diff, /Pending/);
  assert.equal(design.state.part.commit, 'user');
  const input = { revision: design.revision, base: design.state.committed, message: 'Accept design' };
  await call(endpoint + '/design/commit', { method: 'POST', data: { ...input, actor: 'user' }, status: 400 });
  await files.write.writeFile(path, 'Changed after review');
  const stale = await call(endpoint + '/design/commit', { method: 'POST', data: input, status: 409 });
  assert.equal(stale.error.code, 'stale_revision');
  const updated = (await call(endpoint)).parts.find((p: Body) => p.state.part.id === 'design');
  const approval = { ...input, revision: updated.revision };
  const run = await fixture.team.runner.postUser(fixture.workspaceId, '@Lead work');
  assert.equal((await call(endpoint + '/design/commit', { method: 'POST', data: approval, status: 409 })).error.code, 'member_busy');
  fixture.runtime.end(member.memberId);
  await fixture.runtime.finished(member.memberId, run.runs[0]!.runId);
  const accepted = await call(endpoint + '/design/commit', { method: 'POST', data: approval });
  assert.equal(accepted.actor.type, 'user');
  assert.equal(accepted.kind, 'commit');
  const current = await call(endpoint);
  assert.equal(current.parts.find((p: Body) => p.state.part.id === 'implementation').state.committed, implementation.state.committed);
  assert.ok((await call(endpoint + '/design/history')).history.some((r: Body) => r.revision === accepted.revision));
  await call(`/workspaces/missing/team/members/${member.memberId}/harness`, { status: 404 });
}));

test('configuration review and separate user activation enforce exact input and whole-workspace idle state', () => withServer(async (call, f) => {
  const member = await worker(f, 'Backend', ['src']);
  await f.team.configuration.materialize(f.lead.memberId);
  const source = await f.team.configuration.accepted(f.workspaceId, member.memberId), files = await f.team.harness.files(f.lead.memberId);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(files.root, source.path), JSON.stringify({ ...JSON.parse(source.files['member.json']!), responsibility: 'Validated update' }));
  const base = `/workspaces/${f.workspaceId}/team/configuration`;
  const pending = await call(base + '?source=pending'); assert.equal(pending.valid, true); assert.equal(pending.changes[0].type, 'update');
  await call(base + '?source=bad', {status:400});
  const review = (await call(`/workspaces/${f.workspaceId}/team/members/${f.lead.memberId}/harness`)).parts.find((p:Body) => p.state.part.id === 'member-config');
  await call(`/workspaces/${f.workspaceId}/team/members/${f.lead.memberId}/harness/member-config/commit`, {method:'POST',data:{revision:review.revision,base:review.state.committed,message:'Accept config'}});
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

test('current configuration endpoint supplies file diff and separate commit/activation operations', () => withServer(async (call, f) => {
  const base = `/workspaces/${f.workspaceId}/team/configuration`;
  const initial = await call(base + '/current');
  assert.equal(initial.status.hasPending,false); assert.equal(initial.activation.valid,true);
  const files = await f.team.harness.files(f.lead.memberId);
  await files.write.writeFile(join(files.root, '.rsi/members', f.lead.memberId, 'prompts/member.md'), 'Pending instructions');
  const current = await call(base + '/current');
  assert.ok(current.current.files.length); assert.equal(current.status.hasPending, true);
  assert.equal(current.activation.valid, true, 'bootstrap is the initial active baseline');
  await call(base+'/commit',{method:'POST',data:{...current.commit,message:'User accepts initial files',actor:'user'},status:400});
  await call(base+'/commit',{method:'POST',data:{...current.commit,message:'User accepts initial files'}});
  const accepted = await call(base+'/current'); assert.equal(accepted.status.hasPending,false); assert.equal(accepted.activation.valid,true);
  await call(base+'/activate',{method:'POST',data:{revision:accepted.activation.revision,digest:accepted.activation.digest}});
  const active = await call(base+'/current'); assert.equal(active.status.commits.length,0); assert.deepEqual(active.changes,[]);
  await call(base+'/current?source=pending',{status:400});
}));
