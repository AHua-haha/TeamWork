import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { resolveAssignment } from '../src/core/team/member-workspace.js';
import { seedDesign } from './design-fixture.js';
import { acceptFiles } from './git-fixture.js';
import { code, configureHarness, withTeam, worker } from './team-fixture.js';

test('working roots inherit recursive nodes once with canonical casing, implementation mappings and matching inspection', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['parent-src']);
  const parent = member.harness.designScope.working[0]!;
  const child = 'systems/backend/Auth/metadata.json', grandchild = 'systems/backend/Auth/cache/metadata.json';
  await seedDesign(f.workspaces, f.workspaceId, child, { content: '# Authentication', implementation: ['auth-src'] });
  await seedDesign(f.workspaces, f.workspaceId, grandchild, { content: '# Cache', implementation: ['cache-src'] });
  await seedDesign(f.workspaces, f.workspaceId, 'systems/backend-extra/metadata.json', { content: '# Sibling', implementation: ['other-src'] });
  await configureHarness(f, 'Backend', { designScope: { working: [parent, child.toLowerCase()], dependencies: [] }, allowedCommands: [] });
  const stored = (await f.team.service.find(member.memberId))!;
  const resolved = await resolveAssignment(f.team.designs, f.workspaceId, stored.value.harness);
  assert.deepEqual(resolved.working.map(d => d.path).sort(), [parent, child, grandchild].sort());
  const files = await f.team.memberWorkspace.files(member.memberId);
  for (const path of ['auth-src/result.ts', 'cache-src/result.ts', '.rsi/context/implement/systems/backend/Auth/cache/impl/README.md']) {
    await files.write.mkdir(join(files.root, dirname(path)));
    await files.write.writeFile(join(files.root, path), 'Child-owned implementation');
  }
  await files.write.mkdir(join(files.root,'other-src'));
  await files.write.writeFile(join(files.root,'.rsi/context/design/systems/backend/Auth/design.md'),'# Edit');
  const context = await f.team.memberWorkspace.guidance(member.memberId);
  assert.match(context, /# Authentication/); assert.match(context, /# Cache/);
  assert.doesNotMatch(context, /# Sibling/);
  const inspection = await f.team.inspect(f.workspaceId, member.memberId);
  assert.deepEqual(inspection.member.harness.designScope.working, [parent, child.toLowerCase()]);
  assert.deepEqual(new Set(inspection.member.harness.implementationScope.paths), new Set(['parent-src', 'auth-src', 'cache-src']));
  assert.equal((await resolveAssignment(f.team.designs,f.workspaceId,(await f.team.service.find(f.lead.memberId))!.value.harness)).working.length,5);
}));

test('pending child files grant nothing; accepting them extends the existing assignment without activation', () => withTeam(async f => {
  const member = await worker(f, 'Backend', []), child = 'systems/backend/new/metadata.json';
  const folder = join(f.directory, '.rsi/context/design/systems/backend/new');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'metadata.json'), '{"implementation":["new-src"]}');
  await writeFile(join(folder, 'design.md'), '# New accepted subsystem');
  const before = await f.team.member(f.workspaceId, member.memberId);
  assert.deepEqual(before.harness.implementationScope.paths, []);
  assert.doesNotMatch(await f.team.memberWorkspace.guidance(member.memberId),/# New accepted subsystem/);
  await acceptFiles(f, '.rsi/context/design', 'Accept child design');
  const after = await f.team.member(f.workspaceId, member.memberId);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.harness.designScope, before.harness.designScope);
  assert.deepEqual(after.harness.implementationScope.paths, ['new-src']);
  const context = await f.team.memberWorkspace.guidance(member.memberId);
  assert.match(context, new RegExp(child.replaceAll('.', '\\.')));
}));

test('dependency guidance stays explicit even when a dependency node also belongs to a working subtree', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const overlap = 'systems/backend/shared/metadata.json';
  await seedDesign(f.workspaces, f.workspaceId, overlap, { content: '# Shared', implementation: ['src/shared'] });
  await seedDesign(f.workspaces, f.workspaceId, 'contracts/metadata.json', { content: '# Contracts', implementation: ['contracts-src'] });
  await seedDesign(f.workspaces, f.workspaceId, 'contracts/child/metadata.json', { content: '# Dependency child', implementation: ['contract-child-src'] });
  await configureHarness(f, 'Backend', { designScope: { working: member.harness.designScope.working, dependencies: [overlap, 'contracts/metadata.json'] }, allowedCommands: [] });
  const resolved = await resolveAssignment(f.team.designs, f.workspaceId, (await f.team.service.find(member.memberId))!.value.harness);
  assert.deepEqual(resolved.dependencies.map(d => d.path), [overlap, 'contracts/metadata.json']);
  assert.ok(!resolved.readable.includes('contract-child-src'));
  const files = await f.team.memberWorkspace.files(member.memberId);
  await files.write.mkdir(join(files.root, 'src/shared'));
  await files.write.mkdir(join(files.root, '.rsi/context/implement/systems/backend/shared/impl'));
  await files.write.mkdir(join(files.root, '.rsi/context/implement/contracts/child/impl'));
}));

test('accepted malformed descendants refuse effective scope instead of silently omitting them', () => withTeam(async f => {
  const member = await worker(f, 'Backend', []), base = await f.workspaces.context(f.workspaceId);
  await base.save('design/systems/backend/broken/metadata.json', '{"implementation":"invalid"}', null, null);
  await base.save('design/systems/backend/broken/design.md', '# Broken', null, null);
  const view = await f.team.member(f.workspaceId, member.memberId);
  assert.equal(view.ready, false); assert.match(view.issues.join('\n'), /metadata.json/);
  await assert.rejects(f.team.memberWorkspace.guidance(member.memberId), code('invalid_design'));
}));

test('a truncated design scan refuses resolution rather than granting a partial working subtree', () => withTeam(async f => {
  const member = await worker(f, 'Backend', []), base = await f.workspaces.context(f.workspaceId);
  const tree = base.tree.bind(base);
  base.tree = async (...args: Parameters<typeof base.tree>) => {
    const result = await tree(...args);
    return args[0] === 'design' ? { ...result, truncated: true } : result;
  };
  try { await assert.rejects(f.team.memberWorkspace.guidance(member.memberId), code('invalid_design')); }
  finally { base.tree = tree; }
}));
