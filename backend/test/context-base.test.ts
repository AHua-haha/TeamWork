import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { ContextBase, contextPath, validSegment, type ContextEvent, type WorkspaceRecord } from '../src/context-base.js';
import { newLead } from '../src/team.js';
import { MemoryStore, withFolder } from './memory-store.js';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

async function workspace(store: MemoryStore, folder: string): Promise<WorkspaceRecord> {
  const record = { workspaceId: 'w1', name: 'Test', directory: await realpath(folder), createdAt: 1 };
  await store.createWorkspace(record, 'key', newLead(record.workspaceId));
  return record;
}

/** Opens a context base on a fresh folder and closes it afterwards. */
function withBase(run: (base: ContextBase, store: MemoryStore, record: WorkspaceRecord) => Promise<void>): Promise<void> {
  return withFolder(async folder => {
    const store = new MemoryStore();
    const record = await workspace(store, folder);
    const base = await ContextBase.open(store, record);
    try { await run(base, store, record); }
    finally { await base.close(); }
  });
}

const onDisk = (record: WorkspaceRecord, path: string) => join(record.directory, '.context', ...path.split('/'));

test('paths name a category and valid segments', () => {
  for (const name of ['a', 'Notes.md', 'my file.txt', '_x-1', 'a.b.c']) assert.ok(validSegment(name), name);
  for (const name of ['', '.hidden', ' lead', 'trail ', 'end.', 'a/b', 'é', 'x'.repeat(129)]) assert.ok(!validSegment(name), name);
  assert.equal(contextPath('user/a.md'), 'user/a.md');
  assert.equal(contextPath('agent', 1), 'agent');
  for (const path of ['user', 'other/a.md', 'user/../a.md', 'user//a.md', `user/${'a/'.repeat(16)}x`]) assert.throws(() => contextPath(path), code('invalid_path'), path);
});

test('opening creates both categories and an empty overview', () => withBase(async (base, _store, record) => {
  assert.deepEqual((await readdir(join(record.directory, '.context'))).sort(), ['agent', 'user']);
  const overview = await base.overview();
  assert.deepEqual(overview, { workspaceId: 'w1', seq: 0, user: { files: 0, bytes: 0 }, agent: { files: 0, bytes: 0 }, problems: [] });
  assert.deepEqual((await base.tree('', 1)).entries, [{ path: 'agent', type: 'folder' }, { path: 'user', type: 'folder' }]);
}));

test('saves create, update, and refuse stale or conflicting writes', () => withBase(async (base, store, record) => {
  const created = await base.save('user/goals/plan.md', '# Plan\n', null, 'first');
  assert.equal(created.created, true);
  assert.equal(created.seq, 1);
  assert.equal(await readFile(onDisk(record, 'user/goals/plan.md'), 'utf8'), '# Plan\n');
  await assert.rejects(base.save('user/goals/PLAN.md', 'x', null, null), code('file_exists'));
  await assert.rejects(base.save('user/goals/plan.md', 'x', 'not-the-revision', null), code('stale_revision'));
  await assert.rejects(base.save('user/missing.md', 'x', created.revision, null), code('stale_revision'));
  await assert.rejects(base.save('agent/notes.md', 'x', null, null), code('read_only'));
  await assert.rejects(base.save('user/a.md', 'x', null, 'r'.repeat(1001)), code('invalid_input'));

  const same = await base.save('user/goals/plan.md', '# Plan\n', created.revision, null);
  assert.deepEqual(same, { path: 'user/goals/plan.md', revision: created.revision, seq: null, created: false });
  const updated = await base.save('user/goals/plan.md', '# Plan\n\nMore\n', created.revision, null);
  assert.equal(updated.seq, 2);
  const file = await base.read({ path: 'user/GOALS/plan.md' });
  assert.equal(file.content, '# Plan\n\nMore\n');
  assert.equal(file.path, 'user/goals/plan.md');
  assert.equal(file.revision, updated.revision);
  assert.deepEqual(file.author, { type: 'user' });
  const old = await base.read({ revision: created.revision });
  assert.equal(old.content, '# Plan\n');
  assert.equal(old.current, false);
  assert.equal(old.reason, 'first');
  assert.deepEqual(store.workspaces.get('w1')!.records.map(change => change.files[0]!.action), ['create', 'update']);
}));

