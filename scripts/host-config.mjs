import { randomBytes } from 'node:crypto';
import { link, lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
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
  if (value.version !== 2) throw new Error('Unsupported rsi.config.json version');
  object(value.paths, ['stateDirectory', 'developmentStateDirectory', 'deploymentSourceRoot'], 'paths');
  for (const [name, path] of Object.entries(value.paths)) { text(path, name); if (!isAbsolute(path)) throw new Error(`paths.${name} must be absolute`); }
  object(value.mysql, ['host', 'port', 'project', 'dockerContext', 'rootPassword', 'image', 'containerName', 'networkName', 'volumeName', 'networkKey'], 'mysql');
  if (value.mysql.host !== '127.0.0.1') throw new Error('MySQL host must be loopback');
  if (!/^[a-z][a-z0-9_-]{2,40}$/.test(value.mysql.project)) throw new Error('MySQL project must be a unique lowercase Compose identity');
  for (const name of ['containerName', 'networkName', 'volumeName', 'networkKey']) if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value.mysql[name])) throw new Error(`Invalid MySQL ${name}`);
  text(value.mysql.image, 'MySQL image');
  port(value.mysql.port); text(value.mysql.rootPassword, 'MySQL root password'); text(value.mysql.dockerContext, 'Docker context');
  if (!/^[A-Za-z0-9_.-]+$/.test(value.mysql.dockerContext)) throw new Error('Invalid Docker context name');
  for (const name of ['development', 'deployment']) {
    const section = value[name];
    const fields = ['backendPort', 'frontendPort', 'database', 'encryptionKey', 'environment', 'contextCompactionThresholdTokens'];
    // Retired switch is accepted only as a passive field in existing private config files.
    const {harnessPermissionsEnabled: _retired, ...current} = section ?? {};
    object(current, fields, name);
    if (!Number.isSafeInteger(section.contextCompactionThresholdTokens) || section.contextCompactionThresholdTokens < 1) throw new Error(`${name}.contextCompactionThresholdTokens must be a positive safe integer`);
    port(section.backendPort); port(section.frontendPort); key(section.encryptionKey);
    object(section.database, ['name', 'username', 'password'], `${name} database`);
    if (['mysql', 'sys', 'information_schema', 'performance_schema'].includes(String(section.database.name).toLowerCase())) throw new Error('Application database cannot be a system schema');
    if (String(section.database.username).toLowerCase() === 'root') throw new Error('Application database account cannot be root');
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(section.database.name)) throw new Error(`Invalid ${name} database identity`);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(section.database.username)) throw new Error(`Invalid ${name} database username`);
    text(section.database.username, `${name} username`); text(section.database.password, `${name} password`);
    if (!section.environment || typeof section.environment !== 'object' || Array.isArray(section.environment)) throw new Error(`Invalid ${name} environment`);
    for (const [field, content] of Object.entries(section.environment)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field) || reserved.test(field)) throw new Error(`Reserved or invalid backend environment field: ${field}`);
      text(content, `${name} environment value`, true);
    }
  }
  if (value.development.database.name === value.deployment.database.name || value.development.database.username === value.deployment.database.username) throw new Error('Development and deployment require distinct database names and accounts');
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
  if (!config) throw new Error('Initialize rsi.config.json before managing environments');
  const state = config.paths.stateDirectory;
  return { state, deployment: join(state, 'deploy'), developmentRun: config.paths.developmentStateDirectory };
}
/** Initialize only from the project template; never import credentials or settings implicitly. */
export async function initializeConfiguration() {
  const current = await readConfiguration(); if (current) return current;
  const project = basename(root);
  const template = await readFile(join(root, 'rsi.config.example.json'), 'utf8');
  let config = JSON.parse(template, (_key, value) => typeof value === 'string'
    ? value.replaceAll('${PROJECT_ROOT}', root).replaceAll('${HOME}', homedir()).replaceAll('${PROJECT}', project)
    : value);
  config.mysql.rootPassword = randomBytes(32).toString('hex');
  for (const name of ['development', 'deployment']) {
    config[name].database.password = randomBytes(32).toString('hex');
    config[name].encryptionKey = randomBytes(32).toString('base64');
  }
  validateConfiguration(config);
  const temporary = `${configPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    try { await link(temporary, configPath); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { await rm(temporary, { force: true }); }
  console.log(`Project configuration: ${configPath}; review its resource names, paths and ports before starting.`);
  return readConfiguration();
}
export function backendSettings(config, name) {
  const section = config[name], url = new URL('mysql://127.0.0.1');
  url.hostname = config.mysql.host; url.port = String(config.mysql.port); url.pathname = '/' + section.database.name; url.username = encodeURIComponent(section.database.username); url.password = encodeURIComponent(section.database.password);
  return { ...section.environment, RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS: String(section.contextCompactionThresholdTokens), DATABASE_URL: url.href, CONFIG_ENCRYPTION_KEY: section.encryptionKey, HOST: '127.0.0.1', PORT: String(section.backendPort), NODE_ENV: name === 'deployment' ? 'production' : 'development' };
}
export function composeSettings(config) {
  return { ...hostEnvironment(), RSI_MYSQL_HOST: config.mysql.host, RSI_MYSQL_PORT: String(config.mysql.port), RSI_MYSQL_ROOT_PASSWORD: config.mysql.rootPassword, RSI_MYSQL_DATABASE: config.development.database.name, RSI_MYSQL_USER: config.development.database.username, RSI_MYSQL_PASSWORD: config.development.database.password };
}
/** Generated runtime artifact; the private project config remains the sole source of settings. */
export function composeDefinition(config) {
  const m = config.mysql;
  return {
    services: { mysql: {
      container_name: m.containerName, image: m.image,
      environment: { MYSQL_ROOT_PASSWORD: '${RSI_MYSQL_ROOT_PASSWORD:?}', MYSQL_DATABASE: '${RSI_MYSQL_DATABASE:?}', MYSQL_USER: '${RSI_MYSQL_USER:?}', MYSQL_PASSWORD: '${RSI_MYSQL_PASSWORD:?}' },
      networks: [m.networkKey], ports: [`${m.host}:${m.port}:3306`], volumes: ['mysql-data:/var/lib/mysql'],
      healthcheck: { test: ['CMD-SHELL', 'MYSQL_PWD="$$MYSQL_ROOT_PASSWORD" mysqladmin ping -h localhost --silent'], interval: '2s', timeout: '2s', retries: 30 },
    } },
    networks: { [m.networkKey]: { name: m.networkName } },
    volumes: { 'mysql-data': { name: m.volumeName } },
  };
}
export function composeArguments(config) {
  const directory = join(locations(config).state, 'database');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'compose.json');
  writeFileSync(path, JSON.stringify(composeDefinition(config), null, 2) + '\n', { mode: 0o600 });
  return ['--context', config.mysql.dockerContext, 'compose', '--env-file', '/dev/null', '--project-directory', join(root, 'backend'), '-p', config.mysql.project, '-f', path];
}
