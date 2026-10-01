import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { MySqlStore } from './database.js';
import { ConfigService } from './config.js';
import { AgentRuntime, configuredPolicy, piModelStream } from './runtime.js';
import { createAgentServer } from './http.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL to a MySQL database URL');
const models = builtinModels();
const store = new MySqlStore(databaseUrl);
const config = new ConfigService(store, models, [], process.env.CONFIG_ENCRYPTION_KEY);
const runtime = new AgentRuntime(store, config, configuredPolicy(), piModelStream(models));
const server = createAgentServer(runtime, config);
try {
  await store.migrate();
  await config.initialize();
  await runtime.open();
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, process.env.HOST ?? '127.0.0.1', resolve);
  });
  console.log(`Agent backend listening on ${process.env.HOST ?? '127.0.0.1'}:${port}`);
} catch (error) {
  await runtime.close().catch(() => undefined);
  await store.close();
  throw error;
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const closed = new Promise<void>(resolve => server.close(() => resolve()));
  try { await runtime.close(); }
  finally {
    server.closeAllConnections();
    await closed;
    await store.close();
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown().catch(error => { console.error(error); process.exitCode = 1; }); });
