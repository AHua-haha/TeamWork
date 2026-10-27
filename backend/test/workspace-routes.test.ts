import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { join } from 'node:path';
import { duplexPair } from 'node:stream';
import { text } from 'node:stream/consumers';
import { test } from 'node:test';
import type { ConfigService } from '../src/core/team/data/config.js';
import { createAgentServer } from '../src/api/http.js';
import type { AgentRuntime } from '../src/core/agent/runtime.js';
import type { TeamSystem } from '../src/core/team/team-system.js';
import { WorkspaceService } from '../src/core/workspace/workspace.js';
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

test('workspace metadata is lightweight and legacy project browsing endpoints are removed', () => withServer(async (call, _server, folder) => {
  const directory = join(folder, 'project');
  await call('/workspaces', { method: 'POST', data: { workspaceId: 'demo', name: 'Demo', directory, models: testModels(), adopt: false }, status: 201 });
  assert.deepEqual((await call('/workspaces')).workspaces.map((item: Body) => item.workspaceId), ['demo']);
  const workspace = await call('/workspaces/demo');
  assert.equal(workspace.name, 'Demo');
  assert.equal(workspace.workspaceId, 'demo');
  assert.equal('context' in workspace, false);
  assert.equal((await call('/workspaces/missing', { status: 404 })).error.code, 'not_found');
  assert.equal((await call('/workspaces/demo/unknown', { status: 404 })).error.code, 'not_found');
  for (const path of [
    '/workspaces/demo/files/tree', '/workspaces/demo/files/file?path=src/main.ts', '/workspaces/demo/files/find?q=main',
    '/workspaces/demo/designs', '/workspaces/demo/designs/file?path=design/metadata.json',
    '/workspaces/demo/context', '/workspaces/demo/context/tree', '/workspaces/demo/context/file?path=user/notes.md',
    '/workspaces/demo/context/history?path=user/notes.md', '/workspaces/demo/context/search?q=hello',
    '/workspaces/demo/context/changes', '/workspaces/demo/context/follow',
  ]) await call(path, { status: 404 });
  await call('/workspaces/demo/files/file?path=src/main.ts', { method: 'PUT', data: { content: 'main', baseRevision: null }, status: 404 });
  await call('/workspaces/demo/context/file?path=user/notes.md', { method: 'PUT', data: { content: 'main', baseRevision: null }, status: 404 });
}));

test('managed context documents and design browsing are internal, not public workspace inspection APIs', () => withServer(async (call, _server, folder) => {
  await call('/workspaces', { method: 'POST', data: { workspaceId: 'demo', name: 'Demo', directory: join(folder, 'project'), models: testModels(), adopt: false }, status: 201 });
  for (const path of [
    '/workspaces/demo/designs', '/workspaces/demo/designs/file?path=systems/backend/metadata.json',
    '/workspaces/demo/context', '/workspaces/demo/context/tree?path=design', '/workspaces/demo/context/file?path=user/notes.md',
    '/workspaces/demo/context/history?path=user/notes.md', '/workspaces/demo/context/find?q=notes',
    '/workspaces/demo/context/search?q=notes', '/workspaces/demo/context/changes', '/workspaces/demo/context/follow',
    '/workspaces/demo/context/move', '/workspaces/demo/context/delete',
  ]) await call(path, { status: 404 });
  await call('/workspaces/demo/context/file?path=user/notes.md', { method: 'PUT', data: { content: 'notes', baseRevision: null }, status: 404 });
  await call('/workspaces/demo/context/move', { method: 'POST', data: { from: 'user/a', to: 'user/b' }, status: 404 });
  await call('/workspaces/demo/context/delete', { method: 'POST', data: { path: 'user/a' }, status: 404 });
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

test('workspace initialization HTTP contract reviews metadata before explicitly confirmed cleanup', () => withServer(async (call, _server, folder) => {
  const directory=join(folder,'existing'), root=join(directory,'.rsi');
  await mkdir(join(root,'members'),{recursive:true});
  await writeFile(join(root,'members/old.json'),'old');
  await mkdir(join(root,'context/design'),{recursive:true});
  await writeFile(join(root,'context/design/design.md'),'# Retained');
  const review=await call('/workspaces/initialization',{method:'POST',data:{directory,adopt:true}});
  assert.deepEqual(review.cleanupPaths,['.rsi/members']); assert.ok(review.cleanupRevision);
  const input={name:'Existing',directory,adopt:true,models:testModels()};
  assert.equal((await call('/workspaces',{method:'POST',data:input,status:409})).error.code,'cleanup_required');
  assert.equal(await readFile(join(root,'members/old.json'),'utf8'),'old');
  await call('/workspaces',{method:'POST',data:{...input,cleanupRevision:true},status:400});
  await call('/workspaces/initialization',{method:'POST',data:{directory,adopt:true,cleanup:true},status:400});
  const created=await call('/workspaces',{method:'POST',data:{...input,cleanupRevision:review.cleanupRevision},status:201});
  assert.equal(created.context.seq,1);
  assert.equal(await readFile(join(root,'context/design/design.md'),'utf8'),'# Retained');
  await assert.rejects(stat(join(root,'members/old.json')));
  assert.equal((await call('/workspaces/initialization',{method:'POST',data:{directory,adopt:true},status:409})).error.code,'workspace_exists');
}));
