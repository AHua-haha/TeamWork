import assert from 'node:assert/strict';
import { realpath, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { join } from 'node:path';
import { duplexPair } from 'node:stream';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';
import type { ConfigService } from '../src/config.js';
import { createAgentServer } from '../src/http.js';
import type { AgentRuntime } from '../src/runtime.js';
import type { TeamSystem } from '../src/team-system.js';
import { WorkspaceService } from '../src/workspace.js';
import { testModels, testModelValidator, MemoryStore, withFolder } from './memory-store.js';

type Body = Record<string, any>;
type Call = (path: string, init?: { method?: string; data?: unknown; status?: number }) => Promise<Body>;

/** One request over an in-memory connection, so the test needs no network. */
function send(server: Server, path: string, method = 'GET', data?: unknown): Promise<IncomingMessage> {
  const [client, socket] = duplexPair();
  server.emit('connection', socket);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ path, method, createConnection: () => client, headers: data === undefined ? {} : { 'Content-Type': 'application/json' } }, resolve);
    request.on('error', reject);
    request.end(data === undefined ? undefined : JSON.stringify(data));
  });
}

/** The agent server with only its workspace routes in use, over a fresh store. */
function withServer(run: (call: Call, server: Server, folder: string) => Promise<void>): Promise<void> {
  return withFolder(async folder => {
    const service = new WorkspaceService(new MemoryStore(), testModelValidator);
    const server = createAgentServer({} as AgentRuntime, {} as ConfigService, service, {} as TeamSystem);
    const call: Call = async (path, { method = 'GET', data, status = 200 } = {}) => {
      const response = await send(server, path, method, data);
      const body = JSON.parse(await text(response)) as Body;
      assert.equal(response.statusCode, status, JSON.stringify(body));
      return body;
    };
    try { await run(call, server, await realpath(folder)); }
    finally {
      server.closeAllConnections();
      await service.close();
    }
  });
}

/** Server-sent events up to and including the first event of type `until`. */
async function events(response: IncomingMessage, until: string): Promise<{ type: string; data: Body }[]> {
  const parsed: { type: string; data: Body }[] = [];
  let buffer = '';
  for await (const chunk of response) {
    buffer += String(chunk);
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const [event, data] = buffer.slice(0, end).split('\n');
      buffer = buffer.slice(end + 2);
      if (!event!.startsWith('event: ')) continue;
      parsed.push({ type: event!.slice('event: '.length), data: JSON.parse(data!.slice('data: '.length)) as Body });
      if (parsed.at(-1)!.type === until) {
        response.destroy();
        return parsed;
      }
    }
  }
  return parsed;
}

