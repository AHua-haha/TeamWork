import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startDatabase, provisionDatabase } from './database.mjs';
import { exists, processRecord, root, startService, stopService, withLock } from './host-common.mjs';
import { backendSettings, hostEnvironment, initializeConfiguration, locations } from './host-config.mjs';

const environmentNames = ['development', 'deployment'];
const [command, environment = 'development'] = process.argv.slice(2);

function usage() {
  throw new Error('Usage: scripts/desktop.sh {start|stop|status} [development|deployment]');
}
function requireEnvironment(value) {
  if (!environmentNames.includes(value)) throw new Error(`Unknown environment: ${value}; choose development or deployment`);
  return value;
}
function requireSupportedNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 22 || minor < 19) throw new Error(`Desktop launcher requires Node.js 22.19.x; found ${process.version}. Run nvm use first`);
}
function desktopConfigPath() {
  if (process.platform === 'darwin') return join(homedir(), 'Library/Application Support/RSI Agent/desktop.json');
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'RSI Agent/desktop.json');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'RSI Agent/desktop.json');
}
function backendAddress(config, name) { return `http://127.0.0.1:${config[name].backendPort}`; }
function backendPidFile(config, name) {
  const state = locations(config);
  return name === 'development' ? join(state.developmentRun, 'desktop-development-backend.pid') : join(state.deployment, 'desktop-deployment-backend.pid');
}
function backendLogFile(config, name) {
  const state = locations(config);
  return name === 'development' ? join(state.developmentRun, 'desktop-development-backend.log') : join(state.deployment, 'desktop-deployment-backend.log');
}
async function deploymentRelease(config) {
  const path = join(locations(config).deployment, 'active.json');
  if (!await exists(path)) throw new Error('No deployment selected; run scripts/deploy.sh deploy <git-ref> first');
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (value.owner !== root) throw new Error('Deployment state belongs to another checkout; configure a separate stateDirectory');
  const source = value.directory;
  const current = join(source, 'backend/dist/src/runtime/main.js');
  const legacy = join(source, 'backend/dist/src/main.js');
  if (await exists(current)) return { ...value, entry: current };
  if (await exists(legacy)) return { ...value, entry: legacy };
  throw new Error('Selected deployment release is missing its compiled backend; run scripts/deploy.sh update');
}
async function backendSpec(config, name) {
  const pidFile = backendPidFile(config, name);
  const log = backendLogFile(config, name);
  if (name === 'development') {
    return {
      name: 'Desktop development backend',
      entry: join(root, 'backend/src/runtime/main.ts'),
      args: ['--import', 'tsx'],
      cwd: join(root, 'backend'),
      env: { ...hostEnvironment(), ...backendSettings(config, name) },
      port: config[name].backendPort,
      url: `${backendAddress(config, name)}/agents`,
      pidFile,
      log,
    };
  }
  const release = await deploymentRelease(config);
  return {
    name: 'Desktop deployment backend',
    entry: release.entry,
    cwd: join(release.directory, 'backend'),
    env: { ...hostEnvironment(), ...backendSettings(config, name), HOST: '127.0.0.1', PORT: String(config[name].backendPort), NODE_ENV: 'production' },
    port: config[name].backendPort,
    url: `${backendAddress(config, name)}/agents`,
    pidFile,
    log,
  };
}
async function readPreviousConfig(path) {
  try { return await readFile(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeDesktopConfig(path, origin) {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify({ backendOrigin: origin }, null, 2) + '\n', { mode: 0o600 });
  await chmod(path, 0o600);
}
async function restoreDesktopConfig(path, previous) {
  if (previous === null) await rm(path, { force: true });
  else { await writeFile(path, previous, { mode: 0o600 }); await chmod(path, 0o600); }
}
async function startBackend(config, name) {
  await startDatabase(config);
  await provisionDatabase(config, name);
  return startService(await backendSpec(config, name));
}
async function stopBackend(config, name) {
  const spec = await backendSpec(config, name);
  await stopService(spec.name, spec.pidFile, spec.entry);
}
async function runDesktop(config, name, started) {
  const configPath = desktopConfigPath();
  const previous = await readPreviousConfig(configPath);
  try {
    await writeDesktopConfig(configPath, backendAddress(config, name));
    const child = spawn('npm', ['start'], { cwd: join(root, 'desktop'), env: hostEnvironment(), stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
      const forward = signal => { if (!child.killed) child.kill(signal); };
      process.once('SIGINT', () => forward('SIGINT'));
      process.once('SIGTERM', () => forward('SIGTERM'));
    });
    if (code !== 0) throw new Error(`Electron exited with status ${code}`);
  } finally {
    await restoreDesktopConfig(configPath, previous);
    if (started) await stopBackend(config, name);
  }
}
async function main() {
  if (!['start', 'stop', 'status'].includes(command)) usage();
  const name = requireEnvironment(environment);
  const config = await initializeConfiguration();
  const spec = await backendSpec(config, name);
  if (command === 'status') {
    const record = await processRecord(spec.pidFile, spec.entry);
    console.log(`${name} desktop backend: ${record ? `running (PID ${record.pid})` : 'stopped'}`);
    return;
  }
  if (command === 'stop') {
    await withLock(() => stopBackend(config, name));
    return;
  }
  requireSupportedNode();
  const started = await withLock(() => startBackend(config, name));
  try {
    await runDesktop(config, name, started);
  } catch (error) {
    try { await withLock(() => stopBackend(config, name)); } catch { /* preserve original failure */ }
    throw error;
  }
}
try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
