import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEditTool, createLsTool, createReadTool, createWriteTool } from '@earendil-works/pi-coding-agent';
import type { MemberFiles } from '../src/member-files.js';
import { maxFileBytes } from '../src/text.js';
import { withTeam, worker, type Fixture } from './team-fixture.js';

const fail = (pattern: RegExp) => (error: unknown) => pattern.test((error as Error).message);
async function open(fixture: Fixture, memberId: string) { return tools(await fixture.team.harness.files(memberId), fixture.directory); }
function tools(files: MemberFiles, root: string) {
  const text = async (result: Promise<{ content: { type: string; text?: string }[] }>) => (await result).content.map(part => part.text ?? '').join('\n');
  return {
    read: (path: string) => text(createReadTool(root, { operations: files.read }).execute('c', { path })),
    write: (path: string, content: string) => text(createWriteTool(root, { operations: files.write }).execute('c', { path, content })),
    edit: (path: string, oldText: string, newText: string) => text(createEditTool(root, { operations: files.edit }).execute('c', { path, edits: [{ oldText, newText }] })),
    ls: (path = '.') => text(createLsTool(root, { operations: files.ls }).execute('c', { path })),
  };
}
async function writableLead(fixture: Fixture) {
  await fixture.team.designs.save(fixture.workspaceId, 'user/design.json', { content: 'Whole project', implementation: ['.'] }, null, 'Test design', { type: 'lead', memberId: fixture.lead.memberId, runId: 'r' });
  await fixture.team.lead.configureHarness(fixture.lead.memberId, 'Lead', { designScope: { working: ['user/design.json'], dependencies: [] }, allowedCommands: [] });
  return open(fixture, fixture.lead.memberId);
}
test('file tools edit working implementation but keep working and dependency designs read-only', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['backend']);
  await fixture.team.designs.save(fixture.workspaceId, 'user/api.json', { content: 'API contract', implementation: ['backend/shared', 'shared/api.ts'] }, null, 'Test dependency', { type: 'lead', memberId: fixture.lead.memberId, runId: 'r' });
  await fixture.team.lead.configureHarness(fixture.lead.memberId, 'Backend', { designScope: { working: backend.harness.designScope.working, dependencies: ['user/api.json'] }, allowedCommands: [] });
  await mkdir(join(fixture.directory, 'shared'), { recursive: true });
  await mkdir(join(fixture.directory, 'backend', 'shared'), { recursive: true });
  await writeFile(join(fixture.directory, 'shared', 'api.ts'), 'api');
  await writeFile(join(fixture.directory, 'backend', 'shared', 'types.ts'), 'types');
  const file = await open(fixture, backend.memberId);
  await file.write('backend/src/main.ts', 'backend');
  assert.equal(await readFile(join(fixture.directory, 'backend', 'src', 'main.ts'), 'utf8'), 'backend');
  assert.match(await file.read('.context/user/design/backend.json'), /Design for Backend/);
  assert.match(await file.read('.context/user/api.json'), /API contract/);
  assert.match(await file.read('shared/api.ts'), /api/);
  await assert.rejects(file.write('.context/user/design/backend.json', 'x'), fail(/read-only/));
  await assert.rejects(file.write('.context/user/api.json', 'x'), fail(/read-only/));
  await assert.rejects(file.write('backend/shared/types.ts', 'x'), fail(/Dependency implementation is read-only/));
  await assert.rejects(file.write('shared/api.ts', 'x'), fail(/read-only|outside your working design/));
  await assert.rejects(file.write('frontend/a.ts', 'x'), fail(/not found/));
}));
test('scope hides unrelated implementation and context while exposing ancestors for navigation', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['src/backend.ts']);
  await mkdir(join(fixture.directory, 'src'));
  await mkdir(join(fixture.directory, '.git'));
  await writeFile(join(fixture.directory, 'src', 'frontend.ts'), 'frontend');
  await writeFile(join(fixture.directory, 'src', 'backend.ts'), 'backend');
  await writeFile(join(fixture.directory, 'README.md'), 'readme');
  const file = await open(fixture, backend.memberId);
  assert.match(await file.ls('.'), /src/);
  assert.doesNotMatch(await file.ls('.'), /README|\.git/);
  assert.match(await file.ls('src'), /backend/);
  assert.doesNotMatch(await file.ls('src'), /frontend/);
  await assert.rejects(file.read('src/frontend.ts'), fail(/not found/));
  await assert.rejects(file.read('.git/config'), fail(/not found/));
  await file.write('src/backend.ts', 'updated');
  const lead = await open(fixture, fixture.lead.memberId);
  assert.match(await lead.read('README.md'), /readme/);
  await assert.rejects(lead.write('README.md', 'x'), fail(/working design/));
}));
test('exact-file implementation mapping permits creating its missing parent directories', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['new/src/a.ts']);
  const file = await open(fixture, backend.memberId);
  await file.write('new/src/a.ts', 'created');
  assert.equal(await readFile(join(fixture.directory, 'new/src/a.ts'), 'utf8'), 'created');
  await assert.rejects(file.write('new/src/b.ts', 'x'), fail(/not found/));
}));
test('file paths stay inside the workspace, refuse links, and enforce text limits', () => withTeam(async fixture => {
  const lead = await writableLead(fixture);
  await mkdir(join(fixture.folder, 'outside'));
  await writeFile(join(fixture.folder, 'outside', 'secret.txt'), 'secret');
  await symlink(join(fixture.folder, 'outside'), join(fixture.directory, 'linked'));
  await assert.rejects(lead.read('../outside/secret.txt'), fail(/outside the workspace/));
  await assert.rejects(lead.read('linked/secret.txt'), fail(/is a link/));
  await assert.rejects(lead.write('linked/new.txt', 'x'), fail(/is a link/));
  assert.deepEqual(await readdir(join(fixture.folder, 'outside')), ['secret.txt']);
  await assert.rejects(lead.write('src/big.txt', 'x'.repeat(maxFileBytes + 1)), fail(/exceeds/));
  await lead.write('src/ok.txt', 'text');
  await writeFile(join(fixture.directory, 'src', 'binary.bin'), Buffer.from([0, 255]));
  await assert.rejects(lead.read('src/binary.bin'), fail(/not UTF-8/));
}));
test('editing replaces one match and keeps the file unchanged on a mismatch', () => withTeam(async fixture => {
  const lead = await writableLead(fixture);
  await lead.write('src/a.ts', 'const a = 1;\nconst b = 2;\n');
  await lead.edit('src/a.ts', 'const b = 2;', 'const b = 3;');
  assert.equal(await readFile(join(fixture.directory, 'src/a.ts'), 'utf8'), 'const a = 1;\nconst b = 3;\n');
  await assert.rejects(lead.edit('src/a.ts', 'missing', 'x'), fail(/Could not find/));
  await assert.rejects(lead.edit('.context/user/design.json', 'Whole project', 'Changed'), fail(/access_denied/));
}));