test('workspace endpoints register workspaces and serve project files', () => withServer(async (call, _server, folder) => {
  const directory = join(folder, 'project');
  const created = await call('/workspaces', { method: 'POST', data: { workspaceId: 'demo', name: 'Demo', directory, models: testModels(), adopt: false }, status: 201 });
  assert.equal(created.directory, directory);
  assert.equal(created.context.seq, 0);
  assert.deepEqual((await call('/workspaces')).workspaces.map((item: Body) => item.workspaceId), ['demo']);
  assert.equal((await call('/workspaces/demo')).name, 'Demo');
  assert.equal((await call('/workspaces', { method: 'POST', data: { workspaceId: 'again', name: 'Again', directory, models: testModels(), adopt: true }, status: 409 })).error.code, 'workspace_exists');
  assert.equal((await call('/workspaces', { method: 'POST', data: { name: 'Extra', directory: join(folder, 'other'), models: testModels(), adopt: false, color: 'red' }, status: 400 })).error.code, 'invalid_input');
  assert.equal((await call('/workspaces/missing', { status: 404 })).error.code, 'not_found');
  assert.equal((await call('/workspaces/demo/unknown', { status: 404 })).error.code, 'not_found');

  const saved = await call('/workspaces/demo/files/file?path=src/main.ts', { method: 'PUT', data: { content: 'main', baseRevision: null }, status: 201 });
  assert.equal(saved.path, 'src/main.ts');
  assert.deepEqual(await call('/workspaces/demo/files/file?path=src/main.ts', { method: 'PUT', data: { content: 'next', baseRevision: saved.revision } }), { path: 'src/main.ts', revision: (await call('/workspaces/demo/files/file?path=src/main.ts')).revision });
  assert.equal((await call('/workspaces/demo/files/file?path=src/main.ts', { method: 'PUT', data: { content: 'late', baseRevision: saved.revision }, status: 409 })).error.code, 'stale_revision');
  assert.equal((await call('/workspaces/demo/files/file?path=src/main.ts', { method: 'PUT', data: { content: 'x' }, status: 400 })).error.code, 'invalid_input');
  await writeFile(join(directory, 'image.bin'), Buffer.from([0xff, 0xfe, 0x00]));
  assert.equal((await call('/workspaces/demo/files/file?path=image.bin', { status: 415 })).error.code, 'unsupported_file');
  assert.equal((await call('/workspaces/demo/files/file?path=.context/user', { status: 400 })).error.code, 'invalid_path');
  assert.deepEqual((await call('/workspaces/demo/files/tree?depth=2')).entries.map((entry: Body) => entry.path), ['image.bin', 'src', 'src/main.ts']);
  assert.equal((await call('/workspaces/demo/files/tree?depth=0', { status: 400 })).error.code, 'invalid_input');
  assert.equal((await call('/workspaces/demo/files/tree?deep=1', { status: 400 })).error.code, 'invalid_input');
  assert.deepEqual((await call('/workspaces/demo/files/find?q=MAIN')).paths, ['src/main.ts']);
}));

test('workspace endpoints edit the context base and stream its changes', () => withServer(async (call, server, folder) => {
  await call('/workspaces', { method: 'POST', data: { workspaceId: 'demo', name: 'Demo', directory: join(folder, 'project'), models: testModels(), adopt: false }, status: 201 });
  const created = await call('/workspaces/demo/context/file?path=user/notes/a.md', { method: 'PUT', data: { content: '# A\nalpha', baseRevision: null, reason: 'start' }, status: 201 });
  assert.equal(created.seq, 1);
  assert.equal((await call('/workspaces/demo/context/file?path=agent/plan.md', { method: 'PUT', data: { content: 'x', baseRevision: null }, status: 403 })).error.code, 'read_only');
  assert.equal((await call('/workspaces/demo/context/file?path=user/notes/a.md', { method: 'PUT', data: { content: 'late', baseRevision: null }, status: 409 })).error.code, 'file_exists');
  const read = await call('/workspaces/demo/context/file?path=user/notes/a.md');
  assert.deepEqual([read.content, read.revision, read.current, read.reason], ['# A\nalpha', created.revision, true, 'start']);
  assert.equal((await call(`/workspaces/demo/context/file?path=user/notes/a.md&revision=${created.revision}`, { status: 400 })).error.code, 'invalid_input');

  const moved = await call('/workspaces/demo/context/move', { method: 'POST', data: { from: 'user/notes', to: 'user/archive', reason: 'tidy' } });
  assert.deepEqual(moved.moved.map((item: Body) => [item.from, item.to]), [['user/notes/a.md', 'user/archive/a.md']]);
  assert.equal(moved.seq, 2);
  assert.deepEqual((await call('/workspaces/demo/context/tree?path=user&depth=2')).entries.map((entry: Body) => entry.path), ['user/archive', 'user/archive/a.md']);
  assert.deepEqual((await call('/workspaces/demo/context/find?q=a.md')).paths, ['user/archive/a.md']);
  assert.deepEqual((await call('/workspaces/demo/context/search?q=ALPHA')).matches, [{ path: 'user/archive/a.md', line: 2, text: 'alpha' }]);
  const history = await call('/workspaces/demo/context/history?path=user/archive/a.md&limit=1');
  assert.deepEqual([history.versions.map((version: Body) => version.action), history.next], [['move'], 2]);
  assert.equal((await call(`/workspaces/demo/context/file?revision=${created.revision}`)).current, false);
  assert.deepEqual((await call('/workspaces/demo/context/delete', { method: 'POST', data: { path: 'user/archive/a.md', baseRevision: moved.moved[0].revision } })).deleted, ['user/archive/a.md']);
  assert.equal((await call('/workspaces/demo/context')).seq, 3);

  const changes = await call('/workspaces/demo/context/changes?after=1&limit=1');
  assert.deepEqual([changes.records.map((record: Body) => record.seq), changes.seq, changes.more], [[2], 3, true]);
  assert.equal((await call('/workspaces/demo/context/changes?after=-1', { status: 400 })).error.code, 'invalid_input');
  assert.equal((await call('/workspaces/demo/context/follow?after=9', { status: 409 })).error.code, 'invalid_cursor');
  const response = await send(server, '/workspaces/demo/context/follow?after=1');
  assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.deepEqual((await events(response, 'sync')).map(event => [event.type, event.data.workspaceId, event.data.record?.seq ?? event.data.seq]), [['record', 'demo', 2], ['record', 'demo', 3], ['sync', 'demo', 3]]);
}));

