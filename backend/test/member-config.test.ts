import assert from 'node:assert/strict';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { emptyHarness } from '../src/harness-config.js';
import { TeamSystem } from '../src/team-system.js';
import { leadTools } from '../src/lead-tools.js';
import { HarnessHistory, harnessStorage, type HarnessPart } from '../src/harness-history.js';
import { code, configureHarness, settle, stubConfig, withTeam, worker, type Fixture } from './team-fixture.js';

const path = '.team/members/backend/member.json';
const manifest = () => ({
  version: 1, memberId: null as string | null, revision: null as number | null,
  name: 'Backend', role: 'developer', responsibility: 'Implement the project', settings: {},
  promptFiles: ['prompts/member.md'],
  harnesses: { design: { working: [] as string[], dependencies: [] as string[] }, implementation: { paths: ['src'], usePaths: ['shared'] } },
});
async function draft(f: Fixture, value: unknown, prompts = 'Be concise.\n') {
  const files = await f.team.harness.files(f.lead.memberId);
  await files.write.mkdir(join(files.root, '.team/members/backend/prompts'));
  await files.write.writeFile(join(files.root, path), JSON.stringify(value, null, 2) + '\n');
  await files.write.writeFile(join(files.root, '.team/members/backend/prompts/member.md'), prompts);
  return files;
}
const submit = (f: Fixture) => f.team.configuration.submit(f.lead.memberId, path);

test('submitted manifest and prompt bytes are durable, pending edits and checkpoints do not activate them', () => withTeam(async f => {
  const m = manifest();
  const files = await draft(f, m);
  assert.equal(await f.team.service.byName(f.workspaceId, 'Backend'), undefined);
  const result = await submit(f);
  const id = result.member.memberId;
  assert.equal(result.member.ready, true, 'implementation-only member can run');
  const first = await f.team.configuration.accepted(f.workspaceId, id);
  assert.equal(first.files['member.json'], JSON.stringify(m, null, 2) + '\n');
  assert.equal(first.files['prompts/member.md'], 'Be concise.\n');
  assert.equal(result.member.settings.prompt, 'Be concise.\n');
  await files.write.writeFile(join(files.root, '.team/members/backend/prompts/member.md'), 'Pending prompt');
  await f.team.harness.checkpoint(f.lead.memberId, 'draft-only');
  await f.team.harness.commit(f.lead.memberId, 'member-config', 'Save draft only', { type: 'agent', memberId: f.lead.memberId });
  assert.equal((await f.team.service.get(f.workspaceId, id)).settings.prompt, 'Be concise.\n');
  m.memberId = id; m.revision = result.member.revision;
  await files.write.writeFile(join(files.root, path), JSON.stringify(m));
  const next = await submit(f);
  assert.equal(next.member.settings.prompt, 'Pending prompt');
  assert.notEqual(next.source.digest, first.digest);
  const reopened = new TeamSystem(f.store, f.workspaces, stubConfig);
  reopened.attach(f.runtime);
  try {
    assert.equal((await reopened.service.get(f.workspaceId, id)).settings.prompt, 'Pending prompt');
    assert.deepEqual(await reopened.configuration.accepted(f.workspaceId, id), await f.team.configuration.accepted(f.workspaceId, id));
  } finally { await reopened.runner.close(); }
}));

test('invalid fields, fixed policy overrides, escaping prompts and missing references preserve accepted config', () => withTeam(async f => {
  const m = manifest();
  const files = await draft(f, m);
  const initial = await submit(f);
  m.memberId = initial.member.memberId; m.revision = initial.member.revision;
  const before = await f.team.service.find(m.memberId);
  const invalid: unknown[] = [
    { ...m, version: 2 }, { ...m, extra: true },
    { ...m, harnesses: { ...m.harnesses, command: { allowedCommands: [] } } },
    { ...m, harnesses: { ...m.harnesses, design: { working: [], dependencies: [], commit: 'agent' } } },
    { ...m, harnesses: { ...m.harnesses, implementation: { paths: ['.team'], usePaths: [] } } },
    { ...m, harnesses: { ...m.harnesses, implementation: { paths: ['../outside'], usePaths: [] } } },
    { ...m, harnesses: { ...m.harnesses, design: { working: ['user/missing.json'], dependencies: [] } } },
    { ...m, promptFiles: ['../outside.md'] }, { ...m, promptFiles: ['prompts/../../outside.md'] },
    { ...m, promptFiles: ['prompts/missing.md'] }, { ...m, settings: { prompt: 'Inline instructions are forbidden' } },
    { ...m, settings: { modelId: null } },
    { ...m, settings: { toolOptionIds: ['unscoped'] } },
  ];
  for (const value of invalid) {
    await files.write.writeFile(join(files.root, path), JSON.stringify(value));
    await assert.rejects(submit(f));
    assert.deepEqual(await f.team.service.find(m.memberId), before);
  }
  await files.write.writeFile(join(files.root, path), '{invalid JSON');
  await assert.rejects(submit(f), code('invalid_config'));
  await f.team.configuration.materialize(f.lead.memberId);
  assert.equal(await readFile(join(files.root, path), 'utf8'), '{invalid JSON', 'discovery never overwrites a broken draft');
  await files.write.writeFile(join(files.root, path), JSON.stringify(m));
  const promptPath = join(files.root, '.team/members/backend/prompts/member.md');
  await rm(promptPath);
  const outside = join(f.folder, 'outside.md'); await writeFile(outside, 'outside'); await symlink(outside, promptPath);
  await assert.rejects(submit(f), code('invalid_path'));
  assert.deepEqual(await f.team.service.find(m.memberId), before);
}));

