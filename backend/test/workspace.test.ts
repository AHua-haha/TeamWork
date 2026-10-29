import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkspaceService } from '../src/core/workspace/workspace.js';
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


test('adoption preserves existing context bytes and document forms and imports their initial baseline', () => withService(async (service, folder, store) => {
  const directory = join(folder, 'existing');
  const root = join(directory, '.rsi/context');
  const original = {
    'design/metadata.json': '{"implementation":["src"]}\n',
    'design/design/README.md': '# Existing root design\r\nDo not replace.\r\n',
    'design/design/contract.md': '# Public interface\n',
    'design/child/metadata.json': '{"implementation":["src/child"]}\n',
    'design/child/design.md': '# Child\n',
    'implement/impl.md': '# Existing implementation summary\n',
  };
  for (const [path, content] of Object.entries(original)) {
    await mkdir(join(root, path, '..'), {recursive:true}); await writeFile(join(root, path), content);
  }
  await writeFile(join(root, '.hidden'), Buffer.from([0, 255]));
  await mkdir(join(directory, '.rsi/harness/empty'), {recursive:true});
  await mkdir(join(directory, 'src')); await writeFile(join(directory, 'src/app.ts'), 'source');
  const before = await stat(join(root, 'design/design/README.md'));
  const review = await service.inspectInitialization({directory, adopt:true});
  assert.deepEqual(review, {directory, cleanupPaths:[], cleanupRevision:null});
  const workspace = await service.create({name:'Existing', directory, adopt:true, models:testModels()});
  assert.equal(workspace.context.seq, 1);
  assert.equal(workspace.context.files, Object.keys(original).length);
  for (const [path, content] of Object.entries(original)) assert.equal(await readFile(join(root, path), 'utf8'), content);
  const after = await stat(join(root, 'design/design/README.md'));
  assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(join(root, '.hidden')), Buffer.from([0, 255]));
  await assert.rejects(stat(join(root, 'design/design.md')), code('ENOENT'));
  await assert.rejects(stat(join(root, 'implement/impl')), code('ENOENT'));
  const baseline = await service.gitBaseline(workspace.workspaceId);
  assert.deepEqual(baseline.design, Object.fromEntries(Object.entries(original).filter(([path])=>path.startsWith('design/')).map(([path,content])=>[`.rsi/context/${path}`,content])));
  assert.equal((await store.loadContext(workspace.workspaceId)).files.length, Object.keys(original).length);
  const lead = [...store.members.values()][0]!;
  assert.deepEqual(lead.member.value.designScope.working, ['metadata.json']);
  assert.equal(await readFile(join(directory, 'src/app.ts'), 'utf8'), 'source');
}));

test('partial context gains only missing root documents', () => withService(async (service, folder) => {
  const directory=join(folder,'partial'), root=join(directory,'.rsi/context');
  await mkdir(join(root,'design/design'),{recursive:true});
  await writeFile(join(root,'design/design/topic.md'),'# Existing topic');
  await service.create({name:'Partial',directory,adopt:true,models:testModels()});
  assert.equal(await readFile(join(root,'design/design/topic.md'),'utf8'),'# Existing topic');
  assert.ok(await readFile(join(root,'design/design/README.md'),'utf8'));
  assert.ok(await readFile(join(root,'implement/impl/README.md'),'utf8'));
  assert.deepEqual(JSON.parse(await readFile(join(root,'design/metadata.json'),'utf8')), {implementation:[]});
  await assert.rejects(stat(join(root,'design/design.md')),code('ENOENT'));
}));

test('nonempty metadata requires reviewed consent and stale consent cannot clean changed state', () => withService(async (service, folder) => {
  const directory=join(folder,'review'), state=join(directory,'.rsi/harness/state.json');
  await mkdir(join(state,'..'),{recursive:true}); await writeFile(state,'old state');
  await mkdir(join(directory,'.rsi/members/empty'),{recursive:true});
  await mkdir(join(directory,'.rsi/context/design'),{recursive:true});
  const design=join(directory,'.rsi/context/design/design.md'); await writeFile(design,'# Keep design');
  await mkdir(join(directory,'.git')); await writeFile(join(directory,'.git/keep'),'git state');
  const input={name:'Review',directory,adopt:true,models:testModels()};
  const first=await service.inspectInitialization(input);
  assert.deepEqual(first.cleanupPaths,['.rsi/harness']); assert.match(first.cleanupRevision!,/^[a-f0-9]{64}$/);
  // Reviewing/cancelling and an unconfirmed create do not add any root context files.
  await assert.rejects(service.create(input),code('cleanup_required'));
  assert.equal(await readFile(state,'utf8'),'old state');
  await assert.rejects(stat(join(directory,'.rsi/context/design/metadata.json')),code('ENOENT'));
  await writeFile(state,'changed state');
  await assert.rejects(service.create({...input,cleanupRevision:first.cleanupRevision!}),code('cleanup_required'));
  assert.equal(await readFile(state,'utf8'),'changed state');
  const second=await service.inspectInitialization(input);
  assert.notEqual(second.cleanupRevision,first.cleanupRevision);
  await service.create({...input,cleanupRevision:second.cleanupRevision!});
  await assert.rejects(stat(state),code('ENOENT'));
  assert.equal(await readFile(design,'utf8'),'# Keep design');
  assert.equal(await readFile(join(directory,'.git/keep'),'utf8'),'git state');
  assert.ok((await readdir(join(directory,'.rsi/members'))).length);
  assert.ok(!(await readdir(join(directory,'.rsi'))).some(name=>name.startsWith('.initialization-')));
  await assert.rejects(service.inspectInitialization(input),code('workspace_exists'));
  await assert.rejects(service.create({...input,cleanupRevision:second.cleanupRevision!}),code('workspace_exists'));
}));

