/** Controlled compact-SSE fixture: no provider calls, workspace files or SQL writes. */
import { createServer } from 'node:http';
const workspaceId = 'thinking-review', agentId = 'thinker', runId = 'thinking-run', startedAt = Date.now();
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const message = () => ({ role: 'assistant', content: [], api: 'openai-responses', provider: 'openai', model: 'fixture', usage, stopReason: 'pending', timestamp: startedAt });
let current = null, serial = 0, status = 'running', online = true, thinkingIndex = null;
const records = [], chunks = [], privateClients = new Set(), groupClients = new Set(), changes = [];
const run = () => ({ agentId, runId, status, phase: status === 'running' ? 'model' : 'finished', step: 1, startedAt, endedAt: status === 'running' ? null : Date.now(), endPosition: status === 'running' ? null : records.length, activeMessageId: current?.id ?? null, error: null });
const entry = { workspaceId, entryId: 'thinking-entry', position: 1, revision: 1, exchangeId: 'test-exchange', time: startedAt, kind: 'member', memberId: agentId, name: 'Lead', run: run(), working: { after: 0, through: null }, finalRef: null, text: null };
changes.push({ cursor: 1, entry: structuredClone(entry) });
const write = (res, type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
const emit = (type, value) => { for (const res of privateClients) write(res, type, { version: 2, agentId, runId, type, ...value }); };
const frame = event => { const chunk = { messageId: current.id, sequence: chunks.length, event }; chunks.push(chunk); emit('chunk', chunk); };
const begin = () => { if (!current) { current = { id: `message-${++serial}`, message: message() }; frame({ type: 'start', message: message() }); } };
function endThinking() {
  if (thinkingIndex !== null) { frame({ type: 'thinking_end', contentIndex: thinkingIndex, content: current.message.content[thinkingIndex].thinking }); thinkingIndex = null; }
}
function commit() {
  if (!current) return;
  endThinking();
  const record = { agentId, runId, position: records.length + 1, messageId: current.id, message: { ...current.message, stopReason: current.message.content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop' }, metadata: {} };
  records.push(record); emit('message', { record }); current = null; chunks.length = 0;
}
function update(accepted = false) {
  if (accepted) {
    commit(); const final = records.at(-1);
    const contentIndices = final.message.content.flatMap((block, index) => block.type === 'text' ? [index] : []);
    entry.finalRef = { agentId, runId, messageId: final.messageId, position: final.position, contentIndices };
    entry.text = contentIndices.map(index => final.message.content[index].text).join('\n');
  }
  entry.run = run(); entry.working.through = status === 'running' ? null : records.length; entry.revision++;
  const change = { cursor: entry.revision, entry: structuredClone(entry) }; changes.push(change);
  for (const res of groupClients) write(res, 'entry', { version: 1, workspaceId, type: 'entry', change });
  if (status !== 'running') { emit('state', { run: run() }); emit('end', { historyPosition: records.length, run: run() }); for (const res of privateClients) res.end(); }
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'), path = url.pathname;
  const json = (value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (path === '/workspaces/test-control') {
    let raw = ''; for await (const part of req) raw += part; const input = JSON.parse(raw || '{}');
    if (input.action === 'thinking') {
      begin(); endThinking(); thinkingIndex = current.message.content.length;
      current.message.content.push({ type: 'thinking', thinking: '' });
      frame({ type: 'thinking_start', contentIndex: thinkingIndex, content: { type: 'thinking', thinking: '' } });
      current.message.content[thinkingIndex].thinking = input.text ?? 'PRIVATE_REASONING_NEVER_RENDER';
      frame({ type: 'thinking_delta', contentIndex: thinkingIndex, delta: current.message.content[thinkingIndex].thinking });
    }
    if (input.action === 'thinking-end') endThinking();
    if (input.action === 'text') {
      begin(); endThinking(); const contentIndex = current.message.content.length;
      current.message.content.push({ type: 'text', text: input.text ?? 'Visible streamed reply.' });
      frame({ type: 'text_start', contentIndex, content: { type: 'text', text: '' } });
      frame({ type: 'text_delta', contentIndex, delta: current.message.content[contentIndex].text });
    }
    if (input.action === 'tool') {
      begin(); endThinking(); const contentIndex = current.message.content.length;
      const toolCall = { type: 'toolCall', id: 'fixture-tool', name: 'read', arguments: {} }; current.message.content.push(toolCall);
      frame({ type: 'toolcall_start', contentIndex, toolCall }); frame({ type: 'toolcall_end', contentIndex, id: toolCall.id, name: toolCall.name, arguments: {} });
    }
    if (input.action === 'commit') commit();
    if (input.action === 'gap' && current) { emit('gap', { messageId: current.id, expectedSequence: chunks.length, firstAvailable: chunks.length + 10 }); current = null; thinkingIndex = null; chunks.length = 0; }
    if (input.action === 'disconnect') { online = false; current = null; thinkingIndex = null; chunks.length = 0; for (const client of privateClients) client.end(); }
    if (input.action === 'resume') online = true;
    if (input.action === 'publish') { status = 'completed'; update(true); }
    if (input.action === 'cancel') { status = 'cancelled'; update(); }
    return json({ status, records: records.length, chunks: chunks.length });
  }
  if (path === '/config/app') return json({ id: 'settings', revision: 0, value: { title: 'Thinking review', allowAgentCreation: true, maxInputBytes: 20000 } });
  if (path === '/config/connections' || path === '/agents') return json([]);
  if (path === '/config/capabilities') return json({ models: [], tools: [] });
  if (path === '/workspaces') return json({ workspaces: [{ workspaceId, name: 'Thinking review', directory: '/tmp/thinking-review', createdAt: startedAt }] });
  if (path === `/workspaces/${workspaceId}/team`) return json({ workspaceId, members: [{ memberId: agentId, workspaceId, revision: 0, name: 'Lead', role: 'Lead', lead: true, responsibility: 'Fixture only', harness: {}, settings: { connectionId: null, modelId: null, modelOptions: [], toolOptionIds: [], promptOptionIds: [], prompt: '' }, ready: true, issues: [], running: status === 'running' }] });
  if (path === `/workspaces/${workspaceId}/team/chat/timeline-follow`) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); groupClients.add(res);
    for (const change of changes.filter(change => change.cursor > Number(url.searchParams.get('after') || 0))) write(res, 'entry', { version: 1, workspaceId, type: 'entry', change });
    write(res, 'sync', { version: 1, workspaceId, type: 'sync', cursor: entry.revision }); req.on('close', () => groupClients.delete(res)); return;
  }
  if (path === `/agents/${agentId}/follow`) {
    if (!online) return json({ error: { code: 'unavailable', message: 'Fixture disconnected' } }, 503);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); privateClients.add(res);
    const send = (type, value) => write(res, type, { version: 2, agentId, runId, type, ...value });
    for (const record of records.filter(record => record.position > Number(url.searchParams.get('after') || 0))) send('message', { record });
    send('sync', { historyPosition: records.length, run: run() });
    for (const chunk of chunks) send('chunk', chunk);
    if (status !== 'running') { send('end', { historyPosition: records.length, run: run() }); res.end(); }
    req.on('close', () => privateClients.delete(res)); return;
  }
  return json({ error: { code: 'not_found', message: `Fixture does not implement ${path}` } }, 404);
});
server.listen(4290, '127.0.0.1', () => console.log('Thinking fixture: http://127.0.0.1:5284/?workspace=thinking-review'));
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(); });
