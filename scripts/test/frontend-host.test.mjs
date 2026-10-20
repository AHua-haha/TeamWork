import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFrontendServer } from '../serve-frontend.mjs';
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };

test('host frontend serves built assets and streams API, binary uploads and SSE with cancellation', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'rsi-static-test-')), directory = join(parent, 'public');
  await mkdir(directory);
  let frontend, upstream; let cancelled;
  const disconnected = new Promise(resolve => { cancelled = resolve; });
  try {
    await writeFile(join(directory, 'index.html'), '<h1>Built application</h1>');
    await mkdir(join(directory, 'assets')); await writeFile(join(directory, 'assets/app.js'), 'console.log("built")');
    await writeFile(join(directory, '.env'), 'SECRET');
    await writeFile(join(directory, '../outside-secret.txt'), 'DO NOT SERVE');
    await symlink(join(directory, '../outside-secret.txt'), join(directory, 'assets/link.txt'));
    upstream = createServer((req, res) => {
      if (req.url === '/agents/live') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('event: text\ndata: first\n\n'); req.on('close', cancelled); return; }
      if (req.url === '/config/app') { res.setHeader('Content-Type', 'application/json'); res.end('{"title":"Deployment"}'); return; }
      if (req.url === '/workspaces/picture') { req.pipe(res); return; }
      res.writeHead(404); res.end('Backend 404');
    });
    const backendUrl = await listen(upstream);
    frontend = await createFrontendServer(directory, backendUrl); const url = await listen(frontend);
    assert.match(await (await fetch(url)).text(), /Built application/);
    const js = await fetch(url + '/assets/app.js'); assert.match(js.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(url + '/missing.js')).status, 404);
    assert.equal((await fetch(url + '/page', { headers: { Accept: 'text/html' } })).status, 200);
    assert.equal((await fetch(url + '/assets/link.txt')).status, 404);
    assert.equal((await fetch(url + '/.env')).status, 404);
    assert.equal((await fetch(url + '/%00')).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(url, { method: 'HEAD' })).headers.get('content-length'), '26');
    assert.deepEqual(await (await fetch(url + '/config/app')).json(), { title: 'Deployment' });
    const bytes = Buffer.alloc(1024 * 1024 + 17, 127);
    assert.deepEqual(Buffer.from(await (await fetch(url + '/workspaces/picture', { method: 'POST', body: bytes })).arrayBuffer()), bytes);
    const controller = new AbortController();
    const stream = await fetch(url + '/agents/live', { signal: controller.signal });
    const reader = stream.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
    controller.abort(); await disconnected;
    await new Promise(resolve => upstream.close(resolve));
    assert.equal((await fetch(url + '/config/app')).status, 502);
  } finally {
    frontend?.closeAllConnections(); frontend?.close(); upstream?.closeAllConnections(); upstream?.close();
    await rm(parent, { recursive: true, force: true });
  }
});
