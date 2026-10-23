import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ConversationContext } from '../src/core/conversation-context.js';
import { resolveHarness } from '../src/core/harness.js';
import type { StepScope } from '../src/core/agent-runtime.js';
import type { ContextEntry } from '../src/core/types.js';
import { memberContextPath } from '../src/core/workspace-layout.js';
import { seedDesign } from './design-fixture.js';
import { acceptFiles } from './git-fixture.js';
import { code, configureHarness, withTeam, worker } from './team-fixture.js';

const summary = (text: string, commands: unknown[] = []) => `# Context\n\n## Result summary\n${text}\n\n## File lookup\n| Path | Description |\n| --- | --- |\n| never-read.txt | Lookup only |\n\n## Automatic retrieval\n\n\`\`\`json\n${JSON.stringify({ commands })}\n\`\`\`\n`;

test('working roots inherit recursive nodes once with canonical casing, mapped writes and matching inspection', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['parent-src']);
  const parent = member.harness.designScope.working[0]!;
  const child = 'systems/backend/Auth/metadata.json', grandchild = 'systems/backend/Auth/cache/metadata.json';
  await seedDesign(f.workspaces, f.workspaceId, child, { content: '# Authentication', implementation: ['auth-src'] });
  await seedDesign(f.workspaces, f.workspaceId, grandchild, { content: '# Cache', implementation: ['cache-src'] });
  await seedDesign(f.workspaces, f.workspaceId, 'systems/backend-extra/metadata.json', { content: '# Sibling', implementation: ['other-src'] });
  await configureHarness(f, 'Backend', { designScope: { working: [parent, child.toLowerCase()], dependencies: [] }, allowedCommands: [] });
  const stored = (await f.team.service.find(member.memberId))!;
  const resolved = await resolveHarness(f.team.designs, f.workspaceId, stored.value.harness);
  assert.deepEqual(resolved.working.map(d => d.path).sort(), [parent, child, grandchild].sort());
  const files = await f.team.harness.files(member.memberId);
  for (const path of ['auth-src/result.ts', 'cache-src/result.ts', '.rsi/context/implement/systems/backend/Auth/cache/impl/README.md']) {
    await files.write.mkdir(join(files.root, dirname(path)));
    await files.write.writeFile(join(files.root, path), 'Child-owned implementation');
  }
  await assert.rejects(files.write.mkdir(join(files.root, 'other-src')), code('not_found'));
  await assert.rejects(files.write.writeFile(join(files.root, '.rsi/context/design/systems/backend/Auth/design.md'), '# Edit'), code('access_denied'));
  const prepared = await f.team.harness.prepare(member.memberId, []);
  assert.match(prepared.context, /# Authentication/); assert.match(prepared.context, /# Cache/);
  assert.doesNotMatch(prepared.context, /# Sibling/);
  const inspection = await f.team.inspect(f.workspaceId, member.memberId);
  assert.deepEqual(inspection.member.harness.designScope.working, [parent, child.toLowerCase()]);
  assert.deepEqual(new Set(inspection.member.harness.implementationScope.paths), new Set(['parent-src', 'auth-src', 'cache-src']));
  assert.equal(inspection.harnesses.flatMap(h => h.resources).filter(r => r.id.startsWith('implementation-context:')).length, 3);
  const lead = await f.team.harness.environment(f.lead.memberId);
  assert.equal(lead.definitions.flatMap(h => h.resources).filter(r => r.id.startsWith('implementation-context:')).length, 5, 'root assignment includes all accepted nodes');
}));

test('pending child files grant nothing; accepting them extends the existing assignment without activation', () => withTeam(async f => {
  const member = await worker(f, 'Backend', []), child = 'systems/backend/new/metadata.json';
  const folder = join(f.directory, '.rsi/context/design/systems/backend/new');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'metadata.json'), '{"implementation":["new-src"]}');
  await writeFile(join(folder, 'design.md'), '# New accepted subsystem');
  const before = await f.team.member(f.workspaceId, member.memberId);
  assert.deepEqual(before.harness.implementationScope.paths, []);
  await assert.rejects((await f.team.harness.files(member.memberId)).write.mkdir(join(f.directory, 'new-src')), code('not_found'));
  await acceptFiles(f, '.rsi/context/design', 'Accept child design');
  const after = await f.team.member(f.workspaceId, member.memberId);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.harness.designScope, before.harness.designScope);
  assert.deepEqual(after.harness.implementationScope.paths, ['new-src']);
  const prepared = await f.team.harness.prepare(member.memberId, []);
  assert.match(prepared.context, new RegExp(child.replaceAll('.', '\\.')));
}));

