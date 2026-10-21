import { join } from 'node:path';
import { databaseStatus, provisionDevelopment, startDatabase } from './database.mjs';
import { root, processRecord, showLogs, startService, stopService, withLock, exists } from './host-common.mjs';

import { backendSettings, hostEnvironment, initializeConfiguration, locations, readConfiguration } from './host-config.mjs';
let config;
try { config = await readConfiguration(); } catch (error) { console.error(error.message); process.exit(1); }
const { developmentRun } = locations(config);

const backend = join(root, 'backend/src/main.ts'), frontend = join(root, 'frontend/node_modules/vite/bin/vite.js');
const backPid = join(developmentRun, 'backend.pid'), frontPid = join(developmentRun, 'frontend.pid');
async function stop() {
  await stopService('Development frontend', frontPid, frontend);
  await stopService('Development backend', backPid, backend);
}
async function start() {
  config = await initializeConfiguration();
  // Old script PID records lack an environment fingerprint and may still own production data.
  for (const [name, file, marker] of [['frontend', frontPid, frontend], ['backend', backPid, backend]]) {
    const record = await processRecord(file, marker);
    if (record && !record.configId) await stopService(`Legacy development ${name}`, file, marker);
  }
  const development = backendSettings(config, 'development');
  const { backendPort, frontendPort } = config.development;
  if (!await exists(join(root, 'backend/node_modules/tsx')) || !await exists(frontend)) throw new Error('Install development dependencies with npm ci in backend/ and frontend/');
  await startDatabase(config); await provisionDevelopment(config);
  let startedBackend = false;
  try {
    startedBackend = await startService({ name: 'Development backend', entry: backend, args: ['--import', 'tsx'], cwd: join(root, 'backend'), env: { ...hostEnvironment(), ...development }, port: backendPort, url: `http://127.0.0.1:${backendPort}/agents`, pidFile: backPid, log: join(developmentRun, 'backend.log') });
    await startService({ name: 'Development frontend', entry: frontend, cwd: join(root, 'frontend'), entryArgs: ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], env: { ...hostEnvironment(), AGENT_BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}`, PORT: String(frontendPort), NODE_ENV: 'development' }, port: frontendPort, url: `http://127.0.0.1:${frontendPort}/`, pidFile: frontPid, log: join(developmentRun, 'frontend.log') });
  } catch (error) { if (startedBackend) await stopService('Development backend', backPid, backend); throw error; }
}
try {
  const command = process.argv[2];
  if (command === 'status') {
    console.log(`MySQL: ${databaseStatus(config) ? 'running (shared)' : 'stopped/unavailable'}`);
    for (const [name, file, marker] of [['Backend', backPid, backend], ['Frontend', frontPid, frontend]]) {
      const record = await processRecord(file, marker); console.log(`Development ${name}: ${record ? `running (PID ${record.pid})` : 'stopped'}`);
    }
  } else if (command === 'logs') await showLogs(developmentRun, process.argv[3]);
  else if (['init', 'start', 'stop', 'restart'].includes(command)) await withLock(async () => {
    if (command === 'restart') config = await initializeConfiguration();
    if (command === 'stop' || command === 'restart') await stop();
    if (command === 'init') config = await initializeConfiguration();
    if (command === 'start' || command === 'restart') await start();
  });
  else throw new Error('Usage: scripts/dev.sh {init|start|stop|restart|status|logs [backend|frontend]}');
} catch (error) { console.error(error.message); process.exitCode = 1; }
