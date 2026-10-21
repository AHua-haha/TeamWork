import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile, symlink, chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
  const directory = await mkdtemp(join(tmpdir(), 'rsi-deploy-test-')), root = join(directory, 'repo'), home = join(directory, 'home'), state = join(home, '.local/state/rsi-agent');
  await mkdir(home); await mkdir(root); await cp(join(project, 'scripts'), join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'backend')); await mkdir(join(root, 'frontend')); await mkdir(join(directory, 'bin'));
  await writeFile(join(root, '.gitignore'), '.env\nrsi.config.json\nnode_modules/\ndist/\n.run/\n');
  await writeFile(join(root, 'backend/.env.example'), 'DATABASE_URL=mysql://rsi_dev:rsi_dev@127.0.0.1:3306/rsi_agent_dev\n');
  const key = randomBytes(32).toString('base64');
  await writeFile(join(root, 'backend/.env'), `DATABASE_URL=mysql://rsi:rsi@127.0.0.1:3306/rsi_agent\nCONFIG_ENCRYPTION_KEY=${key}\nDEEPSEEK_WEB_API_KEY=retained-test-key\n`);
  await writeFile(join(root, 'backend/main.mjs'), `import{createServer}from'node:http';const s=createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({database:new URL(process.env.DATABASE_URL).pathname,version:'first',webKey:process.env.DEEPSEEK_WEB_API_KEY??null,unrelated:process.env.UNRELATED_SECRET??null,nodeOptions:process.env.NODE_OPTIONS??null,proxy:process.env.HTTP_PROXY??null}));});s.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>{s.close();s.closeAllConnections();});`);
  for (const part of ['backend', 'frontend']) {
    await writeFile(join(root, part, 'package.json'), JSON.stringify({ name: `fixture-${part}`, version: '1.0.0', type: 'module', scripts: { build: 'node build.mjs' } }));
    await writeFile(join(root, part, 'package-lock.json'), JSON.stringify({ name: `fixture-${part}`, version: '1.0.0', lockfileVersion: 3, packages: { '': { name: `fixture-${part}`, version: '1.0.0' } } }));
  }
  await writeFile(join(root, 'backend/build.mjs'), `import{mkdir,copyFile}from'node:fs/promises';await mkdir('dist/src',{recursive:true});await copyFile('main.mjs','dist/src/main.js');`);
  await writeFile(join(root, 'frontend/build.mjs'), `import{mkdir,writeFile}from'node:fs/promises';await mkdir('dist',{recursive:true});await writeFile('dist/index.html','<h1>Snapshot</h1>');`);
  await writeFile(join(directory, 'bin/docker'), `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(join(directory,'docker-calls.jsonl'))},JSON.stringify({args:process.argv.slice(2),composeProject:process.env.COMPOSE_PROJECT_NAME??null,dockerContext:process.env.DOCKER_CONTEXT??null,nodeOptions:process.env.NODE_OPTIONS??null,mysqlPort:process.env.RSI_MYSQL_PORT??null})+'\\n');if(process.argv.includes('context'))console.log('fixture-context');else if(process.argv.includes('ps'))console.log('mysql');else if(process.argv.includes('exec'))process.stdin.resume();\n`, { mode: 0o755 });
  git(root, 'init', '-q'); git(root, 'add', '.'); git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
  const configPath = join(root, 'rsi.config.json');
  const config = {
    version: 1,
    paths: { stateDirectory: state, developmentStateDirectory: join(root, '.run'), deploymentSourceRoot: join(directory, 'sources') },
    mysql: { host: '127.0.0.1', port: 3306, project: 'backend', dockerContext: 'fixture-context', rootPassword: 'fixture-root' },
    development: { backendPort: await port(), frontendPort: await port(), database: { name: 'rsi_agent_dev', username: 'rsi_dev', password: 'rsi_dev' }, encryptionKey: randomBytes(32).toString('base64'), environment: {} },
    deployment: { backendPort: await port(), frontendPort: await port(), database: { name: 'rsi_agent', username: 'rsi', password: 'rsi' }, encryptionKey: key, environment: { DEEPSEEK_WEB_API_KEY: 'retained-test-key' } },
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const env = { ...process.env, HOME: home, PATH: join(directory, 'bin') + ':' + process.env.PATH, RSI_STATE_DIR: join(directory, 'wrong-state'), RSI_DEPLOY_ROOT: '/wrong-source', RSI_DEPLOY_BACKEND_PORT: '1', RSI_DEPLOY_FRONTEND_PORT: '2', DATABASE_URL: 'mysql://wrong:wrong@localhost/should_not_inherit', PORT: '1', CONFIG_ENCRYPTION_KEY: 'wrong-key', DEEPSEEK_WEB_API_KEY: 'wrong-provider-key', UNRELATED_SECRET: 'must-not-inherit', COMPOSE_PROJECT_NAME: 'unrelated-service', COMPOSE_FILE: '/wrong-compose', DOCKER_CONTEXT: 'wrong-context', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', NODE_OPTIONS: '--require=/wrong-service-preload.cjs' };
  const call = async (...args) => command(root, env, ...args);
  try { await run({ root, directory, state, env, key, call, config, configPath, home }); }
  finally { await call('deploy', 'stop'); await rm(directory, { recursive: true, force: true }); }
}

test('initialization imports legacy credentials once into a private project file without modifying old files', () => fixture(async f => {
  await rm(f.configPath);
  const oldPath = join(f.root, 'backend/.env'), original = await readFile(oldPath, 'utf8');
  let result = await f.call('deploy', 'init'); assert.equal(result.code, 0, result.output);
  const config = JSON.parse(await readFile(f.configPath, 'utf8'));
  assert.equal(config.deployment.encryptionKey, f.key);
  assert.equal(config.deployment.environment.DEEPSEEK_WEB_API_KEY, 'retained-test-key');
  assert.equal(config.mysql.port, 3306); assert.equal(config.mysql.dockerContext, 'fixture-context');
  assert.equal(config.deployment.database.name, 'rsi_agent'); assert.equal(config.development.database.name, 'rsi_agent_dev');
  assert.notEqual(config.development.encryptionKey, f.key);
  assert.equal((await stat(f.configPath)).mode & 0o777, 0o600);
  assert.equal(await readFile(oldPath, 'utf8'), original);
  const saved = await readFile(f.configPath, 'utf8');
  await writeFile(oldPath, 'DATABASE_URL=mysql://wrong:wrong@127.0.0.1:4211/wrong\n');
  result = await f.call('dev', 'init'); assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(f.configPath, 'utf8'), saved, 'legacy changes are ignored after import');
  await assert.rejects(readFile(join(f.state, 'deploy/backend.env')));
}));

