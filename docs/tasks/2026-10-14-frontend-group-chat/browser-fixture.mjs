// Controlled UI review API. No database credentials or model calls. Run with node, then
// AGENT_BACKEND_ORIGIN=http://127.0.0.1:3035 npm --prefix frontend run dev -- --port 5280
import { createServer } from 'node:http';
const workspaceId = 'review';
const now = Date.now() - 30_000;
const settings = { connectionId: 'review-provider', modelId: 'review-model', toolOptionIds: [], prompt: '', promptOptionIds: [], modelOptions: [] };
const members = ['Lead', 'Backend', 'Frontend'].map((name, index) => ({ workspaceId, memberId: name.toLowerCase(), revision: 0, name, lead: index === 0, role: index === 0 ? 'lead' : 'developer', responsibility: `Maintains ${name.toLowerCase()} design and implementation.`, harness: { designScope: { working: index ? ['user/system.json'] : [], dependencies: [] }, allowedCommands: [] }, settings, ready: true, issues: [], running: false }));
const state = (memberId, runId, status = 'completed') => ({ agentId: memberId, runId, status, phase: status === 'running' ? 'model' : 'finished', step: 2, startedAt: now, endedAt: status === 'running' ? null : now + 12000, endPosition: status === 'running' ? null : 3, activeMessageId: null, error: status === 'failed' ? { code: 'tool_error', message: 'The command could not finish. Recorded work remains available.' } : null });
const markdown = '# Group chat implementation\n\nEach member now has a **reserved response section**. Long reports use the available width, with private work folded above.\n\n## What changed\n\n- Accepted mentions reserve response positions immediately.\n- Final responses reference immutable message history.\n- Reconnecting clients replay changes without moving responses.\n\n```ts\nconst response = { position: 2, finalRef: "backend-final" };\n```\n\n| Area | Result |\n| --- | --- |\n| Backend | Durable ordering and references |\n| Frontend | Full-width Markdown and folded work |\n\nThe final response remains readable while you inspect the execution details.\n';
let sequence = 0; let display = 0;
const entries = new Map(); const changes = []; const followers = new Set();
const frame = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ version: 1, workspaceId, type, ...data })}\n\n`;
function write(entry) {
  entry.position ||= ++display; entry.revision = ++sequence;
  entries.set(entry.entryId, structuredClone(entry));
  const change = { cursor: sequence, entry: structuredClone(entry) }; changes.push(change);
  for (const response of followers) response.write(frame('entry', { change }));
  return structuredClone(entry);
}
const base = (entryId) => ({ workspaceId, entryId, position: 0, revision: 0, exchangeId: 'exchange', time: now });
write({ ...base('user-first'), kind: 'user', messageId: 'user-first', text: '@Backend @Frontend implement the group chat design' });
write({ ...base('backend-run'), kind: 'member', memberId: 'backend', name: 'Backend', run: state('backend', 'backend-run'), working: { after: 0, through: 3 }, finalRef: { agentId: 'backend', runId: 'backend-run', messageId: 'backend-final', position: 3 }, text: markdown });
write({ ...base('frontend-run'), kind: 'member', memberId: 'frontend', name: 'Frontend', run: state('frontend', 'frontend-run'), working: { after: 0, through: 3 }, finalRef: { agentId: 'frontend', runId: 'frontend-run', messageId: 'frontend-final', position: 3 }, text: '## Frontend ready\n\nThe two replies keep their reserved order even when Frontend completes first. User input is displayed on the right.\n\n**Verified:** responsive width, folded work and reload consistency.' });
write({ ...base('failed-run'), kind: 'member', memberId: 'frontend', name: 'Frontend', run: state('frontend', 'failed-run', 'failed'), working: { after: 0, through: 3 }, finalRef: null, text: null });
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = content => ({ role: 'assistant', content, api: 'openai-responses', provider: 'review', model: 'review-model', usage, stopReason: 'stop', timestamp: now });
const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
  if (path === '/config/app') return json(res, { id: 'app', revision: 0, value: { title: 'RSI Agent', allowAgentCreation: true, maxInputBytes: 1000000 } });
  if (path === '/agents') return json(res, []);
  if (path === '/config/connections') return json(res, [{ id: 'review-provider', revision: 0, value: { label: 'Review provider', provider: 'review', api: 'openai-responses', baseUrl: 'http://review.invalid', keyConfigured: false } }]);
  if (path.endsWith('/models')) return json(res, [{ source: 'pi', modelId: 'review-model', label: 'Review model', api: 'openai-responses', reasoning: false, reasoningLevels: [], defaultReasoning: null, reasoningSentAs: {}, contextWindow: 100000, maxTokens: 20000, verified: true }]);
  if (path === '/workspaces') return json(res, { workspaces: [{ workspaceId, name: 'Group chat review', directory: '/review/project', createdAt: now }] });
  if (path === '/workspaces/review') return json(res, { workspaceId, name: 'Group chat review', directory: '/review/project', createdAt: now, context: { seq: 0, user: { files: 1, bytes: 100 }, agent: { files: 0, bytes: 0 }, problems: [] } });
  if (path === '/workspaces/review/team') return json(res, { workspaceId, members });
  if (path.includes('/team/members/') && req.method === 'PUT') {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body); const member = members.find(member => member.memberId === path.split('/').at(-1));
    Object.assign(member, input.value, { revision: member.revision + 1 }); return json(res, member);
  }
  if (path.endsWith('/timeline-follow')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const change of changes.filter(change => change.cursor > Number(url.searchParams.get('after') ?? 0))) res.write(frame('entry', { change }));
    res.write(frame('sync', { cursor: sequence })); res.write(frame('settings', { mentionLimit: 32 }));
    followers.add(res); req.on('close', () => followers.delete(res)); return;
  }
  if (path.endsWith('/chat/messages')) {
    let body = ''; for await (const chunk of req) body += chunk;
    const { text } = JSON.parse(body);
    if (text.includes('refuse')) return json(res, { error: { code: 'member_busy', message: 'Backend is working; try again when it is free' } }, 409);
    const newEntries = [write({ ...base(`user-${sequence}`), kind: 'user', messageId: `message-${sequence}`, text })];
    for (const member of text.includes('@') ? members.filter(member => text.includes(`@${member.name}`)) : [members[0]]) {
      if (member.running) return json(res, { error: { code: 'member_busy', message: 'Member busy' } }, 409);
      const runId = `activation-${sequence}`;
      member.running = true;
      const entry = write({ ...base(runId), kind: 'member', memberId: member.memberId, name: member.name, run: state(member.memberId, runId, 'running'), working: { after: 0, through: null }, finalRef: null, text: null });
      newEntries.push(entry);
      setTimeout(() => { if (!member.running || entries.get(runId).run.status !== 'running') return; member.running = false; write({ ...entry, run: state(member.memberId, runId), working: { after: 0, through: 3 }, finalRef: { agentId: member.memberId, runId, messageId: `${member.memberId}-final`, position: 3 }, text: member.name === 'Backend' ? markdown : '## Finished\n\nMy final response fills the same reserved section.' }); }, member.name === 'Backend' ? 15000 : 8000);
    }
    return json(res, { entries: newEntries }, 202);
  }
  if (path.endsWith('/chat/stop')) {
    for (const entry of entries.values()) if (entry.kind === 'member' && entry.run.status === 'running') {
      members.find(member => member.memberId === entry.memberId).running = false;
      write({ ...entry, run: state(entry.memberId, entry.run.runId, 'cancelled'), working: { after: 0, through: 3 } });
    }
    return json(res, { stopped: true }, 202);
  }
  if (/\/agents\/[^/]+\/follow$/.test(path)) {
    const agentId = path.split('/')[2]; const runId = url.searchParams.get('runId');
    const entry = entries.get(runId); const run = entry.run;
    const records = [
      { agentId, runId, messageId: 'commentary', position: 1, message: assistant([{ type: 'text', text: 'I’ll check the implementation and verify the stored response ordering.' }]), metadata: {} },
      { agentId, runId, messageId: 'tools', position: 2, message: assistant([{ type: 'toolCall', id: 'call', name: 'read', arguments: { path: 'backend/src/group-chat.ts' } }]), metadata: {} },
      { agentId, runId, messageId: `${agentId}-final`, position: 3, message: assistant([{ type: 'text', text: entry.text ?? 'Private work remains recorded.' }]), metadata: {} },
    ];
    const privateFrame = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ version: 1, agentId, runId, type, ...data })}\n\n`;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const record of records.filter(record => record.position > Number(url.searchParams.get('after') ?? 0))) res.write(privateFrame('message', { record }));
    res.write(privateFrame('sync', { historyPosition: 3, run }));
    if (run.status !== 'running') res.end(privateFrame('end', { historyPosition: 3, run }));
    return;
  }
  if (path.endsWith('/context/follow')) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`event: sync\ndata: ${JSON.stringify({ version: 1, workspaceId, type: 'sync', seq: 0 })}\n\n`); return; }
  if (path.endsWith('/designs/file')) return json(res, { path: 'user/system.json', revision: 'design-v1', content: '{}', size: 2, updatedAt: now, current: true, author: { type: 'user' }, reason: null, design: { content: '## Group chat\n\nOne shared chat and reserved responses.', implementation: ['backend/', 'frontend/'] }, designIssue: null });
  if (path.endsWith('/designs')) return json(res, { workspaceId, designs: [{ path: 'user/system.json', content: '## Group chat\n\nOne shared chat and reserved responses.', implementation: ['backend/', 'frontend/'], revision: 'design-v1' }], issues: [] });
  if (path.endsWith('/tree')) return json(res, { path: url.searchParams.get('path') ?? '', entries: [], truncated: false });
  if (path.endsWith('/context')) return json(res, { seq: 0, user: { files: 1, bytes: 100 }, agent: { files: 0, bytes: 0 }, problems: [] });
  return json(res, { error: { code: 'not_found', message: 'Fixture endpoint missing' } }, 404);
}).listen(3035, '127.0.0.1', () => console.log('Controlled group UI review API on 3035'));
