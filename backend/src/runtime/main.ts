import { createBackendModels } from '../domain/config/providers.js';
import { MySqlStore } from '../storage/database.js';
import { ConfigService } from '../domain/config/config.js';
import { AgentRuntime, configuredPolicy, piModelStream } from '../domain/agent/runtime.js';
import { createAgentServer } from '../api/http.js';
import { TeamSystem } from '../domain/team/team-system.js';
import { WorkspaceService } from '../domain/workspace/workspace.js';
import { webTools } from '../domain/web-tools/web-tools.js';
import { closeBashRuntime } from '../domain/harness/harness-command.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL to a MySQL database URL');
const models = createBackendModels();
const store = new MySqlStore(databaseUrl);
const config = new ConfigService(store, models, [], process.env.CONFIG_ENCRYPTION_KEY);
const workspaces = new WorkspaceService(store, config);
const team = new TeamSystem(store, workspaces, config, webTools(process.env.DEEPSEEK_WEB_API_KEY));
const runtime = new AgentRuntime(store, team.runConfig, team.policy(configuredPolicy()), piModelStream(models));
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
