import assert from 'node:assert/strict';
import { mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkspaceService } from '../src/workspace.js';
import { MemoryStore, withFolder } from './memory-store.js';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

/** A workspace service over a fresh store, closed afterwards. */
function withService(run: (service: WorkspaceService, folder: string, store: MemoryStore) => Promise<void>): Promise<void> {
  return withFolder(async folder => {
    const store = new MemoryStore();
    const service = new WorkspaceService(store);
    try { await run(service, await realpath(folder), store); }
    finally { await service.close(); }
  });
}

test('creating a workspace makes its folder and context base', () => withService(async (service, folder) => {
  const directory = join(folder, 'projects', 'alpha');
  const workspace = await service.create({ workspaceId: 'alpha', name: 'Alpha', directory, adopt: false });
  assert.equal(workspace.workspaceId, 'alpha');
  assert.equal(workspace.directory, directory);
  assert.deepEqual(workspace.context.user, { files: 0, bytes: 0 });
  assert.deepEqual((await readdir(join(directory, '.context'))).sort(), ['agent', 'user']);
  assert.deepEqual((await service.list()).map(item => item.workspaceId), ['alpha']);
  await assert.rejects(service.create({ workspaceId: 'alpha', name: 'Again', directory: join(folder, 'other'), adopt: false }), code('workspace_exists'));
  await assert.rejects(service.get('missing'), code('not_found'));
}));

test('adopting a folder keeps its files and records its context base', () => withService(async (service, folder) => {
  await mkdir(join(folder, 'repo', '.context', 'user'), { recursive: true });
  await writeFile(join(folder, 'repo', 'README.md'), 'readme');
  await writeFile(join(folder, 'repo', '.context', 'user', 'profile.md'), 'me');
  const workspace = await service.create({ name: 'Repo', directory: join(folder, 'repo'), adopt: true });
  assert.match(workspace.workspaceId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(workspace.context.user, { files: 1, bytes: 2 });
  assert.equal((await (await service.files(workspace.workspaceId)).read('README.md')).content, 'readme');
  assert.equal((await (await service.context(workspace.workspaceId)).read({ path: 'user/profile.md' })).content, 'me');
}));

test('folders must not overlap, and a new folder must be empty', () => withService(async (service, folder) => {
  await service.create({ name: 'Outer', directory: join(folder, 'outer'), adopt: false });
  await assert.rejects(service.create({ name: 'Inner', directory: join(folder, 'outer', 'inner'), adopt: false }), code('workspace_exists'));
  await assert.rejects(service.create({ name: 'Parent', directory: folder, adopt: true }), code('workspace_exists'));
  await assert.rejects(service.create({ name: 'Case', directory: join(folder, 'OUTER'), adopt: true }), code('workspace_exists'));
  await mkdir(join(folder, 'full'));
  await writeFile(join(folder, 'full', 'x'), 'x');
  await assert.rejects(service.create({ name: 'Full', directory: join(folder, 'full'), adopt: false }), code('file_exists'));
  await assert.rejects(service.create({ name: 'Missing', directory: join(folder, 'none'), adopt: true }), code('not_found'));
  await assert.rejects(service.create({ name: 'File', directory: join(folder, 'full', 'x'), adopt: true }), code('invalid_input'));
  await assert.rejects(service.create({ name: '', directory: join(folder, 'a'), adopt: false }), code('invalid_input'));
  await assert.rejects(service.create({ name: 'Relative', directory: 'relative/path', adopt: false }), code('invalid_input'));
  await assert.rejects(service.create({ name: 'Adopt', directory: join(folder, 'b'), adopt: 'yes' }), code('invalid_input'));
  assert.deepEqual((await service.list()).map(item => item.name), ['Outer']);
}));

test('a failed registration removes the folder it created', () => withService(async (service, folder, store) => {
  store.createWorkspace = async () => { throw new Error('store down'); };
  await assert.rejects(service.create({ name: 'Lost', directory: join(folder, 'lost', 'deep'), adopt: false }), /store down/);
  await assert.rejects(stat(join(folder, 'lost')), code('ENOENT'));
}));

test('a missing workspace folder fails until it returns', () => withService(async (service, folder, store) => {
  const directory = join(folder, 'gone');
  const { workspaceId } = await service.create({ name: 'Gone', directory, adopt: false });
  await service.close();
  const reopened = new WorkspaceService(store);
  try {
    await rm(directory, { recursive: true });
    await assert.rejects(reopened.get(workspaceId), code('workspace_unavailable'));
    await mkdir(directory);
    assert.equal((await reopened.get(workspaceId)).context.seq, 0);
  } finally { await reopened.close(); }
}));
