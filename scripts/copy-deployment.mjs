import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { capture, withLock } from './host-common.mjs';
import { hostEnvironment, locations, readConfiguration } from './host-config.mjs';
import { provisionDatabase, startDatabase } from './database.mjs';

// Explicit migration command only. Normal lifecycle commands never copy data or read another config.
function connection(config, container) {
  const section = config.deployment;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(section?.database?.name) || typeof section.database.username !== 'string' || typeof section.database.password !== 'string') throw new Error('Invalid migration database configuration');
  const info = JSON.parse(capture('docker', ['--context', config.mysql.dockerContext, 'inspect', '--format', '{{json .}}', container]));
  if (info.Config?.Labels?.['com.docker.compose.project'] !== config.mysql.project || info.Config.Labels['com.docker.compose.service'] !== 'mysql') throw new Error('Migration container does not belong to the configured MySQL project');
  if (!info.HostConfig?.PortBindings?.['3306/tcp']?.some(binding => binding.HostIp === config.mysql.host && Number(binding.HostPort) === config.mysql.port)) throw new Error('Migration container address does not match configuration');
  return { prefix: ['--context', config.mysql.dockerContext, 'exec', '-i', '-e', 'MYSQL_PWD', container], env: { ...hostEnvironment(), MYSQL_PWD: section.database.password }, args: ['--host=127.0.0.1', `--user=${section.database.username}`, `--database=${section.database.name}`] };
}
function command(connection, program, args) {
  const child = spawn('docker', [...connection.prefix, program, ...args], { env: connection.env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const done = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Cannot execute migration command')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Database snapshot/import failed; source remains unchanged')));
  });
  return { child, done };
}
async function query(connection, sql) {
  const { child, done } = command(connection, 'mysql', [...connection.args, '--batch', '--skip-column-names']);
  let output = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', data => output += data);
  child.stdin.on('error', () => {}); child.stdin.end(sql);
  await done; return output.trim();
}
async function counts(connection) {
  const tables = (await query(connection, 'SHOW TABLES;')).split('\n').filter(Boolean).sort();
  if (tables.some(name => !/^[A-Za-z0-9_]+$/.test(name))) throw new Error('Unexpected table identifier in migration');
  if (!tables.length) return {};
  const sql = tables.map(name => `SELECT '${name}', COUNT(*) FROM \`${name}\``).join(' UNION ALL ') + ';';
  return Object.fromEntries((await query(connection, sql)).split('\n').map(line => { const [name, count] = line.split('\t'); return [name, Number(count)]; }));
}
try {
  const [sourcePath, sourceContainer] = process.argv.slice(2);
  if (!sourcePath || !sourceContainer) throw new Error('Usage: node scripts/copy-deployment.mjs <source-project-config> <source-mysql-container>');
  await withLock(async () => {
    const config = await readConfiguration();
    let source;
    try { source = JSON.parse(await readFile(resolve(sourcePath), 'utf8')); }
    catch { throw new Error('Cannot read/parse source project configuration; no data was copied'); }
    if (source.mysql.project === config.mysql.project || source.mysql.host === config.mysql.host && source.mysql.port === config.mysql.port) throw new Error('Copy requires two isolated MySQL services');
    if (source.deployment.encryptionKey !== config.deployment.encryptionKey) throw new Error('Preserve the source deployment encryption key explicitly in target configuration before copying');
    const directory = join(locations(config).state, 'database');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const marker = join(directory, 'deployment-copy.json');
    const identity = { sourceProject: source.mysql.project, sourceDatabase: source.deployment.database.name, targetProject: config.mysql.project, targetDatabase: config.deployment.database.name };
    try {
      const previous = JSON.parse(await readFile(marker, 'utf8'));
      if (JSON.stringify(previous.identity) !== JSON.stringify(identity)) throw new Error('This deployment already has a different copy record');
      console.log('Deployment snapshot was already copied; no data changed.'); return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await startDatabase(config); await provisionDatabase(config, 'deployment');
    const from = connection(source, sourceContainer), to = connection(config, config.mysql.containerName);
    if (Object.keys(await counts(to)).length) throw new Error('Target deployment database is not empty; refusing to overwrite it');
    const before = await counts(from);
    if (!Object.keys(before).length) throw new Error('Source deployment database is empty');
    const snapshot = join(directory, 'deployment-source.sql');
    const dump = command(from, 'mysqldump', [...from.args.filter(arg => !arg.startsWith('--database=')), '--single-transaction', '--skip-lock-tables', '--no-tablespaces', '--set-gtid-purged=OFF', '--hex-blob', source.deployment.database.name]);
    dump.child.stdin.end();
    await Promise.all([dump.done, pipeline(dump.child.stdout, createWriteStream(snapshot, { mode: 0o600, flags: 'wx' }))]);
    const imported = command(to, 'mysql', [...to.args, '--binary-mode=1']);
    imported.child.stdout.resume();
    await Promise.all([imported.done, pipeline(createReadStream(snapshot), imported.child.stdin)]);
    const copied = await counts(to), after = await counts(from);
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(before) !== JSON.stringify(copied)) throw new Error('Snapshot row counts changed or differ; inspect the target before starting it');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(snapshot)) hash.update(chunk);
    await writeFile(marker, JSON.stringify({ identity, completedAt: new Date().toISOString(), tables: copied, snapshotBytes: (await stat(snapshot)).size, snapshotSha256: hash.digest('hex') }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`Copied ${Object.keys(copied).length} tables (${Object.values(copied).reduce((a, b) => a + b, 0)} rows); source/target counts match. Source service and database were not modified.`);
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
