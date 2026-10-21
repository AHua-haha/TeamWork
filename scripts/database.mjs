import { spawn } from 'node:child_process';
import { composeArgs, capture, databaseComposeFile, ensureDatabaseCompose, exists, run, loadConfig } from './host-common.mjs';
import { pathToFileURL } from 'node:url';

export async function databaseStatus() {
  try { if (!await exists(databaseComposeFile)) return false; return capture('docker', [...composeArgs, 'ps', '--status', 'running', '--services', 'mysql']) === 'mysql'; } catch { return false; }
}
export async function startDatabase() { await ensureDatabaseCompose(); await run('docker', [...composeArgs, 'up', '-d', '--wait', 'mysql']); }
export async function provisionEnvironment(kind) {
  if (!['development', 'deployment'].includes(kind)) throw new Error('Unknown Operations environment');
  const config = await loadConfig(), values = config[kind], expected = kind === 'development' ? 'rsi_agent_dev' : 'rsi_agent';
  if (values.database !== expected || !/^[A-Za-z0-9_-]{1,128}$/.test(values.username) || !/^[A-Za-z0-9_-]{1,128}$/.test(values.password)) throw new Error('Refusing to provision an unexpected database/account');
  const sql = `CREATE DATABASE IF NOT EXISTS ${expected} CHARACTER SET utf8mb4;\nCREATE USER IF NOT EXISTS '${values.username}'@'%' IDENTIFIED BY '${values.password}';\nALTER USER '${values.username}'@'%' IDENTIFIED BY '${values.password}';\nGRANT ALL PRIVILEGES ON ${expected}.* TO '${values.username}'@'%';\n`;
  await ensureDatabaseCompose();
  await new Promise((resolve, reject) => {
    const child = spawn('docker', [...composeArgs, 'exec', '-T', 'mysql', 'sh', '-c', 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot'], { stdio: ['pipe', 'ignore', 'inherit'] });
    child.once('error', reject); child.stdin.on('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${kind} database provisioning failed`))); child.stdin.end(sql);
  });
}
export async function provisionDevelopment() { return provisionEnvironment('development'); }
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2];
    if (command === 'start') await startDatabase();
    else if (command === 'stop') { await ensureDatabaseCompose(); await run('docker', [...composeArgs, 'stop', 'mysql']); }
    else if (command === 'status') console.log(`MySQL: ${await databaseStatus() ? 'running' : 'stopped/unavailable'}`);
    else throw new Error('Usage: scripts/database.sh {start|stop|status}');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