test('deploy isolates committed source, preserves running release on build failure, restores it on launch failure, and rebuilds after tmp cleanup', { timeout: 60_000 }, () => fixture(async f => {
  const initial = git(f.root, 'rev-parse', 'HEAD');
  await writeFile(join(f.root, 'uncommitted.txt'), 'must not deploy');
  let result = await f.call('deploy', 'deploy', initial); assert.equal(result.code, 0, result.output);
  const manifestPath = join(f.state, 'deploy/active.json'); let active = JSON.parse(await readFile(manifestPath));
  assert.equal(active.commit, initial); await assert.rejects(readFile(join(active.directory, 'uncommitted.txt')));
  await assert.rejects(readFile(join(active.directory, 'backend/.env')));
  await assert.rejects(readFile(join(active.directory, 'rsi.config.json')));
  const url = `http://127.0.0.1:${f.config.deployment.frontendPort}`;
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
  const foreign = createServer(); foreign.listen(Number(f.config.deployment.backendPort), '127.0.0.1'); await once(foreign, 'listening');
  try {
    const result = await f.call('deploy', 'deploy', 'HEAD'); assert.notEqual(result.code, 0); assert.match(result.output, /occupied/);
    assert.equal(foreign.listening, true);
    const start = execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
    await mkdir(join(f.state, 'deploy'), { recursive: true });
    await writeFile(join(f.state, 'deploy/backend.pid'), `${process.pid}\n${start}\nnot-this-process-entry\n`);
    assert.equal((await f.call('deploy', 'stop')).code, 0); assert.equal(foreign.listening, true);
    const status = await f.call('deploy', 'status'); assert.equal(status.code, 0); assert.match(status.output, /Selected commit: none/);
  } finally { await new Promise(resolve => foreign.close(resolve)); }
}));


