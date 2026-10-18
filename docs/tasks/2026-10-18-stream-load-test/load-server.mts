/** Real SQL/runtime/HTTP fixture. Its isolated database and project are deleted at shutdown. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fauxAssistantMessage, type AssistantMessageEvent, type TextContent, type ThinkingContent, type ToolCall } from '../../../backend/node_modules/@earendil-works/pi-ai/dist/index.js';
import { builtinModels } from '../../../backend/node_modules/@earendil-works/pi-ai/dist/providers/all.js';
import { MySqlStore } from '../../../backend/src/database.js';
import { ConfigService } from '../../../backend/src/config.js';
import { WorkspaceService } from '../../../backend/src/workspace.js';
import { TeamSystem } from '../../../backend/src/team-system.js';
import { AgentRuntime, configuredPolicy } from '../../../backend/src/runtime.js';
import { createAgentServer } from '../../../backend/src/http.js';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const name = `rsi-stream-load-${process.pid}`;
const folder = await realpath(await mkdtemp(join(tmpdir(), 'rsi-stream-load-')));
let store: MySqlStore | undefined, runtime: AgentRuntime | undefined, team: TeamSystem | undefined, workspaces: WorkspaceService | undefined;
let advance: (() => void) | undefined;
try {
  execFileSync('docker', ['run', '-d', '--rm', '--name', name, '-e', 'MYSQL_ROOT_PASSWORD=fixture', '-e', 'MYSQL_DATABASE=fixture', '-p', '127.0.0.1::3306', 'mysql:8.4'], { stdio: 'ignore' });
  for (let i = 0; ; i++) {
    if (spawnSync('docker', ['exec', name, 'mysqladmin', '-h127.0.0.1', '-uroot', '-pfixture', 'ping'], { stdio: 'ignore' }).status === 0) break;
    if (i > 90) throw new Error('Fixture database unavailable'); await pause(500);
  }
  const port = execFileSync('docker', ['port', name, '3306/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1)!;
  store = new MySqlStore(`mysql://root:fixture@127.0.0.1:${port}/fixture`); await store.migrate();
  const config = new ConfigService(store, builtinModels()); await config.initialize();
  workspaces = new WorkspaceService(store, config); team = new TeamSystem(store, workspaces, config);
  await config.createConnection('fixture', { label: 'Fixture', provider: 'openai', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1' });
  const workspace = await workspaces.create({ name: 'Streaming fixture', directory: join(folder, 'project'), models: { models: [{ connectionId: 'fixture', modelId: 'gpt-4.1-mini' }], defaultModel: { connectionId: 'fixture', modelId: 'gpt-4.1-mini' } }, adopt: false });
  const workers = [];
  for (let i = 0; i < 4; i++) workers.push(await team.create(workspace.workspaceId, { name: 'Worker' + (i + 1), role: 'developer', harness: { designScope: { working: ['metadata.json'], dependencies: [] }, allowedCommands: [] } }));
  interface Spec { label: string; duration: number; rate: number; chunkSize: number; workers: number }
  let spec: Spec = { label: 'idle', duration: 10, rate: 45, chunkSize: 16, workers: 0 };
  let ticks: Record<string, number[]> = {};
  runtime = new AgentRuntime(store, team.runConfig, team.policy(configuredPolicy()), async function* (request, signal) {
    const selected = spec;
    const member = /You are ([^\n]+)/.exec(request.context.systemPrompt ?? '')?.[1] ?? 'member';
    const key = member + ':' + Object.keys(ticks).length;
    const times: number[] = []; ticks[key] = times;
    const partial = { ...fauxAssistantMessage(''), content: [] as TextContent[], stopReason: 'pending' as const };
    yield { type: 'start', partial };
    const block: TextContent = { type: 'text', text: '', textSignature: JSON.stringify({ v: 1, id: 'load-work', phase: 'commentary' }) }; partial.content.push(block);
    yield { type: 'text_start', contentIndex: 0, partial };
    const text = ('## Streaming test\n\nThis is **Markdown** output with a [link](https://example.com), an inline `value`, and enough text to exercise rendering.\n\n- First item\n- Second item\n\n').repeat(2000);
    const count = selected.duration * selected.rate, start = performance.now();
    for (let i = 0; i < count; i++) {
      signal.throwIfAborted();
      const wait = start + i * 1000 / selected.rate - performance.now(); if (wait > 0) await pause(wait);
      const delta = text.slice(i * selected.chunkSize, (i + 1) * selected.chunkSize);
      block.text += delta; times.push(Date.now());
      yield { type: 'text_delta', contentIndex: 0, delta, partial };
    }
    yield { type: 'text_end', contentIndex: 0, content: block.text, partial };
    const final: TextContent = { type: 'text', text: '', textSignature: JSON.stringify({ v: 1, id: 'load-final', phase: 'final_answer' }) }; partial.content.push(final);
    yield { type: 'text_start', contentIndex: 1, partial };
    final.text = 'Benchmark complete.';
    yield { type: 'text_delta', contentIndex: 1, delta: final.text, partial };
    yield { type: 'text_end', contentIndex: 1, content: final.text, partial };
    yield { type: 'done', reason: 'stop', message: { ...partial, stopReason: 'stop' } } satisfies AssistantMessageEvent;
  });
  team.attach(runtime); await runtime.open();
  const memberIds = (await store.listMembers(workspace.workspaceId)).map(member => member.id);
  const server = createAgentServer(runtime, config, workspaces, team), listener = server.listeners('request')[0]!;
  const databaseCounters = async () => {
    const [rows] = await store!.pool.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Bytes_sent','Bytes_received','Questions','Com_select','Com_insert','Com_update','Com_delete','Com_commit','Innodb_data_written','Innodb_os_log_written')");
    return Object.fromEntries((rows as { Variable_name: string; Value: string }[]).map(row => [row.Variable_name, Number(row.Value)]));
  };
  let phase: Promise<unknown> | undefined;
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (!req.url?.startsWith('/workspaces/load/')) { listener(req, res); return; }
    void (async () => {
      const json = (value: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (req.url === '/workspaces/load/info') return json({ pid: process.pid, workspaceId: workspace.workspaceId });
      if (req.url === '/workspaces/load/result') { if (!phase) throw new Error('No phase'); return json(await phase); }
      if (req.url !== '/workspaces/load/start') throw new Error('Unknown control endpoint');
      let raw = ''; for await (const chunk of req) raw += chunk;
      spec = JSON.parse(raw); ticks = {};
      await team!.runner.reset(workspace.workspaceId);
      const counters = await databaseCounters(), cpu = process.cpuUsage(), began = performance.now(), startedAt = Date.now();
      const memory = [process.memoryUsage()];
      const timer = setInterval(() => memory.push(process.memoryUsage()), 250); timer.unref();
      const accepted = spec.workers ? await team!.runner.postUser(workspace.workspaceId, spec.workers === 1 ? 'Generate the benchmark report.' : Array.from({ length: spec.workers }, (_, i) => '@Worker' + (i + 1)).join(' ') + ' Generate reports.') : null;
      const currentSpec = spec;
      phase = (async () => {
        try {
          if (accepted) await Promise.all(accepted.runs.map(run => runtime!.finished(run.agentId, run.runId)));
          else await pause(currentSpec.duration * 1000);
          await pause(300);
          memory.push(process.memoryUsage());
          const elapsed = (performance.now() - began) / 1000, used = process.cpuUsage(cpu), after = await databaseCounters();
          const progress = memberIds.map(id => ({ memberId: id, retainedEvents: runtime!.progress.lane(id).length }));
          return { spec: currentSpec, startedAt, seconds: elapsed, backendCpuPercent: (used.user + used.system) / (elapsed * 10000), rssStartMiB: memory[0]!.rss / 1048576, rssPeakMiB: Math.max(...memory.map(m => m.rss)) / 1048576, rssEndMiB: memory.at(-1)!.rss / 1048576, heapStartMiB: memory[0]!.heapUsed / 1048576, heapPeakMiB: Math.max(...memory.map(m => m.heapUsed)) / 1048576, heapEndMiB: memory.at(-1)!.heapUsed / 1048576, sqlDelta: Object.fromEntries(Object.keys(counters).map(k => [k, after[k]! - counters[k]!])), ticks, progress };
        } finally { clearInterval(timer); }
      })();
      json({ startedAt, runs: accepted?.runs ?? [], workspaceId: workspace.workspaceId });
    })().catch(error => { res.writeHead(500); res.end(String(error)); });
  });
  server.listen(4283, '127.0.0.1'); await once(server, 'listening');
  console.log(JSON.stringify({ url: `http://127.0.0.1:5278/?workspace=${workspace.workspaceId}`, workspaceId: workspace.workspaceId }));
  await new Promise<void>(resolve => process.once('SIGTERM', () => { server.closeAllConnections(); server.close(() => resolve()); }));
} finally {
  await team?.runner.close(); await runtime?.close(); await workspaces?.close(); await store?.close();
  await rm(folder, { recursive: true, force: true });
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
}
