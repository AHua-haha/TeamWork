import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const state = resolve(process.env.RSI_STATE_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'rsi-agent'));
export const deployment = join(state, 'deploy');
export const deploymentEnv = join(deployment, 'backend.env');
export const developmentEnv = join(root, 'backend/.env');
export const developmentRun = join(root, '.run');
export const composeArgs = ['compose', '-p', 'backend', '-f', join(root, 'backend/compose.yaml')];
export async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
export async function envFile(path) { return parseEnv(await readFile(path, 'utf8')); }
export function databaseName(settings) {
  const url = new URL(settings.DATABASE_URL);
  if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must name a MySQL database');
  return decodeURIComponent(url.pathname.slice(1));
}
export function validateEnvironment(settings, name) {
  if (databaseName(settings) !== name) throw new Error(`Expected database ${name}; refusing to start against another database`);
  const encodedKey = settings.CONFIG_ENCRYPTION_KEY ?? '', key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error(`Preserve a valid CONFIG_ENCRYPTION_KEY for ${name}`);
}
export async function saveEnv(path, settings) {
  const content = Object.entries(settings).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid environment variable name');
    const quote = !value.includes('"') ? '"' : !value.includes("'") ? "'" : null;
    if (!quote) throw new Error(`Cannot safely serialize environment field ${key}`);
    return `${key}=${quote}${value}${quote}`;
  }).join('\n') + '\n';
  const parsed = parseEnv(content);
  if (Object.keys(parsed).length !== Object.keys(settings).length || Object.entries(settings).some(([key, value]) => parsed[key] !== value)) throw new Error('Environment settings cannot be serialized losslessly');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path); await chmod(path, 0o600);
}

