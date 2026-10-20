import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { deployment, deploymentEnv, envFile, exists, initializeEnvironments, processRecord, root, run, capture, showLogs, startService, stopService, validateEnvironment, withLock } from './host-common.mjs';
import { startDatabase } from './database.mjs';

const manifestPath = join(deployment, 'active.json');
const backPid = join(deployment, 'backend.pid'), frontPid = join(deployment, 'frontend.pid');
const backendPort = Number(process.env.RSI_DEPLOY_BACKEND_PORT ?? 3001), frontendPort = Number(process.env.RSI_DEPLOY_FRONTEND_PORT ?? 5274);
if (![backendPort, frontendPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535) || backendPort === frontendPort) throw new Error('Deployment ports must be distinct valid ports');
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
  const temporaryRoot = resolve(process.env.RSI_DEPLOY_ROOT ?? '/tmp/rsi-agent-deploy');
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const canonical = await realpath(temporaryRoot);
  const allowed = await Promise.all(['/tmp', tmpdir()].map(path => realpath(path)));
  if (!allowed.some(parent => { const part = relative(parent, canonical); return part && !part.startsWith('..') && !isAbsolute(part); })) throw new Error('RSI_DEPLOY_ROOT must be a subdirectory of temporary storage');
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
async function launch(release) {
  const settings = await envFile(deploymentEnv); validateEnvironment(settings, 'rsi_agent');
  await startDatabase();
  let startedBackend = false;
  try {
    startedBackend = await startService({ name: 'Deployed backend', entry: join(release.directory, 'backend/dist/src/main.js'), cwd: join(release.directory, 'backend'), env: { ...process.env, ...settings, HOST: '127.0.0.1', PORT: String(backendPort), NODE_ENV: 'production' }, port: backendPort, url: `http://127.0.0.1:${backendPort}/agents`, pidFile: backPid, log: join(deployment, 'backend.log') });
    await startService({ name: 'Deployed frontend', entry: join(release.directory, 'scripts/serve-frontend.mjs'), cwd: release.directory, env: { ...process.env, PORT: String(frontendPort), FRONTEND_DIST: join(release.directory, 'frontend/dist'), AGENT_BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}`, NODE_ENV: 'production' }, port: frontendPort, url: `http://127.0.0.1:${frontendPort}/`, pidFile: frontPid, log: join(deployment, 'frontend.log') });
  } catch (error) { if (startedBackend) await stopService('Deployed backend', backPid); throw error; }
}
async function start() {
  await initializeEnvironments();
  let selected = await manifest();
  if (!selected) throw new Error('No deployment selected; run scripts/deploy.sh deploy <git-ref>');
  if (!await exists(join(selected.directory, 'backend/dist/src/main.js')) || !await exists(join(selected.directory, 'frontend/dist/index.html'))) {
    // An existing process may still be alive after /tmp cleanup; do not run a second database owner.
    await stop(); selected = await build(selected.commit);
  }
  await launch(selected); await saveManifest(selected);
}
async function deploy(ref) {
  if (!ref) throw new Error('deploy requires an explicit local Git ref');
  await initializeEnvironments();
  const commit = capture('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
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
try {
  const [command, argument] = process.argv.slice(2);
  if (command === 'status') {
    const selected = await manifest(); console.log(`Selected commit: ${selected?.commit ?? 'none'}\nSource: ${selected?.directory ?? 'none'}\nState: ${deployment}`);
    for (const [name, path] of [['Backend', backPid], ['Frontend', frontPid]]) { const record = await processRecord(path); console.log(`Deployed ${name}: ${record ? `running (PID ${record.pid})` : 'stopped'}`); }
  } else if (command === 'logs') await showLogs(deployment, argument);
  else if (['init', 'start', 'stop', 'restart', 'deploy'].includes(command)) await withLock(async () => {
    if (command === 'init') await initializeEnvironments();
    if (command === 'stop' || command === 'restart') await stop();
    if (command === 'start' || command === 'restart') await start();
    if (command === 'deploy') await deploy(argument);
  });
  else throw new Error('Usage: scripts/deploy.sh {init|deploy <git-ref>|start|stop|restart|status|logs [backend|frontend]}');
} catch (error) { console.error(error.message); process.exitCode = 1; }