test('failed registration restores staged metadata and preserves context while removing only new files', () => withService(async (service, folder, store) => {
  const directory=join(folder,'rollback'), root=join(directory,'.rsi');
  await mkdir(join(root,'context/design'),{recursive:true}); await writeFile(join(root,'context/design/design.md'),'# Existing');
  await mkdir(join(root,'members/previous'),{recursive:true}); await writeFile(join(root,'members/previous/member.json'),'old member');
  const input={name:'Rollback',directory,adopt:true,models:testModels()};
  const review=await service.inspectInitialization(input);
  store.createWorkspace=async()=>{throw new Error('database failed');};
  await assert.rejects(service.create({...input,cleanupRevision:review.cleanupRevision!}),/database failed/);
  assert.equal(await readFile(join(root,'context/design/design.md'),'utf8'),'# Existing');
  assert.equal(await readFile(join(root,'members/previous/member.json'),'utf8'),'old member');
  assert.deepEqual(await readdir(join(root,'context')),['design']);
  assert.deepEqual(await readdir(join(root,'context/design')),['design.md']);
  assert.deepEqual(await readdir(join(root,'members')),['previous']);
  assert.deepEqual(await readdir(directory),['.rsi']);
  assert.deepEqual(await service.list(),[]);
}));

test('managed/context links and required document links are refused without touching their targets', () => withService(async (service, folder) => {
  const directory=join(folder,'links'), outside=join(folder,'external');
  await mkdir(join(directory,'.rsi'),{recursive:true}); await mkdir(outside);
  await symlink(outside,join(directory,'.rsi/context'));
  const input={name:'Links',directory,adopt:true,models:testModels()};
  await assert.rejects(service.inspectInitialization(input),code('file_exists'));
  await assert.rejects(service.create(input),code('file_exists'));
  assert.ok((await lstat(join(directory,'.rsi/context'))).isSymbolicLink());
  assert.deepEqual(await readdir(outside),[]);
  await rm(join(directory,'.rsi/context'));
  await mkdir(join(directory,'.rsi/context/design'),{recursive:true});
  await writeFile(join(outside,'metadata.json'),'preserve');
  await symlink(join(outside,'metadata.json'),join(directory,'.rsi/context/design/metadata.json'));
  await assert.rejects(service.create(input),code('file_exists'));
  assert.equal(await readFile(join(outside,'metadata.json'),'utf8'),'preserve');
  assert.ok((await lstat(join(directory,'.rsi/context/design/metadata.json'))).isSymbolicLink());
}));


test('cleanup removes a metadata symlink without following it and context edits do not invalidate consent', () => withService(async (service, folder) => {
  const directory=join(folder,'metadata-link'), outside=join(folder,'outside-link');
  await mkdir(join(directory,'.rsi/context'),{recursive:true}); await mkdir(outside);
  await writeFile(join(outside,'keep'),'outside content');
  await symlink(outside,join(directory,'.rsi/harness'));
  const input={name:'Link cleanup',directory,adopt:true,models:testModels()};
  const review=await service.inspectInitialization(input);
  assert.deepEqual(review.cleanupPaths,['.rsi/harness']);
  await writeFile(join(directory,'.rsi/context/notes.md'),'new context while reviewing');
  await service.create({...input,cleanupRevision:review.cleanupRevision!});
  assert.equal(await readFile(join(outside,'keep'),'utf8'),'outside content');
  assert.equal(await readFile(join(directory,'.rsi/context/notes.md'),'utf8'),'new context while reviewing');
  await assert.rejects(lstat(join(directory,'.rsi/harness')),code('ENOENT'));
}));