test('a new file keeps the spelling of existing folders on disk', () => withBase(async (base, _store, record) => {
  await base.save('user/Research/a.md', 'a', null, null);
  const saved = await base.save('user/research/b.md', 'b', null, null);
  assert.equal(saved.path, 'user/Research/b.md');
  assert.deepEqual((await readdir(onDisk(record, 'user/Research'))).sort(), ['a.md', 'b.md']);
  await assert.rejects(base.save('user/Research/a.md/c.md', 'c', null, null), code('file_exists'));
}));

test('a folder move keeps file identity and history and prunes the old folder', () => withBase(async (base, _store, record) => {
  const x = await base.save('user/a/x.md', 'x', null, null);
  await base.save('user/a/deep/y.md', 'y', null, null);
  await base.save('user/b/z.md', 'z', null, null);
  await assert.rejects(base.move('user/a', 'user/a/inner', undefined, null), code('invalid_input'));
  await assert.rejects(base.move('user/a/x.md', 'user/b/z.md', undefined, null), code('file_exists'));
  await assert.rejects(base.move('user/a', 'user/c', x.revision, null), code('invalid_input'));
  await assert.rejects(base.move('user/a/x.md', 'agent/x.md', undefined, null), code('read_only'));

  const moved = await base.move('user/a', 'user/c', undefined, 'reorganize');
  assert.deepEqual(moved.moved.map(({ from, to }) => [from, to]), [['user/a/deep/y.md', 'user/c/deep/y.md'], ['user/a/x.md', 'user/c/x.md']]);
  assert.deepEqual((await readdir(onDisk(record, 'user'))).sort(), ['b', 'c']);
  const history = await base.history('user/c/x.md', null, 50);
  assert.deepEqual(history.versions.map(version => [version.action, version.path, version.fromPath]), [['move', 'user/c/x.md', 'user/a/x.md'], ['create', 'user/a/x.md', null]]);
  assert.equal(history.versions[1]!.revision, x.revision);
  assert.equal((await base.read({ revision: x.revision })).content, 'x');
}));

test('a rename can change only letter case', () => withBase(async (base, _store, record) => {
  await base.save('user/notes.md', 'n', null, null);
  await base.save('user/dir/f.md', 'f', null, null);
  await assert.rejects(base.move('user/notes.md', 'user/notes.md', undefined, null), code('invalid_input'));
  assert.deepEqual((await base.move('user/notes.md', 'user/Notes.md', undefined, null)).moved.map(item => item.to), ['user/Notes.md']);
  assert.deepEqual((await base.move('user/dir', 'user/Dir', undefined, null)).moved.map(item => item.to), ['user/Dir/f.md']);
  assert.deepEqual((await readdir(onDisk(record, 'user'))).sort(), ['Dir', 'Notes.md']);
  assert.deepEqual((await base.tree('user', 2)).entries.map(entry => entry.path), ['user/Dir', 'user/Dir/f.md', 'user/Notes.md']);
  assert.deepEqual((await base.overview()).problems, []);
}));

test('a delete removes a file or folder; its history stays readable', () => withBase(async (base, _store, record) => {
  const a = await base.save('user/old/a.md', 'a', null, null);
  await base.save('user/old/b.md', 'b', null, null);
  await assert.rejects(base.delete('user/old/a.md', 'other', null), code('stale_revision'));
  assert.deepEqual((await base.delete('user/old/a.md', a.revision, null)).deleted, ['user/old/a.md']);
  assert.deepEqual((await base.delete('user/old', undefined, 'cleanup')).deleted, ['user/old/b.md']);
  assert.deepEqual(await readdir(onDisk(record, 'user')), []);
  await assert.rejects(base.read({ path: 'user/old/a.md' }), code('not_found'));
  const history = await base.history('user/old/a.md', null, 10);
  assert.deepEqual(history.versions.map(version => [version.action, version.revision]), [['delete', null], ['create', a.revision]]);
  await assert.rejects(base.delete('user/old', undefined, null), code('not_found'));
}));

