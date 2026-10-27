import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, request as proxyRequest } from 'node:http';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const inside = (root, path) => { const part = relative(root, path); return !part.startsWith('..') && !isAbsolute(part); };
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
function headers(input) {
  const connection = String(input.connection ?? '').toLowerCase().split(',').map(value => value.trim());
  return Object.fromEntries(Object.entries(input).filter(([key]) => !hopHeaders.has(key.toLowerCase()) && !connection.includes(key.toLowerCase())));
}

/** Built assets and a streaming same-origin proxy; no development server or response accumulation. */
export async function createFrontendServer(directory, backendOrigin) {
  const root = await realpath(directory), backend = new URL(backendOrigin);
  if (backend.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(backend.hostname)) throw new Error('Frontend backend origin must be loopback HTTP');
  await stat(join(root, 'index.html'));
  return createServer(async (request, response) => {
    const fail = (status, message) => { if (response.destroyed) return; if (response.headersSent) { response.destroy(); return; } response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); response.end(message); };
    try {
      const url = new URL(request.url, 'http://localhost');
      if (/^\/(agents|config|workspaces)(\/|$)/.test(url.pathname)) {
        const upstream = proxyRequest(new URL(url.pathname + url.search, backend), { method: request.method, headers: { ...headers(request.headers), host: backend.host } });
        upstream.on('response', result => {
          response.writeHead(result.statusCode ?? 502, headers(result.headers)); response.flushHeaders();
          result.on('error', () => response.destroy()); result.pipe(response);
        });
        upstream.on('error', () => fail(502, 'Backend is unavailable'));
        request.on('error', () => upstream.destroy()); request.on('aborted', () => upstream.destroy()); response.on('close', () => upstream.destroy());
        request.pipe(upstream); return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { fail(405, 'Method not allowed'); return; }
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { fail(400, 'Invalid path'); return; }
      if (path.includes('\0') || path.split('/').some(part => part.startsWith('.'))) { fail(404, 'Not found'); return; }
      let file = resolve(root, '.' + path);
      if (!inside(root, file)) { fail(404, 'Not found'); return; }
      try {
        let info = await stat(file);
        if (info.isDirectory()) file = join(file, 'index.html');
        file = await realpath(file);
        if (!inside(root, file)) { fail(404, 'Not found'); return; }
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        if (extname(path) || !String(request.headers.accept ?? '').includes('text/html')) { fail(404, 'Not found'); return; }
        file = join(root, 'index.html');
      }
      const info = await stat(file);
      if (!info.isFile()) { fail(404, 'Not found'); return; }
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      if (request.method === 'HEAD') response.end();
      else { const stream = createReadStream(file); stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response); }
    } catch { fail(500, 'Frontend serving failed'); }
  });
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid frontend PORT');
    const server = await createFrontendServer(process.env.FRONTEND_DIST, process.env.AGENT_BACKEND_ORIGIN);
    server.listen(port, '127.0.0.1', () => console.log(`Deployed frontend: http://127.0.0.1:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
