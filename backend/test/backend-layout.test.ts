import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { MySqlStorage } from '../src/storage/mysql.js';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(backend, 'src');
async function files(directory: string): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}

test('backend source follows the four agreed boundaries and imports only permitted owners', async () => {
  assert.deepEqual((await readdir(source)).sort(), ['api', 'core', 'runtime', 'storage']);
  for (const file of await files(source)) {
    if (!file.endsWith('.ts')) continue;
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      const dependency = resolve(dirname(file), match[1]!.replace(/\.js$/, '.ts'));
      assert.ok((await stat(dependency)).isFile(), `${file}: unresolved ${match[1]}`);
      if (file.startsWith(join(source, 'core') + '/')) {
        assert.ok(!dependency.startsWith(join(source, 'api') + '/'), `${file} imports transport`);
        assert.ok(!dependency.startsWith(join(source, 'runtime') + '/'), `${file} imports hosting`);
      }
      if (file.startsWith(join(source, 'storage') + '/')) {
        assert.ok(dependency.startsWith(join(source, 'storage') + '/'), `${file} imports business code`);
      }
    }
  }
  const core = await readdir(join(source, 'core'), { withFileTypes: true });
  assert.deepEqual(core.filter(entry => entry.isDirectory()).map(entry => entry.name).sort(), ['agent', 'harness', 'team', 'workspace']);
  for(const owner of ['agent','team','workspace','harness'])assert.ok((await stat(join(source,`core/${owner}/data`))).isDirectory());
  for (const path of await files(join(source, 'core/agent'))) {
    const text = await readFile(path, 'utf8');
    assert.doesNotMatch(text, /from ['"][^'"]*(?:team|harness|workspace)\//, `${path} must not depend on another business's private model`);
    if(path.endsWith('/agent.ts')||path.endsWith('/contracts.ts'))assert.doesNotMatch(text,/mysql2|storage\/mysql|CREATE TABLE|this\.store/,`${path} keeps the in-memory execution mechanism reusable`);
  }
  const owned={agent:['agents','agent_context_entries','agent_assistant_response_handler_state','runs','messages','context_compactions'],team:['members','member_activation','config_records','chat_images','chat_settings','chat_context_summaries','chat_exchanges','chat_messages','chat_context_entries','chat_runs','chat_clock','chat_entries','chat_changes'],workspace:['workspaces','workspace_models','workspace_git_baselines','context_blobs','context_versions','context_files','context_records']};
  for(const [owner,tables]of Object.entries(owned)){
    for(const path of await files(join(source,`core/${owner}/data`))){
      const text=await readFile(path,'utf8');
      for(const match of text.matchAll(/(?:FROM|JOIN|INTO|UPDATE(?!\s+[a-z_]+\s*=)|CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+([a-z_]+)/g)){
        if(match[1]==='IF')continue;
        assert.ok(tables.includes(match[1]!),`${path} reaches foreign table ${match[1]}`);
      }
    }
  }
  const composition=await readFile(join(source,'core/data.ts'),'utf8');
  assert.doesNotMatch(composition,/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/,'Core composes owner operations, not a new schema-aware store');
  const storage = await readFile(join(source, 'storage/mysql.ts'), 'utf8');
  assert.doesNotMatch(storage, /CREATE\s+TABLE|ALTER\s+TABLE|AppError|config_records|chat_messages|member_contexts/i);
});

test('source hosting entry loads the relocated modules and prompt assets before validating launch settings', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/runtime/main.ts'], {
    cwd: backend, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Set DATABASE_URL to a MySQL database URL/);
  assert.doesNotMatch(result.stderr, /ENOENT|ERR_MODULE_NOT_FOUND/);
});

test('storage rejects missing database or non-MySQL connection configuration before opening a pool', () => {
  for (const value of ['sqlite:///tmp/database', 'mysql://localhost', 'not a URL']) {
    assert.throws(() => new MySqlStorage(value), TypeError);
  }
});
