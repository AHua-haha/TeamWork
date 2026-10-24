import { MySqlStorage } from '../storage/mysql.js';
import { createBackendModels } from '../core/agent/providers.js';
import { CoreData } from '../core/data.js';
import { ConfigService } from '../core/team/data/config.js';
import { AgentRuntime, configuredPolicy, piModelStream } from '../core/agent/runtime.js';
import { createAgentServer } from '../api/http.js';
import { TeamSystem } from '../core/team/team-system.js';
import { WorkspaceService } from '../core/workspace/workspace.js';
import { webTools } from '../core/harness/web-tools.js';
import { harnessPermissionsEnabled } from '../core/harness/harness-policy.js';
import { harnessPrompt } from '../core/harness/harness-prompts.js';
import { closeBashRuntime } from '../core/harness/harness-command.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL to a MySQL database URL');
const models = createBackendModels();
const storage = new MySqlStorage(databaseUrl);
const store = new CoreData(storage);
const config = new ConfigService(store.config, models, [], process.env.CONFIG_ENCRYPTION_KEY);
const workspaces = new WorkspaceService(store.workspaces, config);
const team = new TeamSystem(store.team, workspaces, config, webTools(process.env.DEEPSEEK_WEB_API_KEY), harnessPermissionsEnabled(process.env.RSI_HARNESS_PERMISSIONS_ENABLED));
const runtime = new AgentRuntime(store.agents, team.runConfig, team.policy(configuredPolicy()), piModelStream(models), {compaction: {thresholdTokens: Number(process.env.RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS ?? 64000), prompt: harnessPrompt('context-compaction')}});
team.attach(runtime);
const server = createAgentServer(runtime, config, workspaces, team);
try {
  await store.migrate();
  await config.initialize();
  // Workspaces registered before teams existed get their lead.
  await team.initialize();
  await runtime.open();
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, process.env.HOST ?? '127.0.0.1', resolve);
  });
  console.log(`Agent backend listening on ${process.env.HOST ?? '127.0.0.1'}:${port}`);
} catch (error) {
  await team.runner.close();
  await runtime.close().catch(() => undefined);
  await closeBashRuntime();
  await workspaces.close();
  await store.close();
  throw error;
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const closed = new Promise<void>(resolve => server.close(() => resolve()));
  try { await team.runner.close(); await runtime.close(); }
  finally {
    server.closeAllConnections();
    await closed;
    await closeBashRuntime();
    await workspaces.close();
    await store.close();
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown().catch(error => { console.error(error); process.exitCode = 1; }); });
