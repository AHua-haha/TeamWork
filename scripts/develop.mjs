import { join } from 'node:path';
import { databaseStatus, provisionDevelopment, startDatabase } from './database.mjs';
import { root, developmentRun, initializeEnvironments, processRecord, showLogs, startService, stopService, withLock, exists } from './host-common.mjs';

const backend = join(root, 'backend/src/main.ts'), frontend = join(root, 'frontend/node_modules/vite/bin/vite.js');
const backPid = join(developmentRun, 'backend.pid'), frontPid = join(developmentRun, 'frontend.pid');
async function stop() {
  await stopService('Development frontend', frontPid, frontend);
  await stopService('Development backend', backPid, backend);
}
async function start() {
  // Old script PID records lack an environment fingerprint and may still own production data.
  for (const [name, file, marker] of [['frontend', frontPid, frontend], ['backend', backPid, backend]]) {
    const record = await processRecord(file, marker);
    if (record && !record.configId) await stopService(`Legacy development ${name}`, file, marker);
  }
  const { development } = await initializeEnvironments();
  if (!await exists(join(root, 'backend/node_modules/tsx')) || !await exists(frontend)) throw new Error('Install development dependencies with npm ci in backend/ and frontend/');
  await startDatabase(); await provisionDevelopment(development);
  let startedBackend = false;
  try {
    startedBackend = await startService({ name: 'Development backend', entry: backend, args: ['--import', 'tsx'], cwd: join(root, 'backend'), env: { ...process.env, ...development, HOST: '127.0.0.1', PORT: '3000', NODE_ENV: 'development' }, port: 3000, url: 'http://127.0.0.1:3000/agents', pidFile: backPid, log: join(developmentRun, 'backend.log') });
    await startService({ name: 'Development frontend', entry: frontend, cwd: join(root, 'frontend'), entryArgs: ['--host', '127.0.0.1', '--port', '5273', '--strictPort'], env: { ...process.env, AGENT_BACKEND_ORIGIN: 'http://127.0.0.1:3000', PORT: '5273', NODE_ENV: 'development' }, port: 5273, url: 'http://127.0.0.1:5273/', pidFile: frontPid, log: join(developmentRun, 'frontend.log') });
  } catch (error) { if (startedBackend) await stopService('Development backend', backPid, backend); throw error; }
}
try {
  const command = process.argv[2];
  if (command === 'status') {
    console.log(`MySQL: ${await databaseStatus() ? 'running (checkout isolated)' : 'stopped/unavailable'}`);
    for (const [name, file, marker] of [['Backend', backPid, backend], ['Frontend', frontPid, frontend]]) {
      const record = await processRecord(file, marker); console.log(`Development ${name}: ${record ? `running (PID ${record.pid})` : 'stopped'}`);
    }
  } else if (command === 'logs') await showLogs(developmentRun, process.argv[3]);
  else if (['init', 'start', 'stop', 'restart'].includes(command)) await withLock(async () => {
    if (command === 'stop' || command === 'restart') await stop();
    if (command === 'init') await initializeEnvironments();
    if (command === 'start' || command === 'restart') await start();
  });
  else throw new Error('Usage: scripts/dev.sh {init|start|stop|restart|status|logs [backend|frontend]}');
} catch (error) { console.error(error.message); process.exitCode = 1; }
