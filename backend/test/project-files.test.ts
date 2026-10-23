import assert from 'node:assert/strict';
import { chmod, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProjectFiles, projectPath } from '../src/core/workspace/project-files.js';
import { sha256 } from '../src/core/text.js';
import { withFolder } from './memory-store.js';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

async function project(folder: string): Promise<ProjectFiles> {
  await mkdir(join(folder, 'src', 'lib'), { recursive: true });
  await mkdir(join(folder, '.git'));
  await mkdir(join(folder, '.rsi/context', 'user'), { recursive: true });
  await writeFile(join(folder, 'README.md'), '# Project\n');
  await writeFile(join(folder, '.env.example'), 'KEY=\n');
  await writeFile(join(folder, 'src', 'main.ts'), 'main();\n');
  await writeFile(join(folder, 'src', 'lib', 'util.ts'), 'export {};\n');
  await writeFile(join(folder, 'logo.png'), Buffer.from([137, 80, 78, 71, 0, 1]));
  await writeFile(join(folder, '.git', 'HEAD'), 'ref');
  return new ProjectFiles(folder);
}

test('project paths reject traversal and the reserved folders', () => {
  assert.deepEqual(projectPath('src/main.ts'), ['src', 'main.ts']);
  assert.deepEqual(projectPath('', true), []);
  for (const path of ['', '../x', 'a/./b', 'a//b', 'a\\b', 'c:x', '.git/HEAD', '.RSI/context/user/a.md']) assert.throws(() => projectPath(path), code('invalid_path'), path);
});

test('the tree lists files and folders breadth-first without .git or .context', () => withFolder(async folder => {
  const files = await project(folder);
  const top = await files.tree('', 1);
  assert.deepEqual(top.entries.map(entry => [entry.path, entry.type]), [['.env.example', 'file'], ['logo.png', 'file'], ['README.md', 'file'], ['src', 'folder']]);
  assert.equal(top.truncated, false);
  assert.deepEqual((await files.tree('src', 2)).entries.map(entry => entry.path), ['src/lib', 'src/lib/util.ts', 'src/main.ts']);
  await assert.rejects(files.tree('README.md', 1), code('invalid_path'));
  await assert.rejects(files.tree('missing', 1), code('not_found'));
  await assert.rejects(files.tree('', 0), code('invalid_input'));
}));

test('reads serve text and refuse binary files and links', () => withFolder(async folder => {
  const files = await project(folder);
  const read = await files.read('src/main.ts');
  assert.deepEqual({ ...read, updatedAt: 0 }, { path: 'src/main.ts', revision: sha256('main();\n'), content: 'main();\n', size: 8, updatedAt: 0 });
  await assert.rejects(files.read('logo.png'), code('unsupported_file'));
  await assert.rejects(files.read('src'), code('invalid_path'));
  await assert.rejects(files.read('src/none.ts'), code('not_found'));
  await assert.rejects(files.read('README.md/x'), code('invalid_path'));
  await symlink(join(folder, 'src'), join(folder, 'linked'));
  await assert.rejects(files.read('linked/main.ts'), code('invalid_path'));
  assert.ok(!(await files.tree('', 1)).entries.some(entry => entry.path === 'linked'));
}));

test('saves create, update with the read revision, and keep the file mode', () => withFolder(async folder => {
  const files = await project(folder);
  assert.deepEqual(await files.save('docs/new/notes.md', 'notes', null), { path: 'docs/new/notes.md', revision: sha256('notes'), created: true });
  assert.equal(await readFile(join(folder, 'docs', 'new', 'notes.md'), 'utf8'), 'notes');
  await assert.rejects(files.save('docs/new/notes.md', 'again', null), code('file_exists'));
  await assert.rejects(files.save('docs/new/notes.md', 'again', sha256('other')), code('stale_revision'));
  await assert.rejects(files.save('docs/none.md', 'x', sha256('x')), code('stale_revision'));
  await assert.rejects(files.save('.git/config', 'x', null), code('invalid_path'));

  await chmod(join(folder, 'src', 'main.ts'), 0o755);
  const { revision } = await files.read('src/main.ts');
  assert.deepEqual(await files.save('src/main.ts', 'main();\n', revision), { path: 'src/main.ts', revision, created: false });
  const saved = await files.save('src/main.ts', 'run();\n', revision);
  assert.equal(saved.created, false);
  assert.equal((await stat(join(folder, 'src', 'main.ts'))).mode & 0o777, 0o755);
  assert.equal((await files.read('src/main.ts')).content, 'run();\n');
  assert.ok(!(await readdir(join(folder, 'src'))).some(name => name.startsWith('.tmp-')));
}));

test('find matches paths case-insensitively, shallow first', () => withFolder(async folder => {
  const files = await project(folder);
  assert.deepEqual(await files.find('.TS'), { paths: ['src/main.ts', 'src/lib/util.ts'], truncated: false });
  assert.deepEqual((await files.find('head')).paths, []);
  await assert.rejects(files.find(''), code('invalid_input'));
  await rm(folder, { recursive: true });
  await assert.rejects(files.find('x'), code('workspace_unavailable'));
}));