/** Durable production settings are saved before replacing the legacy development file. */
export async function initializeEnvironments() {
  await mkdir(deployment, { recursive: true, mode: 0o700 });
  const current = await exists(developmentEnv) ? await envFile(developmentEnv) : null;
  const example = await envFile(join(root, 'backend/.env.example'));
  if (!await exists(deploymentEnv)) {
    if (current && databaseName(current) !== 'rsi_agent') throw new Error(`Restore deployment settings in ${deploymentEnv} before initializing development`);
    const preserved = current ?? { ...example, DATABASE_URL: 'mysql://rsi:rsi@127.0.0.1:3306/rsi_agent', CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
    validateEnvironment(preserved, 'rsi_agent');
    await saveEnv(deploymentEnv, preserved);
    console.log(`Preserved deployment configuration: ${deploymentEnv}`);
  }
  const production = await envFile(deploymentEnv); validateEnvironment(production, 'rsi_agent');
  if (!current || databaseName(current) === 'rsi_agent') {
    if (current && (current.DATABASE_URL !== production.DATABASE_URL || current.CONFIG_ENCRYPTION_KEY !== production.CONFIG_ENCRYPTION_KEY)) throw new Error('Legacy and saved deployment settings differ; review them before switching development');
    const url = new URL(production.DATABASE_URL); url.pathname = '/rsi_agent_dev'; url.username = 'rsi_dev'; url.password = 'rsi_dev';
    await saveEnv(developmentEnv, { ...example, DATABASE_URL: url.href, CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
    console.log('Initialized development settings for rsi_agent_dev; existing database data were retained.');
  }
  const development = await envFile(developmentEnv); validateEnvironment(development, 'rsi_agent_dev');
  const devUrl = new URL(development.DATABASE_URL), prodUrl = new URL(production.DATABASE_URL);
  if (devUrl.host !== prodUrl.host || devUrl.username !== 'rsi_dev' || development.CONFIG_ENCRYPTION_KEY === production.CONFIG_ENCRYPTION_KEY) throw new Error('Development requires the shared server, rsi_dev account and its own encryption key');
  return { development, production };
}
export function capture(command, args) { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
export async function run(command, args, options = {}) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} failed (${signal ?? code})`)));
  });
}
export function processStart(pid) { try { return capture('ps', ['-p', String(pid), '-o', 'lstart=']); } catch { return null; } }
export async function processRecord(path, legacyMarker) {
  if (!await exists(path)) return null;
  const [pidText, start, marker = legacyMarker, configId] = (await readFile(path, 'utf8')).trimEnd().split('\n');
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid < 1 || !start || !marker || processStart(pid) !== start.trim()) return null;
  let command; try { command = capture('ps', ['-ww', '-p', String(pid), '-o', 'command=']); } catch { return null; }
  return command.includes(marker) ? { pid, start, marker, configId } : null;
}
export async function stopService(name, path, legacyMarker) {
  const record = await processRecord(path, legacyMarker);
  if (!record) { await rm(path, { force: true }); return; }
  console.log(`Stopping ${name} (PID ${record.pid})...`);
  try { process.kill(record.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; await rm(path, { force: true }); return; }
  for (let i = 0; i < 120; i++) { if (!await processRecord(path, legacyMarker)) { await rm(path, { force: true }); return; } await delay(250); }
  if (await processRecord(path, legacyMarker)) process.kill(record.pid, 'SIGKILL');
  for (let i = 0; i < 20; i++) { if (!await processRecord(path, legacyMarker)) { await rm(path, { force: true }); return; } await delay(100); }
  throw new Error(`${name} could not be stopped`);
}
export function ready(url) {
  try { execFileSync('curl', ['--noproxy', '*', '--silent', '--fail', '--max-time', '1', url], { stdio: 'ignore' }); return true; } catch { return false; }
}
export async function startService({ name, entry, args = [], entryArgs = [], cwd, env, port, url, pidFile, log }) {
  const configId = createHash('sha256').update(JSON.stringify({ entry, entryArgs, port, database: env.DATABASE_URL, key: env.CONFIG_ENCRYPTION_KEY })).digest('hex');
  const current = await processRecord(pidFile, entry);
  if (current) {
    if (current.configId !== configId) throw new Error(`${name} settings changed; use restart`);
    if (!ready(url)) throw new Error(`${name} is running but not responding; use restart`);
    console.log(`${name}: already running`); return false;
  }
  // Exclusive bind check; never signal the process holding a conflicting port.
  await new Promise((resolvePort, reject) => {
    import('node:net').then(({ createServer }) => {
      const server = createServer(); server.once('error', () => reject(new Error(`Port ${port} is occupied; ${name} was not started`)));
      server.listen(port, '127.0.0.1', () => server.close(resolvePort));
    }).catch(reject);
  });
  await mkdir(dirname(pidFile), { recursive: true, mode: 0o700 });
  const output = await open(log, 'a', 0o600);
  const child = spawn(process.execPath, [...args, entry, ...entryArgs], { cwd, env, detached: true, stdio: ['ignore', output.fd, output.fd] });
  const spawned = new Promise((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject); });
  child.unref(); await output.close(); await spawned;
  const start = processStart(child.pid);
  if (!start) throw new Error(`${name} exited during startup; inspect ${log}`);
  await writeFile(pidFile, `${child.pid}\n${start}\n${entry}\n${configId}\n`, { mode: 0o600 });
  try {
    for (let i = 0; i < 120; i++) {
      if (!await processRecord(pidFile, entry)) throw new Error(`${name} exited before readiness; inspect ${log}`);
      if (ready(url)) { console.log(`${name}: ${url}`); return true; }
      await delay(250);
    }
    throw new Error(`${name} readiness timed out; inspect ${log}`);
  } catch (error) { await stopService(name, pidFile, entry); throw error; }
}
export async function showLogs(directory, part) {
  if (part && !['backend', 'frontend'].includes(part)) throw new Error('logs accepts backend or frontend');
  for (const name of part ? [part] : ['backend', 'frontend']) {
    const path = join(directory, `${name}.log`); console.log(`${name}: ${path}`);
    if (await exists(path)) await run('tail', ['-n', '60', path]);
  }
}
export async function withLock(action) {
  await mkdir(state, { recursive: true, mode: 0o700 });
  const path = join(state, 'manage.lock');
  let lock;
  try { lock = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let record;
    try { record = JSON.parse(await readFile(path, 'utf8')); }
    catch { throw new Error('Another environment lifecycle command is initializing its lock; retry shortly'); }
    if (!Number.isInteger(record.pid) || record.pid < 1 || typeof record.start !== 'string') throw new Error(`Invalid lifecycle lock: ${path}`);
    if (processStart(record.pid) === record.start) throw new Error('Another environment lifecycle command is running');
    await rm(path); lock = await open(path, 'wx', 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, start: processStart(process.pid) })); await lock.close();
  try { return await action(); } finally { await rm(path, { force: true }); }
}
