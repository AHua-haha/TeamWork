import { app, BrowserWindow, ipcMain, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDesktopConfig } from './config.js';

app.setName('RSI Agent');
const frontendDist = app.isPackaged ? path.join(process.resourcesPath, 'frontend-dist') : path.resolve(__dirname, '../../../frontend/dist');
const apiBase = 'teamwork://app/api/';
protocol.registerSchemesAsPrivileged([{ scheme: 'teamwork', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

function configPath(): string { return path.join(app.getPath('userData'), 'desktop.json'); }
async function readBackendOrigin(): Promise<string> {
  let raw: string;
  try { raw = await readFile(configPath(), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Desktop configuration is missing. Create ${configPath()} with { "backendOrigin": "http://127.0.0.1:<backend-port>" }.`);
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(`Desktop configuration at ${configPath()} is not valid JSON.`); }
  return parseDesktopConfig(value).backendOrigin;
}
function trustedSender(event: Electron.IpcMainEvent): boolean { return event.senderFrame?.url.startsWith('teamwork://app/') === true; }
function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280, height: 850, minWidth: 760, minHeight: 600,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { const target = new URL(url); if (target.protocol === 'https:' && ['github.com', 'docs.rs'].includes(target.hostname)) void shell.openExternal(target.href); }
    catch { /* reject malformed URLs */ }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('teamwork://app/')) event.preventDefault(); });
  void window.loadURL('teamwork://app/index.html');
}

ipcMain.on('desktop:get-api-base', event => { event.returnValue = trustedSender(event) ? apiBase : null; });

app.whenReady().then(async () => {
  let configuredOrigin: string;
  try { configuredOrigin = await readBackendOrigin(); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read desktop configuration.';
    const html = `<!doctype html><meta charset="utf-8"><title>Desktop configuration required</title><main style="font:16px system-ui;max-width:720px;margin:12vh auto"><h1>Desktop configuration required</h1><p>${escapeHtml(message)}</p><p>The backend is not launched by this app. Start it separately, configure its origin, then restart Desktop.</p></main>`;
    await protocol.handle('teamwork', async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } }));
    createWindow();
    return;
  }

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', event => event.preventDefault());
  });
  await protocol.handle('teamwork', async request => {
    const url = new URL(request.url);
    if (url.host !== 'app' || url.protocol !== 'teamwork:') return new Response('Not found', { status: 404 });
    if (url.pathname.startsWith('/api/')) {
      const apiPath = url.pathname.slice('/api'.length);
      if (!/^\/(agents|config|workspaces)(\/|$)/.test(apiPath)) return new Response('Not found', { status: 404 });
      const target = new URL(`${apiPath}${url.search}`, `${configuredOrigin}/`);
      try {
        const headers = new Headers(request.headers);
        headers.delete('host');
        headers.delete('origin');
        const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
        const upstream = await fetch(target, { method: request.method, headers, ...(body !== undefined ? { body } : {}) });
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
        responseHeaders.delete('transfer-encoding');
        responseHeaders.delete('access-control-allow-origin');
        return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
      } catch {
        return Response.json({ error: { code: 'backend_unreachable', message: `Unable to connect to configured backend at ${configuredOrigin}` } }, { status: 503 });
      }
    }
    let requested: string;
    try { requested = decodeURIComponent(url.pathname); } catch { return new Response('Not found', { status: 404 }); }
    const file = path.resolve(frontendDist, `.${requested === '/' ? '/index.html' : requested}`);
    if (!file.startsWith(frontendDist + path.sep) && file !== path.join(frontendDist, 'index.html')) return new Response('Not found', { status: 404 });
    try {
      const bytes = await readFile(file);
      const mime = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
      return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'content-type': mime, 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: teamwork:; connect-src 'self' teamwork:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" } });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response('Not found', { status: 404 });
      return new Response('Unable to load application asset', { status: 500 });
    }
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