test('lifecycle mutations exclude one another and stale lock owners recover without signaling them', { timeout: 30_000 }, () => fixture(async f => {
  await writeFile(join(f.root, 'backend/build.mjs'), `import{setTimeout}from'node:timers/promises';import{mkdir,copyFile}from'node:fs/promises';await setTimeout(800);await mkdir('dist/src',{recursive:true});await copyFile('main.mjs','dist/src/main.js');`);
  git(f.root, 'add', '.'); git(f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'slow build');
  const deploying = f.call('deploy', 'deploy', 'HEAD');
  const lock = join(f.root, '.run/manage.lock');
  let locked = false;
  for (let attempt = 0; attempt < 100; attempt++) { try { JSON.parse(await readFile(lock)); locked = true; break; } catch { await delay(10); } }
  assert.equal(locked, true);
  const conflict = await f.call('deploy', 'init'); assert.notEqual(conflict.code, 0); assert.match(conflict.output, /Another environment lifecycle command/);
  assert.equal((await deploying).code, 0);
  await writeFile(lock, JSON.stringify({ pid: process.pid, start: 'not-this-process-start' }));
  const recovered = await f.call('deploy', 'init'); assert.equal(recovered.code, 0, recovered.output);
}));

test('update defaults to committed HEAD, reuses the same version, accepts a ref and preserves deployment on invalid input', { timeout: 30_000 }, () => fixture(async f => {
  let result = await f.call('deploy', 'update'); assert.notEqual(result.code, 0); assert.match(result.output, /deploy <git-ref> first/);
  result = await f.call('deploy', 'deploy', 'HEAD'); assert.equal(result.code, 0, result.output);
  const initial = git(f.root, 'rev-parse', 'HEAD');
  const state = join(f.state, 'deploy'), selected = () => readFile(join(state, 'active.json'), 'utf8').then(JSON.parse);
  const settings = await readFile(f.configPath, 'utf8');
  const development = await readFile(join(f.root, 'backend/.env'), 'utf8');
  const source = await readFile(join(f.root, 'backend/main.mjs'), 'utf8');
  await writeFile(join(f.root, 'backend/main.mjs'), source.replace("version:'first'", "version:'second'"));
  git(f.root, 'add', 'backend/main.mjs'); git(f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'version two');
  const newer = git(f.root, 'rev-parse', 'HEAD');
  await writeFile(join(f.root, 'backend/main.mjs'), source.replace("version:'first'", "version:'uncommitted'"));
  result = await f.call('deploy', 'update'); assert.equal(result.code, 0, result.output);
  assert.equal((await selected()).commit, newer);
  const url = `http://127.0.0.1:${f.config.deployment.frontendPort}/agents`;
  assert.equal((await (await fetch(url)).json()).version, 'second');
  const backendPid = await readFile(join(state, 'backend.pid'), 'utf8'), frontendPid = await readFile(join(state, 'frontend.pid'), 'utf8');
  result = await f.call('deploy', 'update'); assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(join(state, 'backend.pid'), 'utf8'), backendPid); assert.equal(await readFile(join(state, 'frontend.pid'), 'utf8'), frontendPid);
  result = await f.call('deploy', 'update', 'missing-version'); assert.notEqual(result.code, 0);
  assert.equal((await selected()).commit, newer); assert.equal(await readFile(join(state, 'backend.pid'), 'utf8'), backendPid);
  result = await f.call('deploy', 'update', initial); assert.equal(result.code, 0, result.output);
  assert.equal((await selected()).commit, initial); assert.equal((await (await fetch(url)).json()).version, 'first');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), newer); assert.match(await readFile(join(f.root, 'backend/main.mjs'), 'utf8'), /uncommitted/);
  assert.equal(await readFile(f.configPath, 'utf8'), settings); assert.equal(await readFile(join(f.root, 'backend/.env'), 'utf8'), development);
}));


