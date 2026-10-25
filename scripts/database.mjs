import { spawn } from 'node:child_process';
import { capture, run, withLock } from './host-common.mjs';
import { composeArguments, composeSettings, initializeConfiguration, readConfiguration } from './host-config.mjs';
import { pathToFileURL } from 'node:url';

export function databaseStatus(config) {
  if (!config) return false;
  try { return capture('docker', [...composeArguments(config), 'ps', '--status', 'running', '--services', 'mysql'], { env: composeSettings(config) }) === 'mysql'; } catch { return false; }
}
export async function startDatabase(config) {
  // An app start must never replace an existing shared database container to apply settings.
  await run('docker', [...composeArguments(config), 'up', '-d', '--wait', '--no-recreate', 'mysql'], { env: composeSettings(config) });
}
export async function provisionDevelopment(config) {
  const password = config.development.database.password;
  const database = config.development.database.name;
  const username = config.development.database.username;
  const sql = `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4;\nCREATE USER IF NOT EXISTS '${username}'@'%' IDENTIFIED BY '${password}';\nALTER USER '${username}'@'%' IDENTIFIED BY '${password}';\nGRANT ALL PRIVILEGES ON \`${database}\`.* TO '${username}'@'%';\n`;
  await new Promise((resolve, reject) => {
    const child = spawn('docker', [...composeArguments(config), 'exec', '-T', 'mysql', 'sh', '-c', 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot'], { env: composeSettings(config), stdio: ['pipe', 'ignore', 'inherit'] });
    child.once('error', reject); child.stdin.on('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Development database provisioning failed'))); child.stdin.end(sql);
  });
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2];
    if (command === 'start') await withLock(async () => startDatabase(await initializeConfiguration()));
    else if (command === 'stop') await withLock(async () => {
      const config = await readConfiguration(); if (!config) throw new Error('Run scripts/dev.sh init first');
      await run('docker', [...composeArguments(config), 'stop', 'mysql'], { env: composeSettings(config) });
    });
    else if (command === 'status') console.log(`MySQL: ${databaseStatus(await readConfiguration()) ? 'running' : 'stopped/unavailable'}`);
    else throw new Error('Usage: scripts/database.sh {start|stop|status}');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
