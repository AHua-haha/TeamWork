import { seedDesign } from './design-fixture.js';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEditTool, createLsTool, createReadTool, createWriteTool } from '@earendil-works/pi-coding-agent';
import type { MemberFiles } from '../src/domain/team/member-files.js';
import { maxFileBytes } from '../src/foundation/text.js';
import { configureHarness, withTeam, worker, type Fixture } from './team-fixture.js';

const fail = (pattern: RegExp) => (error: unknown) => pattern.test((error as Error).message);
async function open(fixture: Fixture, memberId: string) { const files = await fixture.team.harness.files(memberId); return tools(files, files.root); }
function tools(files: MemberFiles, root: string) {
  const text = async (result: Promise<{ content: { type: string; text?: string }[] }>) => (await result).content.map(part => part.text ?? '').join('\n');
  return {
    root,
    read: (path: string) => text(createReadTool(root, { operations: files.read }).execute('c', { path })),
    write: (path: string, content: string) => text(createWriteTool(root, { operations: files.write }).execute('c', { path, content })),
    edit: (path: string, oldText: string, newText: string) => text(createEditTool(root, { operations: files.edit }).execute('c', { path, edits: [{ oldText, newText }] })),
    ls: (path = '.') => text(createLsTool(root, { operations: files.ls }).execute('c', { path })),
  };
}
async function writableLead(fixture: Fixture) {
  await seedDesign(fixture.workspaces, fixture.workspaceId, 'metadata.json', { content: 'Whole project', implementation: ['.'] });
  await configureHarness(fixture, 'Lead', { designScope: { working: ['metadata.json'], dependencies: [] }, allowedCommands: [] });
  const result = await open(fixture, fixture.lead.memberId);
  await result.write('.rsi/context/design/metadata.json', JSON.stringify({implementation:['.']}));
  await result.write('.rsi/context/design/design.md','Whole project');
  return result;
}
test('file tools read working design and edit implementation while dependencies remain read-only', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['backend']);
  await seedDesign(fixture.workspaces, fixture.workspaceId, 'api/metadata.json', { content: 'API contract', implementation: ['backend/shared', 'shared/api.ts'] });
  await configureHarness(fixture, 'Backend', { designScope: { working: backend.harness.designScope.working, dependencies: ['api/metadata.json'] }, allowedCommands: [] });
  await mkdir(join(fixture.directory, 'shared'), { recursive: true });
  await mkdir(join(fixture.directory, 'backend', 'shared'), { recursive: true });
  await writeFile(join(fixture.directory, 'shared', 'api.ts'), 'api');
  await writeFile(join(fixture.directory, 'backend', 'shared', 'types.ts'), 'types');
  const file = await open(fixture, backend.memberId);
  await file.write('backend/src/main.ts', 'backend');
  assert.equal(await readFile(join(file.root, 'backend', 'src', 'main.ts'), 'utf8'), 'backend');
  assert.match(await file.read('.rsi/context/design/systems/backend/design.md'), /Design for Backend/);
  assert.match(await file.read('.rsi/context/design/api/design.md'), /API contract/);
  assert.match(await file.read('shared/api.ts'), /api/);
  await assert.rejects(file.write('.rsi/context/design/systems/backend/metadata.json', 'pending design'),fail(/read-only/));
  assert.deepEqual(JSON.parse(await readFile(join(file.root, '.rsi/context/design/systems/backend/metadata.json'), 'utf8')),{implementation:['backend']});
  assert.match(await readFile(join(fixture.directory, '.rsi/context/design/systems/backend/design.md'), 'utf8'), /Design for Backend/);
  await assert.rejects(file.write('.rsi/context/design/api/metadata.json', 'x'), fail(/read-only/));
  await assert.rejects(file.write('backend/shared/types.ts', 'x'), fail(/Dependency implementation is read-only/));
  await assert.rejects(file.write('shared/api.ts', 'x'), fail(/read-only|outside your configured implementation scope/));
  await assert.rejects(file.write('frontend/a.ts', 'x'), fail(/not found/));
}));
test('scope hides unrelated implementation and context while exposing ancestors for navigation', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['src/backend.ts']);
  await mkdir(join(fixture.directory, 'src'));
  await (await import('../src/domain/workspace/workspace-git.js')).gitText(fixture.directory,['init','-q']);
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
  await assert.rejects(lead.read('README.md'), fail(/not found/));
  await assert.rejects(lead.write('README.md', 'x'), fail(/not found/));
}));
test('exact-file implementation mapping permits creating its missing parent directories', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['new/src/a.ts']);
  const file = await open(fixture, backend.memberId);
  await file.write('new/src/a.ts', 'created');
  assert.equal(await readFile(join(file.root, 'new/src/a.ts'), 'utf8'), 'created');
  await assert.rejects(file.write('new/src/b.ts', 'x'), fail(/not found/));
}));
test('file paths stay inside the workspace, refuse links, and enforce text limits', () => withTeam(async fixture => {
  const lead = await writableLead(fixture);
  await mkdir(join(fixture.folder, 'outside'));
  await writeFile(join(fixture.folder, 'outside', 'secret.txt'), 'secret');
  await symlink(join(fixture.folder, 'outside'), join(lead.root, 'linked'));
  await assert.rejects(lead.read('../outside/secret.txt'), fail(/outside the workspace/));
  await assert.rejects(lead.read('linked/secret.txt'), fail(/is a link/));
  await assert.rejects(lead.write('linked/new.txt', 'x'), fail(/is a link/));
  assert.deepEqual(await readdir(join(fixture.folder, 'outside')), ['secret.txt']);
  await assert.rejects(lead.write('src/big.txt', 'x'.repeat(maxFileBytes + 1)), fail(/exceeds/));
  await lead.write('src/ok.txt', 'text');
  await writeFile(join(lead.root, 'src', 'binary.bin'), Buffer.from([0, 255]));
  await assert.rejects(lead.read('src/binary.bin'), fail(/not UTF-8/));
}));
test('editing replaces one match and keeps the file unchanged on a mismatch', () => withTeam(async fixture => {
  const lead = await writableLead(fixture);
  await lead.write('src/a.ts', 'const a = 1;\nconst b = 2;\n');
  await lead.edit('src/a.ts', 'const b = 2;', 'const b = 3;');
  assert.equal(await readFile(join(lead.root, 'src/a.ts'), 'utf8'), 'const a = 1;\nconst b = 3;\n');
  await assert.rejects(lead.edit('src/a.ts', 'missing', 'x'), fail(/Could not find/));
  await lead.edit('.rsi/context/design/design.md', 'Whole project', 'Changed');
  assert.match(await lead.read('.rsi/context/design/design.md'), /Changed/);
}));
