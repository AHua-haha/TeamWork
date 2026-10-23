import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { exists, processRecord, root, run, capture, showLogs, startService, stopService, withLock } from './host-common.mjs';
import { startDatabase } from './database.mjs';
import { backendSettings, hostEnvironment, initializeConfiguration, locations, readConfiguration } from './host-config.mjs';

let config;
try { config = await readConfiguration(); } catch (error) { console.error(error.message); process.exit(1); }
const { deployment } = locations(config);

const manifestPath = join(deployment, 'active.json');
const backPid = join(deployment, 'backend.pid'), frontPid = join(deployment, 'frontend.pid');

async function manifest() { return await exists(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : null; }
async function stop() {
  await stopService('Deployed frontend', frontPid);
  await stopService('Deployed backend', backPid);
}
async function saveManifest(value) {
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, manifestPath);
}
async function build(commit) {
  if (capture('git', ['-C', root, 'ls-tree', '--name-only', commit, '--', 'rsi.config.json'])) throw new Error('Refusing to deploy a revision containing private rsi.config.json');
  const temporaryRoot = resolve(config.paths.deploymentSourceRoot);
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const canonical = await realpath(temporaryRoot);
  const allowed = await Promise.all(['/tmp', tmpdir()].map(path => realpath(path)));
  if (!allowed.some(parent => { const part = relative(parent, canonical); return part && !part.startsWith('..') && !isAbsolute(part); })) throw new Error('paths.deploymentSourceRoot must be a subdirectory of temporary storage');
  const directory = join(canonical, `${commit.slice(0, 12)}-${randomUUID()}`), archive = `${directory}.tar`;
  await mkdir(directory, { mode: 0o700 });
  try {
    await run('git', ['-C', root, 'archive', '--format=tar', '--output', archive, commit]);
    await run('tar', ['-xf', archive, '-C', directory]);
    if (!await exists(join(directory, 'scripts/serve-frontend.mjs'))) throw new Error('Selected commit does not include host frontend serving support');
    for (const part of ['backend', 'frontend']) {
      await run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: join(directory, part) });
      await run('npm', ['run', 'build'], { cwd: join(directory, part) });
    }
    return { commit, directory };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  finally { await rm(archive, { force: true }); }
}
// Prior selected releases retain their original entry for restart and failed-update recovery.
async function backendEntry(directory) {
  const entry = join(directory, 'backend/dist/src/runtime/main.js');
  return await exists(entry) ? entry : join(directory, 'backend/dist/src/main.js');
}
async function launch(release) {
  const settings = backendSettings(config, 'deployment');
  const { backendPort, frontendPort } = config.deployment;
  await startDatabase(config);
  let startedBackend = false;
  try {
    startedBackend = await startService({ name: 'Deployed backend', entry: await backendEntry(release.directory), cwd: join(release.directory, 'backend'), env: { ...hostEnvironment(), ...settings, HOST: '127.0.0.1', PORT: String(backendPort), NODE_ENV: 'production' }, port: backendPort, url: `http://127.0.0.1:${backendPort}/agents`, pidFile: backPid, log: join(deployment, 'backend.log') });
    await startService({ name: 'Deployed frontend', entry: join(release.directory, 'scripts/serve-frontend.mjs'), cwd: release.directory, env: { ...hostEnvironment(), PORT: String(frontendPort), FRONTEND_DIST: join(release.directory, 'frontend/dist'), AGENT_BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}`, NODE_ENV: 'production' }, port: frontendPort, url: `http://127.0.0.1:${frontendPort}/`, pidFile: frontPid, log: join(deployment, 'frontend.log') });
  } catch (error) { if (startedBackend) await stopService('Deployed backend', backPid); throw error; }
}
async function start() {
  config = await initializeConfiguration();
  let selected = await manifest();
  if (!selected) throw new Error('No deployment selected; run scripts/deploy.sh deploy <git-ref>');
  if (!await exists(await backendEntry(selected.directory)) || !await exists(join(selected.directory, 'frontend/dist/index.html'))) {
    // An existing process may still be alive after /tmp cleanup; do not run a second database owner.
    await stop(); selected = await build(selected.commit);
  }
  await launch(selected); await saveManifest(selected);
}
function resolveCommit(ref) { return capture('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]); }
async function deploy(ref) {
  if (!ref) throw new Error('deploy requires an explicit local Git ref');
  config = await initializeConfiguration();
  const commit = resolveCommit(ref);
  const selected = await build(commit), previous = await manifest();
  const wasRunning = !!(await processRecord(backPid) || await processRecord(frontPid));
  try {
    await stop(); await launch(selected); await saveManifest(selected);
  } catch (error) {
    await stop();
    if (previous && wasRunning) {
      try { await launch(previous); }
      catch { throw new Error(`${error.message}; previous deployment recovery failed; inspect deployment logs`); }
    }
    throw error;
  }
  console.log(`Deployed commit ${commit}\nSource: ${selected.directory}\nState: ${deployment}`);
}
async function update(ref = 'HEAD') {
  const previous = await manifest();
  if (!previous) throw new Error('No deployment selected; run scripts/deploy.sh deploy <git-ref> first');
  const commit = resolveCommit(ref);
  if (commit === previous.commit) {
    await start();
    console.log(`Deployment is already at commit ${commit}`);
    return;
  }
  await deploy(commit);
}

try {
  const [command, argument] = process.argv.slice(2);
  if (command === 'status') {
    const selected = await manifest(); console.log(`Selected commit: ${selected?.commit ?? 'none'}\nSource: ${selected?.directory ?? 'none'}\nState: ${deployment}`);
    for (const [name, path] of [['Backend', backPid], ['Frontend', frontPid]]) { const record = await processRecord(path); console.log(`Deployed ${name}: ${record ? `running (PID ${record.pid})` : 'stopped'}`); }
  } else if (command === 'logs') await showLogs(deployment, argument);
  else if (['init', 'start', 'stop', 'restart', 'deploy', 'update'].includes(command)) await withLock(async () => {
    if (command === 'init') config = await initializeConfiguration();
    if (command === 'restart') config = await initializeConfiguration();
    if (command === 'stop' || command === 'restart') await stop();
    if (command === 'start' || command === 'restart') await start();
    if (command === 'deploy') await deploy(argument);
    if (command === 'update') await update(argument);
  });
  else throw new Error('Usage: scripts/deploy.sh {init|deploy <git-ref>|update [git-ref]|start|stop|restart|status|logs [backend|frontend]}');
} catch (error) { console.error(error.message); process.exitCode = 1; }
