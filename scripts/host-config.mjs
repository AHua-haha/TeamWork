import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { link, lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const configPath = join(root, 'rsi.config.json');
const reserved = /^(?:DATABASE_URL|CONFIG_ENCRYPTION_KEY|HOST|PORT|NODE_ENV|NODE_OPTIONS|NODE_PATH|AGENT_BACKEND_ORIGIN|FRONTEND_DIST|RSI_.*|COMPOSE_.*|DOCKER_.*|NPM_CONFIG_.*)$/i;

/** Only host/toolchain essentials cross the process boundary; application settings never do. */
export function hostEnvironment() {
  const names = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'LANG', 'TERM', 'COLORTERM']);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => names.has(key) || key.startsWith('LC_')));
}
function object(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !(key in value))) throw new Error(`Invalid ${label} fields in rsi.config.json`);
  return value;
}
function text(value, label, empty = false) {
  if (typeof value !== 'string' || (!empty && !value) || value.includes('\0')) throw new Error(`Invalid ${label} in rsi.config.json`);
}
function port(value) { if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Configuration ports must be integers from 1 to 65535'); }
function key(value) { if (typeof value !== 'string' || Buffer.from(value, 'base64').length !== 32 || Buffer.from(value, 'base64').toString('base64') !== value) throw new Error('Preserve valid 32-byte encryption keys in rsi.config.json'); }
export function validateConfiguration(value) {
  object(value, ['version', 'paths', 'mysql', 'development', 'deployment'], 'configuration');
  if (value.version !== 1) throw new Error('Unsupported rsi.config.json version');
  object(value.paths, ['stateDirectory', 'developmentStateDirectory', 'deploymentSourceRoot'], 'paths');
  for (const [name, path] of Object.entries(value.paths)) { text(path, name); if (!isAbsolute(path)) throw new Error(`paths.${name} must be absolute`); }
  object(value.mysql, ['host', 'port', 'project', 'dockerContext', 'rootPassword'], 'mysql');
  if (value.mysql.host !== '127.0.0.1' || value.mysql.project !== 'backend') throw new Error('Shared MySQL must retain loopback host and the existing backend project identity');
  port(value.mysql.port); text(value.mysql.rootPassword, 'MySQL root password'); text(value.mysql.dockerContext, 'Docker context');
  if (!/^[A-Za-z0-9_.-]+$/.test(value.mysql.dockerContext)) throw new Error('Invalid Docker context name');
  for (const name of ['development', 'deployment']) {
    const section = value[name];
    const fields = ['backendPort', 'frontendPort', 'database', 'encryptionKey', 'environment'];
    object(section, [...fields, ...['harnessPermissionsEnabled', 'contextCompactionThresholdTokens'].filter(field => section && Object.hasOwn(section, field))], name);
    if (section.harnessPermissionsEnabled !== undefined && typeof section.harnessPermissionsEnabled !== 'boolean') throw new Error(`${name}.harnessPermissionsEnabled must be boolean`);
    if (section.contextCompactionThresholdTokens !== undefined && (!Number.isSafeInteger(section.contextCompactionThresholdTokens) || section.contextCompactionThresholdTokens < 1)) throw new Error(`${name}.contextCompactionThresholdTokens must be a positive safe integer`);
    port(section.backendPort); port(section.frontendPort); key(section.encryptionKey);
    object(section.database, ['name', 'username', 'password'], `${name} database`);
    if (section.database.name !== (name === 'development' ? 'rsi_agent_dev' : 'rsi_agent')) throw new Error(`Unexpected ${name} database identity`);
    text(section.database.username, `${name} username`); text(section.database.password, `${name} password`);
    if (name === 'development' && (section.database.username !== 'rsi_dev' || !/^[A-Za-z0-9_-]{1,128}$/.test(section.database.password))) throw new Error('Development requires the dedicated rsi_dev account and a local password using letters, digits, _ or -');
    if (!section.environment || typeof section.environment !== 'object' || Array.isArray(section.environment)) throw new Error(`Invalid ${name} environment`);
    for (const [field, content] of Object.entries(section.environment)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field) || reserved.test(field)) throw new Error(`Reserved or invalid backend environment field: ${field}`);
      text(content, `${name} environment value`, true);
    }
  }
  if (value.development.encryptionKey === value.deployment.encryptionKey) throw new Error('Development and deployment encryption keys must differ');
  const ports = [value.mysql.port, ...['development', 'deployment'].flatMap(name => [value[name].backendPort, value[name].frontendPort])];
  if (new Set(ports).size !== ports.length) throw new Error('MySQL, development and deployment ports must all be distinct');
  return value;
}
export async function readConfiguration() {
  let info;
  try { info = await lstat(configPath); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('rsi.config.json must be a regular file, not a symlink');
  if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('rsi.config.json contains credentials; run chmod 600 rsi.config.json');
  let value;
  try { value = JSON.parse(await readFile(configPath, 'utf8')); } catch { throw new Error('Cannot parse rsi.config.json; preserve its credentials and repair the JSON'); }
  return validateConfiguration(value);
}
export function locations(config) {
  const state = config?.paths.stateDirectory ?? join(homedir(), '.local/state/rsi-agent');
  return { state, deployment: join(state, 'deploy'), developmentRun: config?.paths.developmentStateDirectory ?? join(root, '.run') };
}
async function legacy(path) { try { return parseEnv(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function legacyDatabase(settings) {
  let url;
  try { url = new URL(settings.DATABASE_URL); } catch { throw new Error('Invalid legacy database URL; no configuration was imported'); }
  if (url.search || url.hash) throw new Error('Legacy database URL options require explicit migration; no configuration was imported');
  if (url.protocol !== 'mysql:') throw new Error('Legacy DATABASE_URL must name MySQL');
  return { url, database: { name: decodeURIComponent(url.pathname.slice(1)), username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } };
}
function legacySection(settings, backendPort, frontendPort) {
  const { database } = legacyDatabase(settings);
  const environment = Object.fromEntries(Object.entries(settings).filter(([name]) => !reserved.test(name)));
  return { backendPort, frontendPort, harnessPermissionsEnabled: true, contextCompactionThresholdTokens: 128000, database, encryptionKey: settings.CONFIG_ENCRYPTION_KEY, environment };
}
/** Import once without editing legacy files. The project file becomes the sole authority. */
export async function initializeConfiguration() {
  const current = await readConfiguration(); if (current) return current;
  const paths = { stateDirectory: join(homedir(), '.local/state/rsi-agent'), developmentStateDirectory: join(root, '.run'), deploymentSourceRoot: '/tmp/rsi-agent-deploy' };
  const oldDev = await legacy(join(root, 'backend/.env'));
  const saved = await legacy(join(paths.stateDirectory, 'deploy/backend.env'));
  if (!saved && oldDev && legacyDatabase(oldDev).database.name !== 'rsi_agent') throw new Error('Saved deployment configuration is missing; restore it before importing development settings');
  const production = saved ?? oldDev ?? { DATABASE_URL: 'mysql://rsi:rsi@127.0.0.1:3306/rsi_agent', CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  const prod = legacyDatabase(production);
  let development;
  if (oldDev && legacyDatabase(oldDev).database.name === 'rsi_agent_dev') development = oldDev;
  else {
    if (oldDev && (oldDev.DATABASE_URL !== production.DATABASE_URL || oldDev.CONFIG_ENCRYPTION_KEY !== production.CONFIG_ENCRYPTION_KEY)) throw new Error('Legacy deployment settings conflict; no configuration was imported');
    const url = new URL(prod.url); url.pathname = '/rsi_agent_dev'; url.username = 'rsi_dev'; url.password = 'rsi_dev';
    development = { DATABASE_URL: url.href, CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  }
  if (legacyDatabase(development).url.host !== prod.url.host) throw new Error('Legacy development/deployment MySQL addresses differ; resolve them before import');
  let dockerContext = 'default';
  try { dockerContext = execFileSync('docker', ['context', 'show'], { encoding: 'utf8', env: hostEnvironment(), stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* init can precede Docker installation */ }
  const config = validateConfiguration({ version: 1, paths, mysql: { host: prod.url.hostname, port: Number(prod.url.port || 3306), project: 'backend', dockerContext, rootPassword: 'local-root' }, development: legacySection(development, 3000, 5273), deployment: legacySection(production, 3001, 5274) });
  const temporary = `${configPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    try { await link(temporary, configPath); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { await rm(temporary, { force: true }); }
  console.log(`Project configuration: ${configPath}; legacy env files remain unchanged and are no longer read.`);
  return readConfiguration();
}
export function backendSettings(config, name) {
  const section = config[name], url = new URL('mysql://127.0.0.1');
  url.hostname = config.mysql.host; url.port = String(config.mysql.port); url.pathname = '/' + section.database.name; url.username = encodeURIComponent(section.database.username); url.password = encodeURIComponent(section.database.password);
  return { ...section.environment, RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS: String(section.contextCompactionThresholdTokens ?? 128000), RSI_HARNESS_PERMISSIONS_ENABLED: String(section.harnessPermissionsEnabled ?? true), DATABASE_URL: url.href, CONFIG_ENCRYPTION_KEY: section.encryptionKey, HOST: '127.0.0.1', PORT: String(section.backendPort), NODE_ENV: name === 'deployment' ? 'production' : 'development' };
}
export function composeSettings(config) {
  return { ...hostEnvironment(), RSI_MYSQL_HOST: config.mysql.host, RSI_MYSQL_PORT: String(config.mysql.port), RSI_MYSQL_ROOT_PASSWORD: config.mysql.rootPassword, RSI_MYSQL_DATABASE: config.deployment.database.name, RSI_MYSQL_USER: config.deployment.database.username, RSI_MYSQL_PASSWORD: config.deployment.database.password };
}
export function composeArguments(config) {
  return ['--context', config.mysql.dockerContext, 'compose', '--env-file', '/dev/null', '--project-directory', join(root, 'backend'), '-p', config.mysql.project, '-f', join(root, 'backend/compose.yaml')];
}
