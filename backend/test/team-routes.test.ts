import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { duplexPair } from 'node:stream';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';
import { createAgentServer } from '../src/http.js';
import type { AgentRuntime } from '../src/runtime.js';
import { stubConfig, withTeam, type Fixture } from './team-fixture.js';

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

  const created = await call(`${base}/members`, { method: 'POST', status: 201, data: { name: 'Backend', role: 'backend developer', scope: ['agent/systems/backend'] } });
  assert.deepEqual([created.name, created.scope, created.ready, created.running, created.revision], ['Backend', ['agent/systems/backend'], true, false, 0]);
  assert.equal((await call(`${base}/members/${created.memberId}`)).name, 'Backend');
  await fixture.team.runner.startUser(fixture.lead.memberId, 'go');
  assert.deepEqual((await call(base)).members.map((member: Body) => member.running), [true, false]);
  fixture.runtime.end(fixture.lead.memberId);

  const changed = await call(`${base}/members/${created.memberId}`, { method: 'PUT', data: { revision: 0, value: { name: 'Backend', role: 'api developer', responsibility: 'The API', scope: [], settings: created.settings } } });
  assert.deepEqual([changed.role, changed.revision, changed.running], ['api developer', 1, false]);
  assert.equal((await call(`${base}/members/${created.memberId}`, { method: 'PUT', status: 409, data: { revision: 0, value: { name: 'Backend', role: 'x', responsibility: '', scope: [], settings: created.settings } } })).error.code, 'config_conflict');
  assert.equal((await call(`${base}/members`, { method: 'POST', status: 409, data: { name: 'backend', role: 'x' } })).error.code, 'member_exists');
  assert.equal((await call(`${base}/members`, { method: 'POST', status: 400, data: { name: 'X', role: 'x', surprise: 1 } })).error.code, 'invalid_input');

  assert.equal((await call(`${base}/members/${fixture.lead.memberId}`, { method: 'DELETE', status: 409, data: { revision: fixture.lead.revision } })).error.code, 'lead_required');
  assert.deepEqual(await call(`${base}/members/${created.memberId}`, { method: 'DELETE', data: { revision: 1 } }), { retired: created.memberId });
  await call(`${base}/members/${created.memberId}`, { status: 404 });
  await call(`/workspaces/missing/team`, { status: 404 });
  await call(`${base}/other`, { status: 404 });
}));

test('only the lead takes the user\'s input, and members are not in the agent list', () => withServer(async (call, fixture) => {
  const worker = await call(`/workspaces/${fixture.workspaceId}/team/members`, { method: 'POST', status: 201, data: { name: 'Backend', role: 'developer' } });
  const accepted = await call(`/agents/${fixture.lead.memberId}/runs`, { method: 'POST', status: 202, data: { input: 'Build a reading list' } });
  assert.equal(accepted.runId, 'run1');
  assert.equal(fixture.runtime.last(fixture.lead.memberId)?.input, 'Build a reading list');
  assert.equal((await call(`/agents/${fixture.lead.memberId}/runs`, { method: 'POST', status: 409, data: { input: 'again' } })).error.code, 'agent_busy');
  assert.equal((await call(`/agents/${worker.memberId}/runs`, { method: 'POST', status: 409, data: { input: 'hello' } })).error.code, 'member_conversation');
  assert.equal(fixture.runtime.last(worker.memberId), undefined);
}));
