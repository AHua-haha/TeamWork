import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkspaceService } from '../src/domain/workspace.js';
import { testModels, testModelValidator, MemoryStore, withFolder } from './memory-store.js';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

/** A workspace service over a fresh store, closed afterwards. */
function withService(run: (service: WorkspaceService, folder: string, store: MemoryStore) => Promise<void>): Promise<void> {
  return withFolder(async folder => {
    const store = new MemoryStore();
    const service = new WorkspaceService(store, testModelValidator);
    try { await run(service, await realpath(folder), store); }
    finally { await service.close(); }
  });
}

test('creating a workspace makes its folder and context base', () => withService(async (service, folder) => {
  const directory = join(folder, 'projects', 'alpha');
  const workspace = await service.create({ workspaceId: 'alpha', name: 'Alpha', directory, models: testModels(), adopt: false });
  assert.equal(workspace.workspaceId, 'alpha');
  assert.equal(workspace.directory, directory);
  assert.equal(workspace.context.files, 3);
  assert.equal(workspace.context.seq, 1);
  assert.deepEqual((await readdir(join(directory, '.rsi/context'))).sort(), ['design', 'implement']);
  assert.deepEqual((await service.list()).map(item => item.workspaceId), ['alpha']);
  await assert.rejects(service.create({ workspaceId: 'alpha', name: 'Again', directory: join(folder, 'other'), models: testModels(), adopt: false }), code('workspace_exists'));
  await assert.rejects(service.get('missing'), code('not_found'));
}));

test('adopting initializes managed state while preserving project files', () => withService(async (service, folder) => {
  await mkdir(join(folder, 'repo')); await writeFile(join(folder, 'repo', 'README.md'), 'readme');
  const workspace = await service.create({ name: 'Repo', directory: join(folder, 'repo'), models: testModels(), adopt: true });
  assert.match(workspace.workspaceId, /^[0-9a-f-]{36}$/);
  assert.equal(workspace.context.files, 3);
  assert.equal((await (await service.files(workspace.workspaceId)).read('README.md')).content, 'readme');
  assert.deepEqual(JSON.parse((await (await service.context(workspace.workspaceId)).read({ path: 'design/metadata.json' })).content).implementation, []);
}));

test('folders must not overlap, and a new folder must be empty', () => withService(async (service, folder) => {
  await service.create({ name: 'Outer', directory: join(folder, 'outer'), models: testModels(), adopt: false });
  await assert.rejects(service.create({ name: 'Inner', directory: join(folder, 'outer', 'inner'), models: testModels(), adopt: false }), code('workspace_exists'));
  await assert.rejects(service.create({ name: 'Parent', directory: folder, models: testModels(), adopt: true }), code('workspace_exists'));
  await assert.rejects(service.create({ name: 'Case', directory: join(folder, 'OUTER'), models: testModels(), adopt: true }), code('workspace_exists'));
  await mkdir(join(folder, 'full'));
  await writeFile(join(folder, 'full', 'x'), 'x');
  await assert.rejects(service.create({ name: 'Full', directory: join(folder, 'full'), models: testModels(), adopt: false }), code('file_exists'));
  await assert.rejects(service.create({ name: 'Missing', directory: join(folder, 'none'), models: testModels(), adopt: true }), code('not_found'));
  await assert.rejects(service.create({ name: 'File', directory: join(folder, 'full', 'x'), models: testModels(), adopt: true }), code('invalid_input'));
  await assert.rejects(service.create({ name: '', directory: join(folder, 'a'), models: testModels(), adopt: false }), code('invalid_input'));
  await assert.rejects(service.create({ name: 'Relative', directory: 'relative/path', models: testModels(), adopt: false }), code('invalid_input'));
  await assert.rejects(service.create({ name: 'Adopt', directory: join(folder, 'b'), models: testModels(), adopt: 'yes' }), code('invalid_input'));
  assert.deepEqual((await service.list()).map(item => item.name), ['Outer']);
}));

test('a failed registration removes the folder it created', () => withService(async (service, folder, store) => {
  store.createWorkspace = async () => { throw new Error('store down'); };
  await assert.rejects(service.create({ name: 'Lost', directory: join(folder, 'lost', 'deep'), models: testModels(), adopt: false }), /store down/);
  await assert.rejects(stat(join(folder, 'lost')), code('ENOENT'));
}));

test('a missing workspace folder fails until it returns', () => withService(async (service, folder, store) => {
  const directory = join(folder, 'gone');
  const { workspaceId } = await service.create({ name: 'Gone', directory, models: testModels(), adopt: false });
  await service.close();
  const reopened = new WorkspaceService(store, testModelValidator);
  try {
    await rm(directory, { recursive: true });
    await assert.rejects(reopened.get(workspaceId), code('workspace_unavailable'));
    await mkdir(directory);
    assert.equal((await reopened.get(workspaceId)).context.files, 0);
    assert.equal((await reopened.get(workspaceId)).context.seq, 2);
  } finally { await reopened.close(); }
}));


test('bootstrap refuses existing managed roots and links, and failed adoption removes only its own state', () => withService(async (service, folder, store) => {
  await mkdir(join(folder, 'project')); await writeFile(join(folder, 'project', 'code.ts'), 'preserved');
  await mkdir(join(folder, 'project', '.RSI'));
  await assert.rejects(service.create({ name: 'Collision', directory: join(folder, 'project'), models: testModels(), adopt: true }), code('file_exists'));
  await rm(join(folder, 'project', '.RSI'), {recursive:true});
  await mkdir(join(folder, 'outside')); await symlink(join(folder, 'outside'), join(folder, 'project', '.rsi'));
  await assert.rejects(service.create({ name: 'Link', directory: join(folder, 'project'), models: testModels(), adopt: true }), code('file_exists'));
  assert.deepEqual(await readdir(join(folder, 'outside')), []); await rm(join(folder, 'project', '.rsi'));
  const original = store.commitContext.bind(store); store.commitContext = async () => { throw new Error('context insert failed'); };
  await assert.rejects(service.create({ name:'Rollback', directory:join(folder,'project'), models:testModels(), adopt:true }), /context insert failed/);
  assert.deepEqual(await readdir(join(folder,'project')), ['code.ts']);
  assert.equal(await readFile(join(folder,'project','code.ts'),'utf8'), 'preserved');
  assert.equal(store.members.size, 0); assert.equal(store.workspaceModels.size,0); assert.equal(store.memberActivations.size,0); assert.deepEqual(await service.list(),[]);
  store.commitContext = original;
}));
