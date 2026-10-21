import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const configPath = join(root, 'operations.config.json');
const checkoutId = createHash('sha256').update(root).digest('hex').slice(0, 16);
export const databaseProject = `rsi-agent-${checkoutId}`;
export let composeArgs;
let loadedConfig;
const defaultConfig = () => ({
  stateDirectory: '.operations', deployRoot: '/tmp/rsi-agent-deploy',
  database: { port: 3307 + (parseInt(checkoutId.slice(0, 6), 16) % 1000), rootPassword: randomBytes(24).toString('base64url') },
  development: { backendPort: 3000, frontendPort: 5273, database: 'rsi_agent_dev', username: 'rsi_dev', password: randomBytes(24).toString('base64url'), encryptionKey: randomBytes(32).toString('base64'), deepseekWebApiKey: '' },
  deployment: { backendPort: 3001, frontendPort: 5274, database: 'rsi_agent', username: 'rsi', password: randomBytes(24).toString('base64url'), encryptionKey: randomBytes(32).toString('base64'), deepseekWebApiKey: '' }
});
export async function loadConfig({ create = true } = {}) {
  if (loadedConfig) return loadedConfig;
  if (!await exists(configPath)) {
    if (!create) throw new Error(`Operations config is missing: ${configPath}; run scripts/dev.sh init`);
    await writeFile(configPath, JSON.stringify(defaultConfig(), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await chmod(configPath, 0o600);
    console.log(`Created private Operations configuration: ${configPath}`);
  }
  let value;
  try { value = JSON.parse(await readFile(configPath, 'utf8')); } catch { throw new Error(`Invalid JSON in ${configPath}`); }
  const required = [value.stateDirectory, value.deployRoot, value.database?.port, value.database?.rootPassword];
  for (const name of ['development', 'deployment']) required.push(value[name]?.backendPort, value[name]?.frontendPort, value[name]?.database, value[name]?.username, value[name]?.password, value[name]?.encryptionKey);
  if (required.some(item => item === undefined || item === null || item === '')) throw new Error(`Operations config is missing required values: ${configPath}`);
  const ports = [value.database.port, value.development.backendPort, value.development.frontendPort, value.deployment.backendPort, value.deployment.frontendPort];
  if (!ports.every(port => Number.isInteger(port) && port > 0 && port <= 65535) || new Set(ports).size !== ports.length) throw new Error('Configured database and application ports must be distinct valid port numbers');
  for (const [label, env] of [['development', value.development], ['deployment', value.deployment]]) {
    if (env.database !== (label === 'development' ? 'rsi_agent_dev' : 'rsi_agent')) throw new Error(`Configured ${label} database must remain isolated`);
    const key = Buffer.from(env.encryptionKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== env.encryptionKey) throw new Error(`Invalid ${label} encryptionKey (expected base64 32-byte key)`);
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value.development.password) || !/^[A-Za-z0-9_-]{1,128}$/.test(value.deployment.password) || !/^[A-Za-z0-9_-]{1,128}$/.test(value.database.rootPassword)) throw new Error('Database passwords must contain only letters, digits, _ or - (maximum 128 characters)');
  const state = resolve(root, value.stateDirectory);
  if (state === root || !state.startsWith(root + '/')) throw new Error('stateDirectory must be inside the checkout and not its root');
  loadedConfig = value;
  return value;
}
export async function runtimePaths() {
  const config = await loadConfig(), state = resolve(root, config.stateDirectory);
  return { state, deployment: join(state, 'deploy'), developmentRun: join(state, 'dev'), databaseComposeFile: join(state, `compose-${checkoutId}.yaml`), databasePort: config.database.port };
}
export async function serviceSettings(kind) {
  const config = await loadConfig(), values = config[kind], user = encodeURIComponent(values.username), password = encodeURIComponent(values.password);
  return { DATABASE_URL: `mysql://${user}:${password}@127.0.0.1:${config.database.port}/${values.database}`, CONFIG_ENCRYPTION_KEY: values.encryptionKey, HOST: '127.0.0.1', PORT: String(values.backendPort), NODE_ENV: kind === 'development' ? 'development' : 'production', DEEPSEEK_WEB_API_KEY: values.deepseekWebApiKey ?? '' };
}
const pathExports = await runtimePaths();
export const deployment = pathExports.deployment;
export const developmentRun = pathExports.developmentRun;
export const databaseComposeFile = pathExports.databaseComposeFile;
composeArgs = ['compose', '-p', databaseProject, '-f', databaseComposeFile];

export async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
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

export async function initializeEnvironments() {
  const config = await loadConfig();
  await mkdir(resolve(root, config.stateDirectory), { recursive: true, mode: 0o700 });
  await chmod(configPath, 0o600);
  const development = await serviceSettings('development'), production = await serviceSettings('deployment');
  validateEnvironment(development, 'rsi_agent_dev'); validateEnvironment(production, 'rsi_agent');
  return { development, production };
}
export async function ensureDatabaseCompose() {
  const config = await loadConfig(), paths = await runtimePaths(), volume = `${databaseProject}-mysql-data`, rootPassword = config.database.rootPassword;
  const yaml = `# Generated for checkout ${root}\nservices:\n  mysql:\n    image: mysql:8.4\n    environment:\n      MYSQL_ROOT_PASSWORD: "${rootPassword}"\n    ports:\n      - "127.0.0.1:${config.database.port}:3306"\n    volumes:\n      - ${volume}:/var/lib/mysql\n    healthcheck:\n      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-p${rootPassword}"]\n      interval: 2s\n      timeout: 2s\n      retries: 30\nvolumes:\n  ${volume}: {}\n`;
  await mkdir(dirname(paths.databaseComposeFile), { recursive: true, mode: 0o700 });
  try { await writeFile(paths.databaseComposeFile, yaml, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readFile(paths.databaseComposeFile, 'utf8');
    if (existing !== yaml) throw new Error(`Checkout database Compose identity mismatch in ${paths.databaseComposeFile}; refusing to use it`);
  }
}


const childEnvironment = () => ({ PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: root });
export function capture(command, args) { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: childEnvironment() }).trim(); }
export async function run(command, args, options = {}) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { env: childEnvironment(), stdio: 'inherit', ...options });
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
  const child = spawn(process.execPath, [...args, entry, ...entryArgs], { cwd, env: { ...env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', HOME: root }, detached: true, stdio: ['ignore', output.fd, output.fd] });
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
  const { state } = await runtimePaths();
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