test('dependencies stay explicit and read-only even when a dependency node also belongs to a working subtree', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const overlap = 'systems/backend/shared/metadata.json';
  await seedDesign(f.workspaces, f.workspaceId, overlap, { content: '# Shared', implementation: ['src/shared'] });
  await seedDesign(f.workspaces, f.workspaceId, 'contracts/metadata.json', { content: '# Contracts', implementation: ['contracts-src'] });
  await seedDesign(f.workspaces, f.workspaceId, 'contracts/child/metadata.json', { content: '# Dependency child', implementation: ['contract-child-src'] });
  await configureHarness(f, 'Backend', { designScope: { working: member.harness.designScope.working, dependencies: [overlap, 'contracts/metadata.json'] }, allowedCommands: [] });
  const resolved = await resolveHarness(f.team.designs, f.workspaceId, (await f.team.service.find(member.memberId))!.value.harness);
  assert.deepEqual(resolved.dependencies.map(d => d.path), [overlap, 'contracts/metadata.json']);
  assert.ok(!resolved.readable.includes('contract-child-src'));
  const files = await f.team.harness.files(member.memberId);
  await assert.rejects(files.write.mkdir(join(files.root, 'src/shared')), code('access_denied'));
  await assert.rejects(files.write.mkdir(join(files.root, '.rsi/context/implement/systems/backend/shared/impl')), code('access_denied'));
  await assert.rejects(files.write.mkdir(join(files.root, '.rsi/context/implement/contracts/child/impl')), code('not_found'));
}));

test('accepted malformed descendants refuse effective scope instead of silently omitting them', () => withTeam(async f => {
  const member = await worker(f, 'Backend', []), base = await f.workspaces.context(f.workspaceId);
  await base.save('design/systems/backend/broken/metadata.json', '{"implementation":"invalid"}', null, null);
  await base.save('design/systems/backend/broken/design.md', '# Broken', null, null);
  const view = await f.team.member(f.workspaceId, member.memberId);
  assert.equal(view.ready, false); assert.match(view.issues.join('\n'), /metadata.json/);
  await assert.rejects(f.team.harness.files(member.memberId), code('invalid_design'));
}));

test('member context and retrieval load descendant READMEs once, without expanding lookup paths', () => withTeam(async f => {
  const member = await worker(f, 'Backend', []), child = 'systems/backend/child/metadata.json';
  await seedDesign(f.workspaces, f.workspaceId, child, { content: '# Child', implementation: [] });
  await configureHarness(f, 'Backend', { designScope: { working: [member.harness.designScope.working[0], child], dependencies: [] }, allowedCommands: [] });
  for (const [path, text] of [[memberContextPath(member.harness.designScope.working[0]!), summary('Parent result')], [memberContextPath(child), summary('Child result', [{ command: 'printf child-retrieval' }])]]) {
    await mkdir(dirname(join(f.directory, path!)), { recursive: true }); await writeFile(join(f.directory, path!), text!);
  }
  let documents: ContextEntry[] = [];
  const retrieved: string[] = [];
  const context = new ConversationContext({ prepareMemberContext: async (_agent, _run, entries) => { documents = entries; } }, f.team.harness);
  await context.prepare((await f.team.service.find(member.memberId))!, { agentId: member.memberId, runId: 'test-run', step: 1, signal: new AbortController().signal, readContext: async () => { throw new Error('Unused'); }, replaceContext: async () => { throw new Error('Unused'); }, config: {} as StepScope['config'], recordInput: async text => { retrieved.push(text); } });
  assert.equal(documents.length, 2);
  assert.match(JSON.stringify(documents), /Parent result/); assert.match(JSON.stringify(documents), /Child result/);
  assert.ok(documents.every(entry => entry.metadata.source === 'member-context'), 'lookup targets were not loaded');
  assert.equal(retrieved.length, 1); assert.match(retrieved[0]!, /child-retrieval/);
}));


test('a truncated design scan refuses resolution rather than granting a partial working subtree', () => withTeam(async f => {
  const member = await worker(f, 'Backend', []), base = await f.workspaces.context(f.workspaceId);
  const tree = base.tree.bind(base);
  base.tree = async (...args: Parameters<typeof base.tree>) => {
    const result = await tree(...args);
    return args[0] === 'design' ? { ...result, truncated: true } : result;
  };
  try { await assert.rejects(f.team.harness.files(member.memberId), code('invalid_design')); }
  finally { base.tree = tree; }
}));
