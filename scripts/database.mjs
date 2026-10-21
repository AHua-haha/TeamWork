import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { capture, dockerEnvironment, loadConfig, run } from './host-common.mjs';

const projectRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const ownerLabel = 'org.teamwork.operations.owner';
const serviceLabel = 'org.teamwork.operations.service';
const owner = `sha256:${createHash('sha256').update(projectRoot).digest('hex')}`;
const call = (args) => capture('docker', args, dockerEnvironment());
async function inspect(kind, name) {
  try { return JSON.parse(call(kind === 'volume' ? ['volume', 'inspect', name] : ['inspect', name]))[0]; }
  catch (error) {
    const detail = `${error.message ?? ''} ${error.stderr?.toString?.() ?? ''}`;
    if (/No such (object|container|volume)|not found/i.test(detail)) return null;
    throw error;
  }
}
async function ownedResources(config) {
  const container = await inspect('container', config.database.containerName);
  const volume = await inspect('volume', config.database.volumeName);
  const service = config.database.containerName;
  if (volume && (volume.Labels?.[ownerLabel] !== owner || volume.Labels?.[serviceLabel] !== config.database.containerName)) throw new Error(`Docker volume ${config.database.volumeName} is not labeled for this checkout/service; refusing to use or modify it`);
  if (container) {
    const labels = container.Config?.Labels ?? {};
    const mount = container.Mounts?.find(item => item.Destination === '/var/lib/mysql');
    const port = container.HostConfig?.PortBindings?.['3306/tcp']?.[0];
    const configuredRootPassword = (container.Config?.Env ?? []).find(item => item.startsWith('MYSQL_ROOT_PASSWORD='))?.slice('MYSQL_ROOT_PASSWORD='.length);
    if (labels[ownerLabel] !== owner || labels[serviceLabel] !== service || container.Config?.Image !== config.database.image || configuredRootPassword !== config.database.rootPassword || !mount || mount.Name !== config.database.volumeName || port?.HostIp !== '127.0.0.1' || Number(port?.HostPort) !== config.database.port) {
      throw new Error(`Docker container ${config.database.containerName} does not match configured ownership/settings; refusing to start, stop or replace it`);
    }
    if (!volume) throw new Error(`Expected persistent volume ${config.database.volumeName} is missing; refusing to alter container`);
  }
  return { container, volume, owner };
}
export async function databaseStatus() {
  const config = await loadConfig();
  const { container } = await ownedResources(config);
  return container?.State?.Running === true;
}
export async function startDatabase() {
  const config = await loadConfig();
  let { container, volume, owner } = await ownedResources(config);
  if (!volume) await run('docker', ['volume', 'create', '--label', `${ownerLabel}=${owner}`, '--label', `${serviceLabel}=${config.database.containerName}`, config.database.volumeName]);
  if (container) {
    if (container.State?.Running) return;
    await run('docker', ['start', config.database.containerName]);
  } else {
    await run('docker', ['run', '-d', '--name', config.database.containerName,
      '--label', `${ownerLabel}=${owner}`, '--label', `${serviceLabel}=${config.database.containerName}`,
      '--restart', 'unless-stopped', '--health-cmd', 'mysqladmin ping -h localhost -p"$MYSQL_ROOT_PASSWORD"',
      '--health-interval', '2s', '--health-timeout', '2s', '--health-retries', '30',
      '--publish', `127.0.0.1:${config.database.port}:3306`,
      '--mount', `type=volume,src=${config.database.volumeName},dst=/var/lib/mysql`,
      '--env', 'MYSQL_ROOT_PASSWORD', config.database.image], { env: { ...dockerEnvironment(), MYSQL_ROOT_PASSWORD: config.database.rootPassword } });
  }
  for (let n = 0; n < 60; n++) {
    const current = await inspect('container', config.database.containerName);
    if (current?.State?.Running && current.State?.Health === 'healthy') return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`MySQL container ${config.database.containerName} did not become healthy; inspect it with docker logs`);
}
export async function stopDatabase() {
  const config = await loadConfig();
  const { container } = await ownedResources(config);
  if (container?.State?.Running) await run('docker', ['stop', config.database.containerName]);
}
export async function provisionEnvironment(kind) {
  if (!['development', 'deployment'].includes(kind)) throw new Error('Unknown Operations environment');
  const config = await loadConfig(), values = config[kind], expected = kind === 'development' ? 'rsi_agent_dev' : 'rsi_agent';
  if (values.database !== expected || !/^[A-Za-z0-9_-]{1,128}$/.test(values.username) || !/^[A-Za-z0-9_-]{1,128}$/.test(values.password)) throw new Error('Refusing to provision an unexpected database/account');
  const sql = `CREATE DATABASE IF NOT EXISTS ${expected} CHARACTER SET utf8mb4;\nCREATE USER IF NOT EXISTS '${values.username}'@'%' IDENTIFIED BY '${values.password}';\nALTER USER '${values.username}'@'%' IDENTIFIED BY '${values.password}';\nGRANT ALL PRIVILEGES ON ${expected}.* TO '${values.username}'@'%';\n`;
  await startDatabase();
  const child = spawn('docker', ['exec', '-i', '--env', 'MYSQL_PWD', config.database.containerName, 'mysql', '-uroot'], { env: { ...dockerEnvironment(), MYSQL_PWD: config.database.rootPassword }, stdio: ['pipe', 'ignore', 'inherit'] });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${kind} database provisioning failed`))); child.stdin.end(sql); });
}
export async function provisionDevelopment() { return provisionEnvironment('development'); }
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2];
    if (command === 'start') await startDatabase();
    else if (command === 'stop') await stopDatabase();
    else if (command === 'status') console.log(`MySQL: ${await databaseStatus() ? 'running' : 'stopped/unavailable'}`);
    else throw new Error('Usage: scripts/database.sh {start|stop|status}');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