test('workspace model endpoints support validated revision-checked settings and require models on creation', () => withServer(async (call, _server, folder) => {
  await call('/workspaces', { method: 'POST', data: { name: 'No models', directory: join(folder, 'none'), adopt: false }, status: 400 });
  const created = await call('/workspaces', { method: 'POST', data: { name: 'Models', directory: join(folder, 'models'), adopt: false, models: testModels() }, status: 201 });
  const endpoint = `/workspaces/${created.workspaceId}/models`;
  const initial = await call(endpoint);
  assert.deepEqual(initial.value, testModels());
  const changed = await call(endpoint, { method: 'PUT', data: { revision: initial.revision, value: testModels('conn', 'next') } });
  assert.equal(changed.revision, initial.revision + 1);
  await call(endpoint, { method: 'PUT', data: { revision: initial.revision, value: testModels() }, status: 409 });
  await call(endpoint, { method: 'PUT', data: { revision: changed.revision, value: { ...testModels(), defaultModel: null } }, status: 400 });
  assert.deepEqual(await call(endpoint), changed);
}));

test('read-only design endpoints discover current designs and explain invalid member references', () => withServer(async (call, _server, folder) => {
  await call('/workspaces', { method: 'POST', data: { workspaceId: 'designs', name: 'Designs', directory: join(folder, 'designs'), models: testModels(), adopt: false }, status: 201 });
  const record = { content: '# Backend', implementation: ['backend/src'] };
  await call('/workspaces/designs/context/file?path=user/design/backend.json', { method: 'PUT', status: 201, data: { content: JSON.stringify(record), baseRevision: null } });
  await call('/workspaces/designs/context/file?path=user/notes.md', { method: 'PUT', status: 201, data: { content: '# Notes', baseRevision: null } });
  await call('/workspaces/designs/context/file?path=user/bad.json', { method: 'PUT', status: 201, data: { content: '{"content":"Bad"}', baseRevision: null } });
  const catalog = await call('/workspaces/designs/designs');
  assert.equal(catalog.truncated, false);
  assert.deepEqual(catalog.designs.map((item: Body) => [item.path, item.implementation]), [['user/design/backend.json', ['backend/src']]]);
  const selected = await call('/workspaces/designs/designs/file?path=user/design/backend.json');
  assert.deepEqual(selected.design, record);
  assert.equal(selected.designIssue, null);
  assert.equal((await call('/workspaces/designs/designs/file?path=user/bad.json')).design, null);
  assert.ok((await call('/workspaces/designs/designs/file?path=user/bad.json')).designIssue);
  await call('/workspaces/designs/designs/file?path=user/missing.json', { status: 404 });
  await call('/workspaces/designs/designs/file?path=agent/design.json', { status: 403 });
  await call('/workspaces/designs/designs/file?path=user/design/backend.json&revision=older', { status: 400 });
  await call('/workspaces/designs/designs', { method: 'POST', data: record, status: 404 });
  await call('/workspaces/missing/designs', { status: 404 });
}));
