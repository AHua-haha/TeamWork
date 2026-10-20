import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function port() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
function command(root, env, script, ...args) {
  return new Promise(resolve => {
    const child = spawn('bash', [join(root, 'scripts', script + '.sh'), ...args], { env }); let output = '';
    child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    child.once('exit', code => resolve({ code, output })); child.once('error', error => resolve({ code: -1, output: error.message }));
  });
}
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'rsi-deploy-test-')), root = join(directory, 'repo'), state = join(directory, 'state');
  await mkdir(root); await cp(join(project, 'scripts'), join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'backend')); await mkdir(join(root, 'frontend')); await mkdir(join(directory, 'bin'));
  await writeFile(join(root, '.gitignore'), '.env\nnode_modules/\ndist/\n.run/\n');
  await writeFile(join(root, 'backend/.env.example'), 'DATABASE_URL=mysql://rsi_dev:rsi_dev@127.0.0.1:3306/rsi_agent_dev\n');
  const key = randomBytes(32).toString('base64');
  await writeFile(join(root, 'backend/.env'), `DATABASE_URL=mysql://rsi:rsi@127.0.0.1:3306/rsi_agent\nCONFIG_ENCRYPTION_KEY=${key}\nDEEPSEEK_WEB_API_KEY=retained-test-key\n`);
  await writeFile(join(root, 'backend/main.mjs'), `import{createServer}from'node:http';const s=createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({database:new URL(process.env.DATABASE_URL).pathname,version:'first'}));});s.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>{s.close();s.closeAllConnections();});`);
  for (const part of ['backend', 'frontend']) {
    await writeFile(join(root, part, 'package.json'), JSON.stringify({ name: `fixture-${part}`, version: '1.0.0', type: 'module', scripts: { build: 'node build.mjs' } }));
    await writeFile(join(root, part, 'package-lock.json'), JSON.stringify({ name: `fixture-${part}`, version: '1.0.0', lockfileVersion: 3, packages: { '': { name: `fixture-${part}`, version: '1.0.0' } } }));
  }
  await writeFile(join(root, 'backend/build.mjs'), `import{mkdir,copyFile}from'node:fs/promises';await mkdir('dist/src',{recursive:true});await copyFile('main.mjs','dist/src/main.js');`);
  await writeFile(join(root, 'frontend/build.mjs'), `import{mkdir,writeFile}from'node:fs/promises';await mkdir('dist',{recursive:true});await writeFile('dist/index.html','<h1>Snapshot</h1>');`);
  await writeFile(join(directory, 'bin/docker'), `#!/usr/bin/env node\nif(process.argv.includes('ps'))console.log('mysql');else if(process.argv.includes('exec'))process.stdin.resume();\n`, { mode: 0o755 });
  git(root, 'init', '-q'); git(root, 'add', '.'); git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
  const env = { ...process.env, PATH: join(directory, 'bin') + ':' + process.env.PATH, RSI_STATE_DIR: state, RSI_DEPLOY_ROOT: join(directory, 'sources'), RSI_DEPLOY_BACKEND_PORT: String(await port()), RSI_DEPLOY_FRONTEND_PORT: String(await port()), DATABASE_URL: 'mysql://wrong:wrong@localhost/should_not_inherit' };
  const call = async (...args) => command(root, env, ...args);
  try { await run({ root, directory, state, env, key, call }); }
  finally { await call('deploy', 'stop'); await rm(directory, { recursive: true, force: true }); }
}

test('initialization preserves deployment credentials and creates independent development settings once', () => fixture(async f => {
  let result = await f.call('deploy', 'init'); assert.equal(result.code, 0, result.output);
  const production = parseEnv(await readFile(join(f.state, 'deploy/backend.env'), 'utf8'));
  const devPath = join(f.root, 'backend/.env'); const development = parseEnv(await readFile(devPath, 'utf8'));
  assert.equal(production.CONFIG_ENCRYPTION_KEY, f.key); assert.equal(production.DEEPSEEK_WEB_API_KEY, 'retained-test-key');
  assert.equal(new URL(production.DATABASE_URL).pathname, '/rsi_agent'); assert.equal(new URL(development.DATABASE_URL).pathname, '/rsi_agent_dev');
  assert.notEqual(development.CONFIG_ENCRYPTION_KEY, f.key); assert.equal(development.DEEPSEEK_WEB_API_KEY, undefined);
  assert.equal((await stat(join(f.state, 'deploy/backend.env'))).mode & 0o777, 0o600);
  result = await f.call('dev', 'init'); assert.equal(result.code, 0, result.output);
  assert.deepEqual(parseEnv(await readFile(devPath, 'utf8')), development);
}));

