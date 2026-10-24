import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { contextDocuments } from '../../../../backend/src/core/workspace/context-documents.js';
import { resolveDesign } from '../../../../backend/src/core/workspace/design.js';
const root = process.cwd();
async function walk(path: string): Promise<string[]> {
  return (await Promise.all((await readdir(join(root, path), { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`]))).flat();
}
const paths = await walk('.rsi/context');
const designs = paths.filter(path => path.endsWith('/metadata.json'));
assert.equal(designs.length, 12);
const contents = new Map<string, string>();
for (const path of paths) contents.set(path.slice('.rsi/context/'.length).toLowerCase(), await readFile(path, 'utf8'));
for (const path of designs) {
  const reference = path.slice('.rsi/context/design/'.length);
  const design = resolveDesign(reference, contents);
  assert.ok(design.content.includes('## Interface contract'));
  for (const implementation of design.implementation) await stat(join(root, implementation));
  const system = reference.slice(0, -'metadata.json'.length);
  assert.ok(contextDocuments(reference, 'impl', contents).length > 0);
  const context = await readFile(`.rsi/context/implement/${system}impl/README.md`, 'utf8');
  for (const section of ['## Result summary','## File lookup','## Automatic retrieval']) assert.ok(context.includes(section));
  const retrieval = context.slice(context.indexOf('## Automatic retrieval'));
  const block = /```json\s*\n([\s\S]*?)\n```/.exec(retrieval);
  assert.ok(block); assert.deepEqual(JSON.parse(block[1]!), {commands: []});
  assert.match(context, /\*\*Input:\*\*/);
  assert.match(context, /\*\*Output:\*\*/);
  assert.match(context, /\*\*Effect and failure:\*\*/);
  assert.match(context, /\*\*Usage example:\*\*/);
}
const errors: string[] = [];
for (const path of [...paths.filter(path => path.endsWith('.md')), 'README.md', 'backend/README.md', 'frontend/README.md']) {
  const text = await readFile(path, 'utf8');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]!.replace(/^<|>$/g, '').split('#')[0]!;
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    try { await stat(resolve(dirname(path), target)); }
    catch { errors.push(`${path} -> ${target}`); }
  }
}
assert.deepEqual(errors, [], 'canonical context/entry guide links must resolve');
const entry = spawnSync(process.execPath, ['dist/src/runtime/main.js'], {
  cwd: join(root, 'backend'), env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8', timeout: 30_000,
});
assert.equal(entry.status, 1, entry.stderr);
assert.match(entry.stderr, /Set DATABASE_URL to a MySQL database URL/);
assert.doesNotMatch(entry.stderr, /ENOENT|ERR_MODULE_NOT_FOUND/);
console.log(`Validated ${designs.length} RSI design nodes, implementation documents, source mappings, links and compiled startup/assets`);