test('submission enforces accepted lead authority, target workspace, revisions and busy state', () => withTeam(async f => {
  const m = manifest(); await draft(f, m);
  const first = await submit(f);
  const id = first.member.memberId;
  await assert.rejects(f.team.configuration.submit(id, path), code('access_denied'));
  await assert.rejects(submit(f), code('config_conflict'), 'same create file cannot create a second member');
  m.memberId = id; m.revision = first.member.revision;
  await draft(f, m);
  await f.team.runner.postUser(f.workspaceId, '@Backend work');
  await assert.rejects(submit(f), code('member_busy'));
  f.runtime.end(id); await settle();
  const both = await Promise.allSettled([submit(f), submit(f)]);
  assert.equal(both.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(both.filter(r => r.status === 'rejected' && code('config_conflict')(r.reason)).length, 1);
  const other = await f.workspaces.create({ name: 'Other', directory: join(f.folder, 'other'), adopt: false });
  const foreign = (await f.team.service.team(other.workspaceId)).members[0]!;
  await draft(f, { ...m, memberId: foreign.memberId, revision: foreign.revision });
  await assert.rejects(submit(f), code('not_found'));
  const currentLead = (await f.team.service.find(f.lead.memberId))!;
  await draft(f, { ...m, memberId: currentLead.id, revision: currentLead.revision, name: 'Evil', role: 'Lead' });
  await assert.rejects(submit(f), code('access_denied'));
}));

test('source persistence failures activate nothing and user edits retain an accepted file representation', () => withTeam(async f => {
  const m = manifest(); await draft(f, m); const first = await submit(f);
  m.memberId = first.member.memberId; m.revision = first.member.revision;
  await draft(f, m, 'Changed instructions');
  const update = f.store.updateMember.bind(f.store);
  f.store.updateMember = async () => { throw new Error('database unavailable'); };
  const before = await f.team.service.find(m.memberId);
  await assert.rejects(submit(f), /database unavailable/);
  assert.deepEqual(await f.team.service.find(m.memberId), before);
  f.store.updateMember = update;
  const fields = first.member;
  const updated = await f.team.update(f.workspaceId, m.memberId, m.revision, { name: fields.name, role: fields.role, responsibility: fields.responsibility, harness: fields.harness, settings: { ...fields.settings, prompt: 'User setting' } });
  const source = await f.team.configuration.accepted(f.workspaceId, m.memberId);
  assert.equal(source.path, path);
  assert.equal(source.files['prompts/member.md'], updated.settings.prompt);
  assert.equal(source.submittedBy, 'user');
  await assert.rejects(submit(f), code('config_conflict'));
}));

test('fixed purpose bases keep tools and approval while scope grants are independent of design mappings', () => withTeam(async f => {
  const design = await worker(f, 'Example', ['mapped']);
  const m = manifest(); m.harnesses.design.working = design.harness.designScope.working;
  m.harnesses.implementation = { paths: ['src'], usePaths: ['src/shared'] };
  await draft(f, m); const result = await submit(f);
  const id = result.member.memberId, files = await f.team.harness.files(id);
  await files.write.mkdir(join(files.root, 'src')); await files.write.writeFile(join(files.root, 'src/result.ts'), 'ok');
  await assert.rejects(files.write.writeFile(join(files.root, 'mapped/result.ts'), 'no'));
  await assert.rejects(files.write.writeFile(join(files.root, 'src/shared/types.ts'), 'no'));
  await assert.rejects(files.read.readFile(join(files.root, path)));
  const context = await f.team.harness.prepare(id, []);
  assert.ok(!context.tools.some(t => ['submit_member_config', 'create_member', 'configure_harness', 'run_command'].includes(t.definition.name)));
  assert.match(context.context, /Design commits require explicit user approval/);
  await assert.rejects(f.team.harness.commit(id, 'design', 'Self approval', { type: 'agent', memberId: id }), code('approval_required'));
  assert.equal((await f.team.harness.commit(id, 'implementation', 'Implement result', { type: 'agent', memberId: id })).kind, 'commit');
}));

test('migration freezes old mapped scopes once and command allowances remain outside agent-editable assignments', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const stored = f.store.members.get(member.memberId)!.member;
  const { implementationScope: _scope, ...legacy } = stored.value.harness;
  stored.value.harness = legacy as never;
  delete stored.value.configuration;
  await f.team.initialize();
  const migrated = (await f.team.service.find(member.memberId))!;
  assert.deepEqual(migrated.value.harness.implementationScope, { paths: ['src'], usePaths: [] });
  await f.team.initialize();
  assert.equal((await f.team.service.find(member.memberId))!.revision, migrated.revision);
  await configureHarness(f, 'Lead', { ...emptyHarness(), allowedCommands: [{ kind: 'exact', argv: ['node', '--version'] }] });
  const m = manifest(); m.name = 'Commands'; await draft(f, m);
  const result = await submit(f);
  assert.deepEqual(result.member.harness.allowedCommands, [{ kind: 'exact', argv: ['node', '--version'] }]);
  m.memberId = result.member.memberId; m.revision = result.member.revision;
  await configureHarness(f, 'Lead', emptyHarness());
  await draft(f, m); const updated = await submit(f);
  assert.deepEqual(updated.member.harness.allowedCommands, result.member.harness.allowedCommands, 'update preserves target allowances');
  const tools = leadTools(f.team.configuration);
  assert.deepEqual(tools.map(t => t.definition.name), ['submit_member_config']);
  const source = await f.team.configuration.accepted(f.workspaceId, updated.member.memberId);
  const leadRoot = (await f.team.harness.environment(f.lead.memberId)).root;
  await rm(join(leadRoot, dirname(source.path)), { recursive: true });
  await f.team.configuration.materialize(f.lead.memberId);
  const restored = JSON.parse(await readFile(join(leadRoot, source.path), 'utf8'));
  assert.equal(restored.memberId, updated.member.memberId);
  assert.equal(restored.revision, updated.member.revision);
}));