test('deploy isolates committed source, preserves running release on build failure, restores it on launch failure, and rebuilds after tmp cleanup', { timeout: 60_000 }, () => fixture(async f => {
  const initial = git(f.root, 'rev-parse', 'HEAD');
  await writeFile(join(f.root, 'uncommitted.txt'), 'must not deploy');
  let result = await f.call('deploy', 'deploy', initial); assert.equal(result.code, 0, result.output);
  const manifestPath = join(f.state, 'deploy/active.json'); let active = JSON.parse(await readFile(manifestPath));
  assert.equal(active.commit, initial); await assert.rejects(readFile(join(active.directory, 'uncommitted.txt')));
  await assert.rejects(readFile(join(active.directory, 'backend/.env')));
  const url = `http://127.0.0.1:${f.env.RSI_DEPLOY_FRONTEND_PORT}`;
  assert.match(await (await fetch(url)).text(), /Snapshot/); assert.equal((await (await fetch(url + '/agents')).json()).database, '/rsi_agent');
  const firstPid = await readFile(join(f.state, 'deploy/backend.pid'), 'utf8');
  result = await f.call('deploy', 'start'); assert.equal(result.code, 0, result.output); assert.equal(await readFile(join(f.state, 'deploy/backend.pid'), 'utf8'), firstPid);
  await writeFile(join(f.root, 'backend/build.mjs'), 'process.exit(7)'); git(f.root, 'add', '.'); git(f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'bad build');
  result = await f.call('deploy', 'deploy', 'HEAD'); assert.notEqual(result.code, 0); assert.equal((JSON.parse(await readFile(manifestPath))).commit, initial); assert.equal(await readFile(join(f.state, 'deploy/backend.pid'), 'utf8'), firstPid);
  git(f.root, 'checkout', initial, '--', 'backend/build.mjs'); await writeFile(join(f.root, 'backend/main.mjs'), 'process.exit(8)'); git(f.root, 'add', '.'); git(f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'bad launch');
  result = await f.call('deploy', 'deploy', 'HEAD'); assert.notEqual(result.code, 0);
  assert.equal((await (await fetch(url + '/agents')).json()).version, 'first'); assert.equal((JSON.parse(await readFile(manifestPath))).commit, initial);
  result = await f.call('deploy', 'stop'); assert.equal(result.code, 0, result.output);
  await rm(active.directory, { recursive: true, force: true });
  result = await f.call('deploy', 'start'); assert.equal(result.code, 0, result.output);
  active = JSON.parse(await readFile(manifestPath)); assert.equal(active.commit, initial); assert.equal((await (await fetch(url + '/agents')).json()).version, 'first');
  result = await f.call('dev', 'stop'); assert.equal(result.code, 0, result.output);
  assert.equal((await (await fetch(url + '/agents')).json()).database, '/rsi_agent');
}));

test('foreign process ownership and a conflicting port are never taken over; status needs no source', () => fixture(async f => {
  await f.call('deploy', 'init');
  const foreign = createServer(); foreign.listen(Number(f.env.RSI_DEPLOY_BACKEND_PORT), '127.0.0.1'); await once(foreign, 'listening');
  try {
    const result = await f.call('deploy', 'deploy', 'HEAD'); assert.notEqual(result.code, 0); assert.match(result.output, /occupied/);
    assert.equal(foreign.listening, true);
    const start = execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
    await writeFile(join(f.state, 'deploy/backend.pid'), `${process.pid}\n${start}\nnot-this-process-entry\n`);
    assert.equal((await f.call('deploy', 'stop')).code, 0); assert.equal(foreign.listening, true);
    const status = await f.call('deploy', 'status'); assert.equal(status.code, 0); assert.match(status.output, /Selected commit: none/);
  } finally { await new Promise(resolve => foreign.close(resolve)); }
}));


test('lifecycle mutations exclude one another and stale lock owners recover without signaling them', { timeout: 30_000 }, () => fixture(async f => {
  await writeFile(join(f.root, 'backend/build.mjs'), `import{setTimeout}from'node:timers/promises';import{mkdir,copyFile}from'node:fs/promises';await setTimeout(800);await mkdir('dist/src',{recursive:true});await copyFile('main.mjs','dist/src/main.js');`);
  git(f.root, 'add', '.'); git(f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'slow build');
  const deploying = f.call('deploy', 'deploy', 'HEAD');
  const lock = join(f.state, 'manage.lock');
  let locked = false;
  for (let attempt = 0; attempt < 100; attempt++) { try { JSON.parse(await readFile(lock)); locked = true; break; } catch { await delay(10); } }
  assert.equal(locked, true);
  const conflict = await f.call('deploy', 'init'); assert.notEqual(conflict.code, 0); assert.match(conflict.output, /Another environment lifecycle command/);
  assert.equal((await deploying).code, 0);
  await writeFile(lock, JSON.stringify({ pid: process.pid, start: 'not-this-process-start' }));
  const recovered = await f.call('deploy', 'init'); assert.equal(recovered.code, 0, recovered.output);
}));
