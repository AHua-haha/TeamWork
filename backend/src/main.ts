import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { MySqlStore } from './database.js';
import { ConfigService } from './config.js';
import { AgentRuntime, configuredPolicy, piModelStream } from './runtime.js';
import { createAgentServer } from './http.js';
import { TeamSystem } from './team-system.js';
import { WorkspaceService } from './workspace.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL to a MySQL database URL');
const models = builtinModels();
const store = new MySqlStore(databaseUrl);
const config = new ConfigService(store, models, [], process.env.CONFIG_ENCRYPTION_KEY);
const workspaces = new WorkspaceService(store);
const team = new TeamSystem(store, workspaces, config);
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
  team.runner.close();
  await runtime.close().catch(() => undefined);
  await workspaces.close();
  await store.close();
  throw error;
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const closed = new Promise<void>(resolve => server.close(() => resolve()));
  try { team.runner.close(); await runtime.close(); }
  finally {
    server.closeAllConnections();
    await closed;
    await workspaces.close();
    await store.close();
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown().catch(error => { console.error(error); process.exitCode = 1; }); });