test('polluted shell settings and legacy env files cannot override either service or modify unrelated services', { timeout: 30_000 }, () => fixture(async f => {
  const profile = join(f.home, '.bashrc'), profileText = '# Other service owns this profile\nexport DATABASE_URL=unrelated\n';
  await writeFile(profile, profileText);
  const legacy = await readFile(join(f.root, 'backend/.env'), 'utf8');
  await writeFile(join(f.root, 'backend/.env'), legacy + 'PORT=1\nCOMPOSE_PROJECT_NAME=foreign\n');
  const oldFile = await readFile(join(f.root, 'backend/.env'), 'utf8');
  const main = await readFile(join(f.root, 'backend/main.mjs'), 'utf8');
  await mkdir(join(f.root, 'backend/src'), { recursive: true });
  await mkdir(join(f.root, 'backend/node_modules'), { recursive: true });
  await symlink(join(project, 'backend/node_modules/tsx'), join(f.root, 'backend/node_modules/tsx'));
  await writeFile(join(f.root, 'backend/src/main.ts'), main);
  await mkdir(join(f.root, 'frontend/node_modules/vite/bin'), { recursive: true });
  await writeFile(join(f.root, 'frontend/node_modules/vite/bin/vite.js'), `const http=require('node:http');const s=http.createServer((q,r)=>r.end(process.env.AGENT_BACKEND_ORIGIN));s.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>{s.close();s.closeAllConnections()});`);
  let result = await f.call('deploy', 'deploy', 'HEAD'); assert.equal(result.code, 0, result.output);
  const deployed = () => fetch(`http://127.0.0.1:${f.config.deployment.frontendPort}/agents`).then(r => r.json());
  assert.deepEqual(await deployed(), { database: '/rsi_agent', version: 'first', webKey: 'retained-test-key', unrelated: null, nodeOptions: null, proxy: null });
  try {
    result = await f.call('dev', 'start'); assert.equal(result.code, 0, result.output);
    const dev = await (await fetch(`http://127.0.0.1:${f.config.development.backendPort}/agents`)).json();
    assert.deepEqual(dev, { database: '/rsi_agent_dev', version: 'first', webKey: null, unrelated: null, nodeOptions: null, proxy: null });
    assert.equal(await (await fetch(`http://127.0.0.1:${f.config.development.frontendPort}`)).text(), `http://127.0.0.1:${f.config.development.backendPort}`);
    assert.equal(await readFile(join(f.root, 'backend/.env'), 'utf8'), oldFile);
    assert.equal(await readFile(profile, 'utf8'), profileText);
    const calls = (await readFile(join(f.directory, 'docker-calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    for (const call of calls) { assert.equal(call.composeProject, null); assert.equal(call.dockerContext, null); assert.equal(call.nodeOptions, null); assert.ok(call.args.includes('--context')); assert.ok(call.args.includes('/dev/null')); assert.ok(!call.args.includes('use')); }
    assert.ok(calls.some(call => call.args.includes('--no-recreate')));
    result = await f.call('dev', 'stop'); assert.equal(result.code, 0, result.output);
    assert.equal((await deployed()).database, '/rsi_agent');
    const saved = await readFile(f.configPath, 'utf8');
    const next = JSON.parse(saved); next.deployment.environment.DEEPSEEK_WEB_API_KEY = 'new-configured-value';
    await writeFile(f.configPath, JSON.stringify(next));
    result = await f.call('deploy', 'start'); assert.notEqual(result.code, 0); assert.match(result.output, /settings changed; use restart/);
    await writeFile(f.configPath, saved);
  } finally { await f.call('dev', 'stop'); }
}));

test('split legacy settings preserve both keys and credentials and refuse mismatched database servers', () => fixture(async f => {
  await rm(f.configPath);
  await mkdir(join(f.state, 'deploy'), { recursive: true });
  const prod = `DATABASE_URL=mysql://rsi:preserved_password@127.0.0.1:3306/rsi_agent\nCONFIG_ENCRYPTION_KEY=${f.key}\nDEEPSEEK_WEB_API_KEY=existing-search-key\n`;
  const dev = `DATABASE_URL=mysql://rsi_dev:dev_password@127.0.0.1:4211/rsi_agent_dev\nCONFIG_ENCRYPTION_KEY=${f.config.development.encryptionKey}\n`;
  await writeFile(join(f.state, 'deploy/backend.env'), prod);
  await writeFile(join(f.root, 'backend/.env'), dev);
  let result = await f.call('deploy', 'init'); assert.notEqual(result.code, 0); assert.match(result.output, /addresses differ/);
  await assert.rejects(readFile(f.configPath));
  await writeFile(join(f.root, 'backend/.env'), dev.replace(':4211/', ':3306/'));
  result = await f.call('deploy', 'init'); assert.equal(result.code, 0, result.output);
  const value = JSON.parse(await readFile(f.configPath, 'utf8'));
  assert.equal(value.development.encryptionKey, f.config.development.encryptionKey);
  assert.equal(value.deployment.encryptionKey, f.key);
  assert.equal(value.development.database.password, 'dev_password');
  assert.equal(value.deployment.database.password, 'preserved_password');
  assert.equal(value.deployment.environment.DEEPSEEK_WEB_API_KEY, 'existing-search-key');
  assert.equal(await readFile(join(f.state, 'deploy/backend.env'), 'utf8'), prod);
}));

test('invalid or publicly readable project configuration refuses startup without leaking secrets', () => fixture(async f => {
  const saved = await readFile(f.configPath, 'utf8');
  try {
    const value = JSON.parse(saved); value.deployment.backendPort = value.development.backendPort;
    await writeFile(f.configPath, JSON.stringify(value));
    let result = await f.call('deploy', 'start'); assert.notEqual(result.code, 0); assert.match(result.output, /distinct/); assert.ok(!result.output.includes(f.key));
    await writeFile(f.configPath, saved); await chmod(f.configPath, 0o644);
    result = await f.call('deploy', 'start'); assert.notEqual(result.code, 0); assert.match(result.output, /chmod 600/); assert.ok(!result.output.includes(f.key));
    await chmod(f.configPath, 0o600); await writeFile(f.configPath, '{"secret":"must-not-echo" BROKEN}');
    result = await f.call('deploy', 'start'); assert.notEqual(result.code, 0); assert.ok(!result.output.includes('must-not-echo'));
  } finally { await chmod(f.configPath, 0o600); await writeFile(f.configPath, saved); }
}));

test('foreground backend commands use the project development configuration from any working directory', () => fixture(async f => {
  await mkdir(join(f.root, 'backend/dist/src'), { recursive: true });
  await writeFile(join(f.root, 'backend/dist/src/main.js'), `console.log(JSON.stringify({database:new URL(process.env.DATABASE_URL).pathname,port:process.env.PORT,unrelated:process.env.UNRELATED_SECRET??null,nodeOptions:process.env.NODE_OPTIONS??null}));`);
  const result = await new Promise(resolve => {
    const child = spawn('env', ['-u','NODE_OPTIONS','-u','NODE_PATH',process.execPath,join(f.root,'scripts/backend-command.mjs'),'start'], { cwd: f.directory, env: f.env });
    let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);child.once('exit',code=>resolve({code,output}));
  });
  assert.equal(result.code,0,result.output);
  assert.deepEqual(JSON.parse(result.output),{database:'/rsi_agent_dev',port:String(f.config.development.backendPort),unrelated:null,nodeOptions:null});
}));

test('deployment refuses a revision containing the private project config before creating a release', () => fixture(async f => {
  git(f.root, 'add', '-f', 'rsi.config.json');
  git(f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'accidentally tracked private config');
  const result = await f.call('deploy', 'deploy', 'HEAD');
  assert.notEqual(result.code, 0); assert.match(result.output, /private rsi.config.json/);
  assert.ok(!result.output.includes(f.key));
  await assert.rejects(readFile(join(f.state, 'deploy/active.json')));
}));
