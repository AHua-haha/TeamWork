import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { duplexPair } from 'node:stream';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';
import { join } from 'node:path';
import { createAgentServer } from '../src/http.js';
import type { AgentRuntime } from '../src/runtime.js';
import { emptyHarness } from '../src/harness-config.js';
import { stubConfig, withTeam, worker, type Fixture } from './team-fixture.js';

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

test('the team is viewed, formed, changed, and retired over HTTP', () => withServer(async (call, fixture) => {
  const base = `/workspaces/${fixture.workspaceId}/team`;
  const team = await call(base);
  assert.deepEqual(team.members.map((member: Body) => [member.name, member.lead, member.ready, member.running]), [['Lead', true, true, false]]);

  const created = await call(`${base}/members`, { method: 'POST', status: 201, data: { name: 'Backend', role: 'backend developer', harness: emptyHarness() } });
  assert.deepEqual([created.name, created.harness, created.ready, created.running, created.revision], ['Backend', emptyHarness(), false, false, 0]);
  assert.equal((await call(`${base}/members/${created.memberId}`)).name, 'Backend');
  await fixture.team.runner.postUser(fixture.workspaceId, 'go');
  assert.deepEqual((await call(base)).members.map((member: Body) => member.running), [true, false]);
  fixture.runtime.end(fixture.lead.memberId);

  const changed = await call(`${base}/members/${created.memberId}`, { method: 'PUT', data: { revision: 0, value: { name: 'Backend', role: 'api developer', responsibility: 'The API', harness: emptyHarness(), settings: created.settings } } });
  assert.deepEqual([changed.role, changed.revision, changed.running], ['api developer', 1, false]);
  assert.equal((await call(`${base}/members/${created.memberId}`, { method: 'PUT', status: 409, data: { revision: 0, value: { name: 'Backend', role: 'x', responsibility: '', harness: emptyHarness(), settings: created.settings } } })).error.code, 'config_conflict');
  assert.equal((await call(`${base}/members`, { method: 'POST', status: 409, data: { name: 'backend', role: 'x' } })).error.code, 'member_exists');
  assert.equal((await call(`${base}/members`, { method: 'POST', status: 400, data: { name: 'X', role: 'x', surprise: 1 } })).error.code, 'invalid_input');

  assert.equal((await call(`${base}/members/${fixture.lead.memberId}`, { method: 'DELETE', status: 409, data: { revision: fixture.lead.revision } })).error.code, 'lead_required');
  assert.deepEqual(await call(`${base}/members/${created.memberId}`, { method: 'DELETE', data: { revision: 1 } }), { retired: created.memberId });
  await call(`${base}/members/${created.memberId}`, { status: 404 });
  await call(`/workspaces/missing/team`, { status: 404 });
  await call(`${base}/other`, { status: 404 });
}));

test('workspace input goes to group chat; direct member input is refused', () => withServer(async (call, fixture) => {
  const worker = await call(`/workspaces/${fixture.workspaceId}/team/members`, { method: 'POST', status: 201, data: { name: 'Backend', role: 'developer' } });
  for (const id of [fixture.lead.memberId, worker.memberId]) assert.equal((await call(`/agents/${id}/runs`, { method: 'POST', status: 409, data: { input: 'hello' } })).error.code, 'member_conversation');
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
  const member = await worker(fixture, 'Backend', ['src']);
  const endpoint = `/workspaces/${fixture.workspaceId}/team/members/${member.memberId}/harness`;
  const files = await fixture.team.harness.files(member.memberId);
  const path = join(files.root, '.context', member.harness.designScope.working[0]!);
  await files.write.writeFile(path, JSON.stringify({ content: 'Pending', implementation: ['src'] }));
  const review = await call(endpoint);
  const design = review.parts.find((p: Body) => p.state.part.id === 'design');
  const implementation = review.parts.find((p: Body) => p.state.part.id === 'implementation');
  assert.match(design.diff, /Pending/);
  assert.equal(design.state.part.commit, 'user');
  const input = { revision: design.revision, base: design.state.committed, message: 'Accept design' };
  await call(endpoint + '/design/commit', { method: 'POST', data: { ...input, actor: 'user' }, status: 400 });
  await files.write.writeFile(path, JSON.stringify({ content: 'Changed after review', implementation: ['src'] }));
  const stale = await call(endpoint + '/design/commit', { method: 'POST', data: input, status: 409 });
  assert.equal(stale.error.code, 'stale_revision');
  const updated = (await call(endpoint)).parts.find((p: Body) => p.state.part.id === 'design');
  const approval = { ...input, revision: updated.revision };
  const run = await fixture.team.runner.postUser(fixture.workspaceId, '@Backend work');
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
