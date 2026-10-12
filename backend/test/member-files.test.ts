import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEditTool, createLsTool, createReadTool, createWriteTool } from '@earendil-works/pi-coding-agent';
import { MemberFiles, memberAccess } from '../src/member-files.js';
import { maxFileBytes } from '../src/text.js';
import { withTeam, worker, type Fixture } from './team-fixture.js';

type Tools = ReturnType<typeof tools>;
const fail = (pattern: RegExp) => (error: unknown) => pattern.test((error as Error).message);

/** Pi's own tools over one member's view of the workspace. */
async function open(fixture: Fixture, memberId: string) {
  const member = (await fixture.team.service.find(memberId))!;
  return tools(new MemberFiles(fixture.directory, memberAccess(member)), fixture.directory);
}
function tools(files: MemberFiles, root: string) {
  const text = async (result: Promise<{ content: { type: string; text?: string }[] }>) => (await result).content.map(part => part.text ?? '').join('\n');
  return {
    read: (path: string) => text(createReadTool(root, { operations: files.read }).execute('c', { path })),
    write: (path: string, content: string) => text(createWriteTool(root, { operations: files.write }).execute('c', { path, content })),
    edit: (path: string, oldText: string, newText: string) => text(createEditTool(root, { operations: files.edit }).execute('c', { path, edits: [{ oldText, newText }] })),
    ls: (path = '.') => text(createLsTool(root, { operations: files.ls }).execute('c', { path })),
  };
}
const disk = (fixture: Fixture, path: string) => readFile(join(fixture.directory, path), 'utf8');

test('the lead writes project files and all agent context, never user context', () => withTeam(async fixture => {
  const lead: Tools = await open(fixture, fixture.lead.memberId);
  await lead.write('src/main.ts', 'export {};\n');
  await lead.write('.context/agent/systems/backend/plan.md', '# Plan\n');
  assert.equal(await disk(fixture, 'src/main.ts'), 'export {};\n');
  assert.equal(await disk(fixture, '.context/agent/systems/backend/plan.md'), '# Plan\n');
  assert.match(await lead.read('src/main.ts'), /export \{\};/);
  await assert.rejects(lead.write('.context/user/spec.md', 'x'), fail(/User context changes only through the user/));
  await assert.rejects(lead.write('.context/agent/note.md', 'x').then(() => lead.write('.context/other/x.md', 'x')), fail(/only user\/ and agent\//));
}));

test('a worker writes only inside its scope but reads user context', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['agent/systems/backend']);
  await mkdir(join(fixture.directory, '.context', 'user'), { recursive: true });
  await writeFile(join(fixture.directory, '.context', 'user', 'spec.md'), 'The goal');
  await mkdir(join(fixture.directory, '.context', 'agent', 'systems', 'frontend'), { recursive: true });
  await writeFile(join(fixture.directory, '.context', 'agent', 'systems', 'frontend', 'plan.md'), 'Hidden plan');
  const files = await open(fixture, backend.memberId);

  await files.write('.context/agent/systems/backend/report.md', 'Done');
  assert.equal(await disk(fixture, '.context/agent/systems/backend/report.md'), 'Done');
  assert.match(await files.read('.context/user/spec.md'), /The goal/);
  await files.write('src/cli.ts', 'cli();');

  await assert.rejects(files.write('.context/user/spec.md', 'changed'), fail(/User context changes only through the user/));
  await assert.rejects(files.write('.context/agent/systems/frontend/plan.md', 'x'), fail(/not found/));
  await assert.rejects(files.read('.context/agent/systems/frontend/plan.md'), fail(/not found/));
  await assert.rejects(files.write('.context/agent/other.md', 'x'), fail(/outside your scope/));
  assert.equal(await disk(fixture, '.context/user/spec.md'), 'The goal');
}));

test('a member sees only what its scope lets it see', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['agent/systems/backend']);
  await mkdir(join(fixture.directory, '.context', 'agent', 'systems', 'frontend'), { recursive: true });
  await mkdir(join(fixture.directory, '.context', 'agent', 'systems', 'backend'), { recursive: true });
  await mkdir(join(fixture.directory, '.git'), { recursive: true });
  await writeFile(join(fixture.directory, 'README.md'), 'readme');
  const files = await open(fixture, backend.memberId);
  assert.match(await files.ls('.'), /README\.md/);
  assert.match(await files.ls('.'), /\.context/);
  assert.doesNotMatch(await files.ls('.'), /\.git/);
  assert.match(await files.ls('.context/agent/systems'), /backend/);
  assert.doesNotMatch(await files.ls('.context/agent/systems'), /frontend/);
  await assert.rejects(files.ls('.context/agent/systems/frontend'), fail(/not found/));
  await assert.rejects(files.read('.git/config'), fail(/not found/));
  const lead = await open(fixture, fixture.lead.memberId);
  assert.match(await lead.ls('.context/agent/systems'), /frontend/);
}));

test('paths stay inside the workspace folder and never pass through a link', () => withTeam(async fixture => {
  const lead = await open(fixture, fixture.lead.memberId);
  await mkdir(join(fixture.folder, 'outside'));
  await writeFile(join(fixture.folder, 'outside', 'secret.txt'), 'secret');
  await symlink(join(fixture.folder, 'outside'), join(fixture.directory, 'linked'));
  await assert.rejects(lead.read(join(fixture.folder, 'outside', 'secret.txt')), fail(/outside the workspace folder/));
  await assert.rejects(lead.read('../outside/secret.txt'), fail(/outside the workspace folder/));
  await assert.rejects(lead.read('linked/secret.txt'), fail(/is a link/));
  await assert.rejects(lead.write('linked/new.txt', 'x'), fail(/is a link/));
  assert.deepEqual(await readdir(join(fixture.folder, 'outside')), ['secret.txt']);
}));

test('files under .context follow the context base names and text rules', () => withTeam(async fixture => {
  const lead = await open(fixture, fixture.lead.memberId);
  await assert.rejects(lead.write('.context/agent/systems/.hidden.md', 'x'), fail(/Invalid name/));
  await assert.rejects(lead.write('.context/agent/a:b.md', 'x'), fail(/not allowed/));
  await assert.rejects(lead.write('src/big.txt', 'x'.repeat(maxFileBytes + 1)), fail(/exceeds/));
  await lead.write('src/ok.txt', 'a\n');
  await writeFile(join(fixture.directory, 'src', 'binary.bin'), Buffer.from([0, 1, 2, 255]));
  await assert.rejects(lead.read('src/binary.bin'), fail(/not UTF-8 text/));
}));

test('editing replaces one match and keeps the file otherwise', () => withTeam(async fixture => {
  const lead = await open(fixture, fixture.lead.memberId);
  await lead.write('src/a.ts', 'const a = 1;\nconst b = 2;\n');
  await lead.edit('src/a.ts', 'const b = 2;', 'const b = 3;');
  assert.equal(await disk(fixture, 'src/a.ts'), 'const a = 1;\nconst b = 3;\n');
  await assert.rejects(lead.edit('src/a.ts', 'const c = 4;', 'x'), fail(/Could not find/));
  await assert.rejects(lead.edit('src/missing.ts', 'a', 'b'), fail(/Could not edit file/));
  const worker1 = await worker(fixture, 'Backend', ['agent/systems/backend']);
  await assert.rejects((await open(fixture, worker1.memberId)).edit('.context/user/spec.md', 'a', 'b'), fail(/Could not edit file|User context/));
}));