test('activation refuses a configuration revision changed after preparation', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  // Inject an actual concurrent update between configuration resolution and DB admission.
  f.runtime.prepareRun = async () => {
    await f.team.service.update(f.workspaceId, member.memberId, member.revision, { name: member.name, role: member.role, responsibility: member.responsibility, harness: member.harness, settings: { ...member.settings, prompt: 'new' } });
    return {} as never;
  };
  await assert.rejects(f.team.runner.postUser(f.workspaceId, '@Backend start'), code('config_conflict'));
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).messages.length, 0);
  assert.equal(f.runtime.runs.length, 0);
}));

test('legacy Git boundary migration preserves accepted and pending implementation files without resetting the worktree', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['.']);
  await mkdir(join(f.directory, 'src'));
  await writeFile(join(f.directory, 'src/result.txt'), 'Original');
  const history = new HarnessHistory(harnessStorage(f.directory), f.directory);
  const root = await history.worktree(member.memberId);
  const previous: HarnessPart = { id: 'implementation', paths: ['.'], exclude: ['.context'], commit: 'agent', prompt: '' };
  const state = await history.ensure(member.memberId, previous, root);
  await writeFile(join(root, 'src/result.txt'), 'Accepted implementation');
  const actor = { type: 'agent' as const, memberId: member.memberId };
  const checkpoint = await history.checkpoint(member.memberId, previous, root, actor, 'Ready');
  await history.commit(member.memberId, previous, root, checkpoint.revision, state.committed, 'Implement result', actor);
  await writeFile(join(root, 'src/result.txt'), 'Pending follow-up');
  const saved = f.store.members.get(member.memberId)!.member;
  const { implementationScope: _scope, ...legacy } = saved.value.harness;
  saved.value.harness = legacy as never;
  delete saved.value.configuration;
  await f.team.initialize();
  const review = await f.team.harness.inspect(member.memberId);
  const implementation = review.parts.find(p => p.state.part.id === 'implementation')!;
  assert.equal(await readFile(join(root, 'src/result.txt'), 'utf8'), 'Pending follow-up');
  assert.equal(await history.readSnapshot(implementation.state.committed, 'src/result.txt'), 'Accepted implementation');
  assert.match(implementation.diff, /Pending follow-up/);
  assert.ok((await history.history(member.memberId, previous, root)).some(r => r.message === 'Implement result'), 'old history remains reachable');
}));