test('changes made outside the application are recorded before the next operation', () => withBase(async (base, store, record) => {
  const saved = await base.save('user/a.md', 'one', null, null);
  await writeFile(onDisk(record, 'user/a.md'), 'changed outside');
  await mkdir(onDisk(record, 'agent/memory'), { recursive: true });
  await writeFile(onDisk(record, 'agent/memory/facts.md'), 'fact');
  const overview = await base.overview();
  assert.equal(overview.seq, 2);
  assert.deepEqual(overview.agent, { files: 1, bytes: 4 });
  const change = store.workspaces.get('w1')!.records[1]!;
  assert.deepEqual(change.author, { type: 'external' });
  assert.deepEqual(change.files.map(file => [file.action, file.path]), [['create', 'agent/memory/facts.md'], ['update', 'user/a.md']]);
  await assert.rejects(base.save('user/a.md', 'mine', saved.revision, null), code('stale_revision'));

  await rename(onDisk(record, 'user/a.md'), onDisk(record, 'user/b.md'));
  await base.overview();
  const moved = store.workspaces.get('w1')!.records[2]!;
  assert.deepEqual(moved.files.map(file => [file.action, file.path]), [['delete', 'user/a.md'], ['create', 'user/b.md']]);
  assert.equal((await base.read({ path: 'user/b.md' })).content, 'changed outside');
}));

test('files that cannot be served are problems, and dot entries are ignored', () => withBase(async (base, _store, record) => {
  await writeFile(onDisk(record, 'user/image.bin'), Buffer.from([0, 1, 2, 255]));
  await writeFile(onDisk(record, 'user/bad name.'), 'x');
  await writeFile(onDisk(record, 'user/.hidden'), 'x');
  await writeFile(onDisk(record, 'user/ok.md'), 'ok');
  const overview = await base.overview();
  assert.deepEqual(overview.problems.map(problem => [problem.path, problem.code]), [['user/bad name.', 'invalid_path'], ['user/image.bin', 'not_text']]);
  assert.deepEqual(overview.user, { files: 1, bytes: 2 });
  assert.equal((await base.overview()).seq, 1);
  await rm(onDisk(record, 'user/image.bin'));
  assert.deepEqual((await base.overview()).problems.map(problem => problem.path), ['user/bad name.']);
}));

test('reopening records what changed while the backend was not watching', () => withFolder(async folder => {
  const store = new MemoryStore();
  const record = await workspace(store, folder);
  const first = await ContextBase.open(store, record);
  const saved = await first.save('user/a.md', 'a', null, null);
  await first.close();
  await assert.rejects(first.overview(), code('workspace_unavailable'));
  await writeFile(onDisk(record, 'user/a.md'), 'edited while closed');
  await writeFile(onDisk(record, 'user/new.md'), 'new');
  const second = await ContextBase.open(store, record);
  try {
    const overview = await second.overview();
    assert.equal(overview.seq, 2);
    const file = await second.read({ path: 'user/a.md' });
    assert.equal(file.content, 'edited while closed');
    assert.deepEqual(file.author, { type: 'external' });
    assert.equal((await second.history('user/a.md', null, 10)).versions.at(-1)!.revision, saved.revision);
  } finally { await second.close(); }
}));

test('a failed commit leaves the files on disk and the index unchanged', () => withBase(async (base, store, record) => {
  const saved = await base.save('user/keep/a.md', 'a', null, null);
  store.failNextCommit = true;
  await assert.rejects(base.save('user/new/b.md', 'b', null, null), /injected/);
  store.failNextCommit = true;
  await assert.rejects(base.save('user/keep/a.md', 'changed', saved.revision, null), /injected/);
  store.failNextCommit = true;
  await assert.rejects(base.move('user/keep', 'user/moved', undefined, null), /injected/);
  store.failNextCommit = true;
  await assert.rejects(base.delete('user/keep/a.md', undefined, null), /injected/);
  assert.deepEqual(await readdir(onDisk(record, 'user')), ['keep']);
  assert.deepEqual(await readdir(onDisk(record, 'user/keep')), ['a.md']);
  assert.equal(await readFile(onDisk(record, 'user/keep/a.md'), 'utf8'), 'a');
  assert.equal((await base.overview()).seq, 1);
  assert.equal((await base.read({ path: 'user/keep/a.md' })).revision, saved.revision);
}));

