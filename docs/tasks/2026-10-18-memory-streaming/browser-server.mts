/** Real SQL/runtime/HTTP fixture. Its isolated database and project are deleted at shutdown. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createModels, fauxAssistantMessage, type AssistantMessageEvent, type TextContent, type ThinkingContent, type ToolCall } from '../../../backend/node_modules/@earendil-works/pi-ai/dist/index.js';
import { builtinModels } from '../../../backend/node_modules/@earendil-works/pi-ai/dist/providers/all.js';
import { MySqlStore } from '../../../backend/src/database.js';
import { ConfigService } from '../../../backend/src/config.js';
import { WorkspaceService } from '../../../backend/src/workspace.js';
import { TeamSystem } from '../../../backend/src/team-system.js';
import { AgentRuntime, configuredPolicy } from '../../../backend/src/runtime.js';
import { createAgentServer } from '../../../backend/src/http.js';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const name = `rsi-stream-browser-${process.pid}`;
const folder = await realpath(await mkdtemp(join(tmpdir(), 'rsi-stream-browser-')));
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
  let call = 0;
  runtime = new AgentRuntime(store, team.runConfig, team.policy(configuredPolicy()), async function* (_request, signal) {
    const first = ++call % 2 === 1;
    const partial = { ...fauxAssistantMessage(''), content: [] as (TextContent | ThinkingContent | ToolCall)[], stopReason: 'pending' as const };
    yield { type: 'start', partial };
    const block: TextContent = { type: 'text', text: '' }; partial.content.push(block);
    yield { type: 'text_start', contentIndex: 0, partial };
    const text = first ? 'I am checking the design and its implementation contract.' : '## Result\n\nStreaming completes correctly.';
    for (const char of text) { signal.throwIfAborted(); block.text += char; yield { type: 'text_delta', contentIndex: 0, delta: char, partial }; await pause(25); }
    await new Promise<void>((resolve, reject) => { advance = resolve; signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); advance = undefined;
    yield { type: 'text_end', contentIndex: 0, content: text, partial };
    if (first) {
      partial.content.push({ type: 'thinking', thinking: 'Hidden fixture reasoning' });
      yield { type: 'thinking_start', contentIndex: 1, partial };
      yield { type: 'thinking_end', contentIndex: 1, content: 'Hidden fixture reasoning', partial };
      const tool: ToolCall = { type: 'toolCall', id: 'fixture-read', name: 'read', arguments: {} }; partial.content.push(tool);
      yield { type: 'toolcall_start', contentIndex: 2, partial };
      tool.arguments = { path: '.rsi/context/design/design.md' };
      yield { type: 'toolcall_delta', contentIndex: 2, delta: JSON.stringify(tool.arguments), partial };
      yield { type: 'toolcall_end', contentIndex: 2, toolCall: tool, partial };
    }
    yield { type: 'done', reason: first ? 'toolUse' : 'stop', message: { ...partial, stopReason: first ? 'toolUse' : 'stop' } } satisfies AssistantMessageEvent;
  }, { progressCapacity: 8 });
  team.attach(runtime); await runtime.open();
  const server = createAgentServer(runtime, config, workspaces, team), listener = server.listeners('request')[0]!;
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url === '/workspaces/fixture-advance') { advance?.(); res.writeHead(200); res.end('{}'); }
    else listener(req, res);
  });
  server.listen(4282, '127.0.0.1'); await once(server, 'listening');
  console.log(JSON.stringify({ url: `http://127.0.0.1:5277/?workspace=${workspace.workspaceId}`, workspaceId: workspace.workspaceId }));
  await new Promise<void>(resolve => process.once('SIGTERM', () => { server.closeAllConnections(); server.close(() => resolve()); }));
} finally {
  await team?.runner.close(); await runtime?.close(); await workspaces?.close(); await store?.close();
  await rm(folder, { recursive: true, force: true });
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
}
