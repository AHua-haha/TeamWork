import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root, hostEnvironment, initializeConfiguration, locations } from './host-config.mjs';
export { root } from './host-config.mjs';

export async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
export function capture(command, args, options = {}) { return execFileSync(command, args, { encoding: 'utf8', env: hostEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim(); }
export async function run(command, args, options = {}) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: hostEnvironment(), ...options });
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
  const configId = createHash('sha256').update(JSON.stringify({ entry, entryArgs, port, env: Object.fromEntries(Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) })).digest('hex');
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
  const state = locations(await initializeConfiguration()).developmentRun;
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