test('find, search, tree, and history paging', () => withBase(async (base, _store, record) => {
  for (const name of ['alpha', 'beta', 'gamma']) await base.save(`user/notes/${name}.md`, `${name} line\nsecond Line\r\nthird`, null, null);
  await mkdir(onDisk(record, 'agent'), { recursive: true });
  await writeFile(onDisk(record, 'agent/index.md'), 'line for agents');
  assert.deepEqual(await base.find('ALP'), { paths: ['user/notes/alpha.md'], truncated: false });
  const found = await base.search('line', 'user/notes');
  assert.equal(found.matches.length, 6);
  assert.deepEqual(found.matches.slice(0, 2), [{ path: 'user/notes/alpha.md', line: 1, text: 'alpha line' }, { path: 'user/notes/alpha.md', line: 2, text: 'second Line' }]);
  assert.equal((await base.search('agents', '')).matches[0]!.path, 'agent/index.md');
  await assert.rejects(base.find(''), code('invalid_input'));
  assert.deepEqual((await base.tree('', 1)).entries.map(entry => entry.path), ['agent', 'user']);
  assert.deepEqual((await base.tree('', 2)).entries.map(entry => entry.path), ['agent', 'agent/index.md', 'user', 'user/notes']);
  await assert.rejects(base.tree('user/notes/alpha.md', 1), code('invalid_path'));
  await assert.rejects(base.tree('user/none', 1), code('not_found'));

  let revision = (await base.read({ path: 'user/notes/alpha.md' })).revision;
  for (let index = 0; index < 4; index++) revision = (await base.save('user/notes/alpha.md', `v${index}`, revision, null)).revision;
  const first = await base.history('user/notes/alpha.md', null, 3);
  assert.equal(first.versions.length, 3);
  assert.equal(first.versions[0]!.revision, revision);
  const second = await base.history('user/notes/alpha.md', first.next, 3);
  assert.deepEqual(second.versions.map(version => version.action), ['update', 'create']);
  assert.equal(second.next, null);
}));

test('changes pages records and refuses a cursor beyond the latest', () => withBase(async base => {
  for (const name of ['a', 'b', 'c']) await base.save(`user/${name}.md`, name, null, null);
  const page = await base.changes(0, 2);
  assert.deepEqual(page.records.map(record => record.seq), [1, 2]);
  assert.equal(page.more, true);
  assert.deepEqual(await base.changes(3, 10), { records: [], seq: 3, more: false });
  await assert.rejects(base.changes(4, 10), code('invalid_cursor'));
}));

test('follow replays records, marks sync, and streams later changes', () => withBase(async base => {
  await base.save('user/a.md', 'a', null, null);
  await base.save('user/b.md', 'b', null, null);
  const controller = new AbortController();
  const events = base.follow(1, controller.signal);
  const next = async (): Promise<ContextEvent> => (await events.next()).value as ContextEvent;
  assert.deepEqual(await next().then(event => event.type === 'record' && event.record.seq), 2);
  assert.deepEqual(await next(), { version: 1, workspaceId: 'w1', type: 'sync', seq: 2 });
  const pending = next();
  await base.save('user/c.md', 'c', null, null);
  const live = await pending;
  assert.ok(live.type === 'record' && live.record.files[0]!.path === 'user/c.md');
  controller.abort();
  assert.equal((await events.next()).done, true);
  await assert.rejects(base.follow(9, new AbortController().signal).next(), code('invalid_cursor'));
}));

/** The next event, or a failure after `ms`. The timer also holds the process open, as the HTTP server does in the backend, because the watcher does not. */
async function nextWithin(events: AsyncGenerator<ContextEvent>, ms: number): Promise<ContextEvent> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([events.next().then(result => result.value as ContextEvent),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`No event within ${ms} ms`)), ms); })]);
  } finally { clearTimeout(timer); }
}

/** Whether this platform delivers file events. Some sandboxes refuse every watcher, and the backend then records outside changes on the next request. */
const fileEvents = await withFolder(async folder => {
  const watcher = watch(folder);
  const seen = new Promise<boolean>(resolve => {
    watcher.on('change', () => resolve(true)).on('error', () => resolve(false));
    setTimeout(resolve, 1000, false).unref();
  });
  await writeFile(join(folder, 'probe'), '');
  try { return await seen; } finally { watcher.close(); }
});

test('the watcher records an outside change without a request', { skip: !fileEvents && 'this platform delivers no file events' }, () => withBase(async (base, _store, record) => {
  const controller = new AbortController();
  const events = base.follow(0, controller.signal);
  try {
    assert.equal((await nextWithin(events, 1000)).type, 'sync');
    await writeFile(onDisk(record, 'user/outside.md'), 'from an editor');
    const event = await nextWithin(events, 3000);
    assert.ok(event.type === 'record' && event.record.author.type === 'external' && event.record.files[0]!.path === 'user/outside.md');
  } finally {
    controller.abort();
    await events.return(undefined);
  }
}));
