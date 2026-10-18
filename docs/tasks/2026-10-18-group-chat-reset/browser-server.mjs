// Controlled UI fixture; MySQL/runtime behavior is covered separately by integration tests.
import { createServer } from 'node:http';
const workspaceId = 'reset-review', time = Date.now(), clients = new Set();
let cursor = 3, resetCursor = 0, resetPosition = 0, position = 2, failNext = false, resets = 0;
const run = { agentId: 'lead', runId: 'old-run', status: 'completed', phase: 'finished', step: 1, startedAt: time - 1000, endedAt: time, endPosition: 1, activeMessageId: null, error: null };
const user = { workspaceId, entryId: 'old-user', position: 1, revision: 1, exchangeId: 'old-exchange', time, kind: 'user', messageId: 'old-user', text: 'Old test message' };
const member = { workspaceId, entryId: 'old-run', position: 2, revision: 3, exchangeId: 'old-exchange', time, kind: 'member', memberId: 'lead', name: 'Lead', run, working: { after: 0, through: 1 }, finalRef: { agentId: 'lead', runId: 'old-run', messageId: 'old-final', position: 1, contentIndices: [0], bodyOffset: 0 }, text: 'Old completed response' };
let changes = [{ cursor: 1, entry: user }, { cursor: 2, entry: { ...member, revision: 2, run: { ...run, status: 'running', phase: 'model', endedAt: null, endPosition: null }, finalRef: null, text: null, working: { after: 0, through: null } } }, { cursor: 3, entry: member }];
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const event = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ version: 1, workspaceId, type, ...data })}\n\n`);
const emit = (type, data) => { for (const res of clients) event(res, type, data); };
const roster = [{ memberId: 'lead', workspaceId, revision: 0, name: 'Lead', role: 'Lead', lead: true, responsibility: 'Maintain the project design', harness: { designScope: { working: [], dependencies: [] }, implementationScope: { paths: ['src'], usePaths: [] }, allowedCommands: [] }, settings: { connectionId: 'fixture', modelId: 'fixture', modelOptions: [], toolOptionIds: [], promptOptionIds: [], prompt: '' }, ready: true, issues: [], running: false }];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'), path = url.pathname;
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (path === '/agents/lead/follow') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const base = { version: 1, agentId: 'lead', runId: 'old-run' };
    if (Number(url.searchParams.get('after') || 0) < 1) {
      const record = { agentId: 'lead', runId: 'old-run', messageId: 'old-final', position: 1, metadata: {}, message: { role: 'assistant', content: [{ type: 'text', text: 'Old completed response' }], api: 'openai-responses', provider: 'openai', model: 'fixture', usage, stopReason: 'stop', timestamp: time } };
      res.write(`event: message\ndata: ${JSON.stringify({ ...base, type: 'message', record })}\n\n`);
    }
    for (const type of ['sync', 'end']) res.write(`event: ${type}\ndata: ${JSON.stringify({ ...base, type, historyPosition: 1, run })}\n\n`);
    res.end(); return;
  }
  if (path === '/config/app') return json({ id: 'settings', revision: 0, value: { title: 'RSI Agent', allowAgentCreation: true, maxInputBytes: 20000 } });
  if (path === '/config/connections' || path === '/agents') return json([]);
  if (path === '/workspaces') return json({ workspaces: [{ workspaceId, name: 'Reset review', directory: '/tmp/reset-review', createdAt: time }] });
  if (path === `/workspaces/${workspaceId}/team`) return json({ workspaceId, members: roster });
  if (path === '/workspaces/test-control') {
    let raw = ''; for await (const part of req) raw += part;
    const input = JSON.parse(raw || '{}');
    if (input.action === 'fail-next') failNext = true;
    return json({ resets, cursor, resetCursor, entries: changes.length });
  }
  if (path === `/workspaces/${workspaceId}/team/chat/reset` && req.method === 'POST') {
    if (failNext) { failNext = false; return json({ error: { code: 'workspace_busy', message: 'Wait for team finalization before resetting' } }, 409); }
    cursor++; resetCursor = cursor; resetPosition++; resets++; changes = [];
    emit('reset', { cursor }); emit('sync', { cursor });
    return json({ workspaceId, resetCursor, resetPosition });
  }
  if (path === `/workspaces/${workspaceId}/team/chat/messages` && req.method === 'POST') {
    let raw = ''; for await (const part of req) raw += part;
    const { text } = JSON.parse(raw); cursor++; position++;
    const entry = { ...user, text, entryId: `user-${cursor}`, messageId: `user-${cursor}`, revision: cursor, position, time: Date.now() };
    const change = { cursor, entry }; changes.push(change); emit('entry', { change });
    return json({ entries: [entry] }, 202);
  }
  if (path === `/workspaces/${workspaceId}/team/chat/timeline-follow`) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); clients.add(res);
    const after = Number(url.searchParams.get('after') || 0);
    if (after < resetCursor) event(res, 'reset', { cursor: resetCursor });
    for (const change of changes.filter(change => change.cursor > Math.max(after, resetCursor))) event(res, 'entry', { change });
    event(res, 'sync', { cursor });
    req.on('close', () => clients.delete(res)); return;
  }
  return json({ error: { code: 'not_found', message: `Unexpected fixture request: ${req.method} ${path}` } }, 404);
});
server.listen(4279, '127.0.0.1', () => console.log('Reset UI fixture on 127.0.0.1:4279'));
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(); });
