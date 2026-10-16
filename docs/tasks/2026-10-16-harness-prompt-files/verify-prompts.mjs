import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../../../', import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'rsi-prompt-assets-'));
const moduleFile = join(temporary, 'src/harness-prompts.js');
try {
  await cp(new URL('backend/dist/src/harness-prompts.js', root), moduleFile, { recursive: true });
  await cp(new URL('backend/dist/src/types.js', root), join(temporary, 'src/types.js'));
  await cp(new URL('backend/dist/prompts/harness/', root), join(temporary, 'prompts/harness'), { recursive: true });
  await writeFile(join(temporary, 'package.json'), '{"type":"module"}');
  const invoke = code => spawnSync(process.execPath, ['--input-type=module', '-e', `const {harnessPrompt}=await import(${JSON.stringify(pathToFileURL(moduleFile).href)});${code}`], { cwd: tmpdir(), encoding: 'utf8' });
  const files = ['common', 'management', 'management-design', 'management-members', 'implementation', 'implementation-scope', 'execute'];
  for (const name of files) {
    const source = await readFile(new URL(`backend/prompts/harness/${name}.md`, root), 'utf8');
    assert.equal(await readFile(join(temporary, `prompts/harness/${name}.md`), 'utf8'), source, `${name}: packaged bytes`);
  }
  const rendered = invoke(`console.log(harnessPrompt('common',{worktree:'/test-worktree'}));console.log(harnessPrompt('execute',{allowedCommands:'DYNAMIC_ALLOWANCE'}));`);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /\/test-worktree/); assert.match(rendered.stdout, /DYNAMIC_ALLOWANCE/); assert.doesNotMatch(rendered.stdout, /\{\{/);
  await writeFile(join(temporary, 'prompts/harness/management.md'), 'Rule content maintained in the file.\n');
  const updated = invoke("console.log(harnessPrompt('management'));");
  assert.equal(updated.status, 0, updated.stderr); assert.equal(updated.stdout.trim(), 'Rule content maintained in the file.');
  const missingValue = invoke("harnessPrompt('execute');");
  assert.notEqual(missingValue.status, 0); assert.match(missingValue.stderr, /Missing harness prompt value: execute.allowedCommands/);
  await writeFile(join(temporary, 'prompts/harness/management.md'), ' \n');
  const empty = invoke('');
  assert.notEqual(empty.status, 0); assert.match(empty.stderr, /Required harness prompt is empty/);
  await rm(join(temporary, 'prompts/harness/management.md'));
  const missing = invoke('');
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /ENOENT/);
  console.log('Passed: seven packaged prompts, compiled loading outside project cwd, file-sourced rule changes, dynamic values and explicit missing/empty/value failures.');
} finally { await rm(temporary, { recursive: true, force: true }); }
