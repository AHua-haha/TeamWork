import { realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { capture, run, withLock } from './host-common.mjs';
import { composeArguments, composeSettings, initializeConfiguration, readConfiguration } from './host-config.mjs';
import { pathToFileURL } from 'node:url';

export function databaseStatus(config) {
  if (!config) return false;
  try { return capture('docker', [...composeArguments(config), 'ps', '--status', 'running', '--services', 'mysql'], { env: composeSettings(config) }) === 'mysql'; } catch { return false; }
}
function inspect(config, kind, name) {
  try {
    return JSON.parse(capture('docker', ['--context', config.mysql.dockerContext, ...(kind ? [kind] : []), 'inspect', '--format', '{{json .}}', name]));
  } catch (error) {
    if (/no such/i.test(String(error.stderr ?? ''))) return null;
    throw new Error('Cannot inspect configured MySQL resources');
  }
}
export function assertDatabaseOwnership(config) {
  const m = config.mysql;
  const info = inspect(config, null, m.containerName);
  if (info) {
    const labels = info.Config?.Labels ?? {};
    if (labels['com.docker.compose.project'] !== m.project || labels['com.docker.compose.service'] !== 'mysql') throw new Error('Configured MySQL container belongs to another service');
    if (!info.Config.Env?.includes(`MYSQL_ROOT_PASSWORD=${m.rootPassword}`)) throw new Error('Configured MySQL root credential differs from existing service; preserve its existing credential');
    if (info.Config.Image !== m.image) throw new Error('Configured MySQL image differs from existing service; migrate explicitly');
    const bindings = info.HostConfig?.PortBindings?.['3306/tcp'] ?? [];
    if (!bindings.some(binding => binding.HostIp === m.host && Number(binding.HostPort) === m.port)) throw new Error('Configured MySQL address differs from existing service');
    if (!info.Mounts?.some(mount => mount.Destination === '/var/lib/mysql' && mount.Name === m.volumeName)) throw new Error('Configured MySQL data volume differs from existing service');
  }
  for (const [kind, name, label, identity] of [['network', m.networkName, 'network', m.networkKey], ['volume', m.volumeName, 'volume', 'mysql-data']]) {
    const resource = inspect(config, kind, name);
    if (resource && (resource.Labels?.['com.docker.compose.project'] !== m.project || resource.Labels?.[`com.docker.compose.${label}`] !== identity)) throw new Error(`Configured MySQL ${kind} belongs to another service`);
  }
}
export async function startDatabase(config) {
  assertDatabaseOwnership(config);
  // App startup never replaces an existing service or removes its volume.
  await run('docker', [...composeArguments(config), 'up', '-d', '--wait', '--no-recreate', 'mysql'], { env: composeSettings(config) });
}
async function mysqlCommand(config, args, sql, environment = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn('docker', [...composeArguments(config), 'exec', '-T', ...Object.keys(environment).flatMap(key => ['-e', key]), 'mysql', ...args], { env: { ...composeSettings(config), ...environment }, stdio: ['pipe', 'ignore', 'pipe'] });
    // Do not echo SQL or diagnostics that can contain credentials.
    child.stderr.resume(); child.once('error', () => reject(new Error('Cannot execute database command')));
    child.stdin.on('error', () => reject(new Error('Database command input failed')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Database provisioning/connection check failed; check project MySQL credentials')));
    child.stdin.end(sql);
  });
}
export async function provisionDatabase(config, name) {
  const { password, name: database, username } = config[name].database;
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const sql = `SET SESSION sql_mode='NO_BACKSLASH_ESCAPES';\nCREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4;\nCREATE USER IF NOT EXISTS ${quote(username)}@'%' IDENTIFIED BY ${quote(password)};\nALTER USER ${quote(username)}@'%' IDENTIFIED BY ${quote(password)};\nGRANT ALL PRIVILEGES ON \`${database}\`.* TO ${quote(username)}@'%';\n`;
  await mysqlCommand(config, ['sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'], sql);
  await mysqlCommand(config, ['mysql', '--host=127.0.0.1', `--user=${username}`, `--database=${database}`], 'SELECT 1;\n', { MYSQL_PWD: password });
}
function isMain() {
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}
if (isMain()) {
  try {
    const command = process.argv[2];
    if (command === 'start') await withLock(async () => { const config = await initializeConfiguration(); await startDatabase(config); for (const name of ['development', 'deployment']) await provisionDatabase(config, name); });
    else if (command === 'stop') await withLock(async () => {
      const config = await readConfiguration(); if (!config) throw new Error('Run scripts/dev.sh init first');
      assertDatabaseOwnership(config);
      await run('docker', [...composeArguments(config), 'stop', 'mysql'], { env: composeSettings(config) });
    });
    else if (command === 'status') console.log(`MySQL: ${databaseStatus(await readConfiguration()) ? 'running' : 'stopped/unavailable'}`);
    else throw new Error('Usage: scripts/database.sh {start|stop|status}');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
