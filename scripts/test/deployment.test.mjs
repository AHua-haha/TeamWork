import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
  const directory = await mkdtemp(join(tmpdir(), 'rsi-deploy-test-')), root = join(directory, 'repo');
  await mkdir(root); await cp(join(project, 'scripts'), join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'backend')); await mkdir(join(root, 'frontend')); await mkdir(join(directory, 'bin'));
  await writeFile(join(root, '.gitignore'), '.env\nnode_modules/\ndist/\n.run/\noperations.config.json\n.operations/\n');
  const key = randomBytes(32).toString('base64');
  const deployRoot = join('/tmp', `rsi-deploy-test-${randomBytes(8).toString('hex')}`);
  const config = { stateDirectory: '.operations', deployRoot, database: { containerName: 'rsi-agent-test-mysql', volumeName: 'rsi-agent-test-mysql-data', image: 'mysql:8.4', port: await port(), rootPassword: 'root-secret-test' }, development: { backendPort: await port(), frontendPort: await port(), database: 'rsi_agent_dev', username: 'rsi_dev', password: 'dev-secret-test', encryptionKey: randomBytes(32).toString('base64'), deepseekWebApiKey: '' }, deployment: { backendPort: await port(), frontendPort: await port(), database: 'rsi_agent', username: 'rsi', password: 'prod-secret-test', encryptionKey: key, deepseekWebApiKey: 'retained-test-key' } };
  await writeFile(join(root, 'operations.config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
  await writeFile(join(root, 'backend/main.mjs'), `import{createServer}from'node:http';const s=createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({database:new URL(process.env.DATABASE_URL).pathname,version:'first',foreign:process.env.FOREIGN_SECRET??null}));});s.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>{s.close();s.closeAllConnections();});`);
  for (const part of ['backend', 'frontend']) {
    await writeFile(join(root, part, 'package.json'), JSON.stringify({ name: `fixture-${part}`, version: '1.0.0', type: 'module', scripts: { build: 'node build.mjs' } }));
    await writeFile(join(root, part, 'package-lock.json'), JSON.stringify({ name: `fixture-${part}`, version: '1.0.0', lockfileVersion: 3, packages: { '': { name: `fixture-${part}`, version: '1.0.0' } } }));
  }
  await writeFile(join(root, 'backend/build.mjs'), `import{mkdir,copyFile}from'node:fs/promises';await mkdir('dist/src',{recursive:true});await copyFile('main.mjs','dist/src/main.js');`);
  await writeFile(join(root, 'frontend/build.mjs'), `import{mkdir,writeFile}from'node:fs/promises';await mkdir('dist',{recursive:true});await writeFile('dist/index.html','<h1>Snapshot</h1>');`);
  const owner = 'sha256:' + createHash('sha256').update(await realpath(root)).digest('hex');
  await writeFile(join(directory, 'bin/docker'), `#!/usr/bin/env node\nconst a=process.argv.slice(2), c=${JSON.stringify(config)}, owner=${JSON.stringify(owner)}; if(a[0]==='inspect'||(a[0]==='volume'&&a[1]==='inspect')){const isVolume=a[0]==='volume',n=a[isVolume?2:1];if(isVolume)console.log(JSON.stringify([{Name:c.database.volumeName,Labels:{'org.teamwork.operations.owner':owner,'org.teamwork.operations.service':c.database.containerName}}]));else console.log(JSON.stringify([{Config:{Image:c.database.image,Env:['MYSQL_ROOT_PASSWORD='+c.database.rootPassword],Labels:{'org.teamwork.operations.owner':owner,'org.teamwork.operations.service':c.database.containerName}},HostConfig:{PortBindings:{'3306/tcp':[{HostIp:'127.0.0.1',HostPort:String(c.database.port)}]}},Mounts:[{Destination:'/var/lib/mysql',Name:c.database.volumeName}],State:{Running:true,Health:'healthy'}}]));} else if(a[0]==='exec')process.stdin.resume();else if(a[0]==='volume'||a[0]==='run'||a[0]==='start'||a[0]==='stop'){}else process.exit(0);\n`, { mode: 0o755 });
  git(root, 'init', '-q'); git(root, 'add', '.'); git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
  const env = { PATH: join(directory, 'bin') + ':' + process.env.PATH, HOME: directory, FOREIGN_SECRET: 'must-not-leak', DATABASE_URL: 'mysql://wrong:wrong@localhost/should_not_inherit', CONFIG_ENCRYPTION_KEY: 'wrong', PORT: '1', RSI_STATE_DIR: directory, RSI_DEPLOY_ROOT: directory };
  const call = async (...args) => command(root, env, ...args);
  try { await run({ root, directory, config, env, key, call }); }
  finally { await call('deploy', 'stop'); await rm(directory, { recursive: true, force: true }); await rm(config.deployRoot, { recursive: true, force: true }); }
}

test('root config is private, authoritative, and environment variables do not leak into the app', () => fixture(async f => {
  const result = await f.call('deploy', 'init'); assert.equal(result.code, 0, result.output);
  const file = await readFile(join(f.root, 'operations.config.json'), 'utf8'); assert.deepEqual(JSON.parse(file), f.config);
  assert.equal((await stat(join(f.root, 'operations.config.json'))).mode & 0o777, 0o600);
  assert.notEqual(f.config.development.encryptionKey, f.config.deployment.encryptionKey);
  result && assert.match(file, /root-secret-test/);
}));

test('deploy isolates committed source, reports URLs, preserves running release on build failure and rebuilds after cleanup', { timeout: 90000 }, () => fixture(async f => {
  const initial = git(f.root, 'rev-parse', 'HEAD');
  let result = await f.call('deploy', 'deploy', initial); assert.equal(result.code, 0, result.output);
  assert.match(result.output, new RegExp(`Frontend: http://127\\.0\\.0\\.1:${f.config.deployment.frontendPort}`));
  const manifestPath = join(f.root, '.operations/deploy/active.json'); let active = JSON.parse(await readFile(manifestPath));
  assert.equal(active.commit, initial); await assert.rejects(readFile(join(active.directory, 'uncommitted.txt')));
  const url = `http://127.0.0.1:${f.config.deployment.frontendPort}`;
  assert.match(await (await fetch(url)).text(), /Snapshot/);
  const data = await (await fetch(url + '/agents')).json(); assert.equal(data.database, '/rsi_agent'); assert.equal(data.foreign, null);
  const firstPid = await readFile(join(f.root, '.operations/deploy/backend.pid'), 'utf8');
  result = await f.call('deploy', 'start'); assert.equal(result.code, 0, result.output); assert.equal(await readFile(join(f.root, '.operations/deploy/backend.pid'), 'utf8'), firstPid);
  await writeFile(join(f.root, 'backend/build.mjs'), 'process.exit(7)'); git(f.root, 'add', '.'); git(f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'bad build');
  result = await f.call('deploy', 'deploy', 'HEAD'); assert.notEqual(result.code, 0); assert.equal((JSON.parse(await readFile(manifestPath))).commit, initial); assert.equal(await readFile(join(f.root, '.operations/deploy/backend.pid'), 'utf8'), firstPid);
  result = await f.call('deploy', 'stop'); assert.equal(result.code, 0, result.output);
  await rm(active.directory, { recursive: true, force: true }); result = await f.call('deploy', 'start'); assert.equal(result.code, 0, result.output);
  assert.equal((await (await fetch(url + '/agents')).json()).database, '/rsi_agent');
  result = await f.call('deploy', 'status'); assert.match(result.output, /Frontend URL:/);
}));

test('foreign process on configured port is never taken over and status does not require source', () => fixture(async f => {
  const foreign = createServer(); foreign.listen(f.config.deployment.backendPort, '127.0.0.1'); await once(foreign, 'listening');
  try {
    const result = await f.call('deploy', 'deploy', 'HEAD'); assert.notEqual(result.code, 0); assert.match(result.output, /occupied/); assert.equal(foreign.listening, true);
    const status = await f.call('deploy', 'status'); assert.equal(status.code, 0); assert.match(status.output, /Selected commit: none/);
  } finally { await new Promise(resolve => foreign.close(resolve)); }
}));

test('database status invocation does not modify root configuration', () => fixture(async f => {
  const before = await readFile(join(f.root, 'operations.config.json'), 'utf8');
  const result = await new Promise(resolve => { const child = spawn('bash', [join(f.root, 'scripts/database.sh'), 'status'], { cwd: f.root, env: f.env }); let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk); child.once('exit', code => resolve({ code, output })); });
  assert.equal(await readFile(join(f.root, 'operations.config.json'), 'utf8'), before);
  assert.equal(result.code, 0, result.output);
}));
