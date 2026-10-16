import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { TeamSystem } from '../src/team-system.js';
import { sourceBundle } from '../src/member-config-format.js';
import { code, stubConfig, withTeam, worker } from './team-fixture.js';

const assignment = (member: Awaited<ReturnType<typeof worker>>) => ({ designScope: member.harness.designScope, allowedCommands: member.harness.allowedCommands });

test('accepted bundle contains meaningful JSON and Markdown; identity, revisions and policy stay in backend records', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const source = await f.team.configuration.accepted(f.workspaceId, member.memberId);
  const manifest = JSON.parse(source.files['member.json']!);
  assert.deepEqual(Object.keys(manifest).sort(), ['designScope', 'execute', 'name', 'promptFiles', 'responsibility', 'role', 'settings']);
  assert.deepEqual(manifest.designScope, member.harness.designScope);
  assert.equal(source.formatVersion, 4);
  assert.equal(manifest.settings.prompt, undefined);
  assert.equal(manifest.implementationScope, undefined);
  await f.team.configuration.materialize(f.lead.memberId);
  const files = await f.team.harness.files(f.lead.memberId);
  assert.equal(await readFile(join(files.root, source.path), 'utf8'), source.files['member.json']);
  await assert.rejects(f.team.configuration.materialize(member.memberId), code('access_denied'));
  await assert.rejects((await f.team.harness.files(member.memberId)).read.readFile(join((await f.team.harness.environment(member.memberId)).root, source.path)));
}));

test('invalid pending JSON and prompts never replace stable configuration, including after restart', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const accepted = await f.team.configuration.accepted(f.workspaceId, member.memberId);
  const stored = await f.team.service.find(member.memberId);
  await f.team.configuration.materialize(f.lead.memberId);
  const files = await f.team.harness.files(f.lead.memberId);
  await files.write.writeFile(join(files.root, accepted.path), '{invalid JSON');
  await files.write.writeFile(join(files.root, dirname(accepted.path), 'prompts/member.md'), 'Unaccepted prompt');
  await f.team.harness.checkpoint(f.lead.memberId, 'pending');
  await f.team.configuration.materialize(f.lead.memberId);
  assert.equal(await readFile(join(files.root, accepted.path), 'utf8'), '{invalid JSON');
  assert.deepEqual(await f.team.service.find(member.memberId), stored);
  const reopened = new TeamSystem(f.store, f.workspaces, stubConfig); reopened.attach(f.runtime);
  try { await reopened.initialize(); assert.deepEqual(await reopened.configuration.accepted(f.workspaceId, member.memberId), accepted); }
  finally { await reopened.runner.close(); }
}));

test('materialization preserves intentional deletions after seeding rather than inventing metadata', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const source = await f.team.configuration.accepted(f.workspaceId, member.memberId);
  await f.team.configuration.materialize(f.lead.memberId);
  const files = await f.team.harness.files(f.lead.memberId);
  await rm(join(files.root, dirname(source.path)), { recursive: true });
  await f.team.configuration.materialize(f.lead.memberId);
  await assert.rejects(readFile(join(files.root, source.path), 'utf8'), code('ENOENT'));
  const plan = await f.team.configuration.validate(f.lead.memberId, '.team/members');
  assert.ok(plan.changes.some(change => change.type === 'delete' && change.memberId === member.memberId));
}));

test('legacy accepted bundles migrate once, preserve exact old bytes, prompts, pending drafts and historical records', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const stored = f.store.members.get(member.memberId)!.member;
  const current = stored.value.configuration!;
  const oldManifest = { ...JSON.parse(current.files['member.json']!), version: 2, memberId: member.memberId, revision: stored.revision, designScope: undefined, harnesses: { project: { designScope: member.harness.designScope, implementationScope: { paths: ['stale'], usePaths: [] } } } };
  const oldSource = { ...sourceBundle(current.path, { ...current.files, 'member.json': JSON.stringify(oldManifest), 'prompts/member.md': 'Exact old prompt\n' }, f.lead.memberId), formatVersion: undefined };
  stored.value.configuration = oldSource;
  stored.value.settings.prompt = 'Exact old prompt\n';
  (stored.value.harness as unknown as Record<string, unknown>).implementationScope = { paths: ['stale'], usePaths: [] };
  const before = structuredClone(stored);
  await f.team.configuration.materialize(f.lead.memberId);
  const leadFiles = await f.team.harness.files(f.lead.memberId);
  await leadFiles.write.writeFile(join(leadFiles.root, current.path), 'Existing pending bytes');
  const files = await f.team.harness.files(member.memberId);
  await files.write.mkdir(join(files.root, 'src')); await files.write.writeFile(join(files.root, 'src/pending.txt'), 'Keep pending implementation');
  await f.team.initialize();
  const migrated = (await f.team.service.find(member.memberId))!;
  const source = await f.team.configuration.accepted(f.workspaceId, member.memberId);
  assert.equal(migrated.revision, before.revision + 1);
  assert.deepEqual(migrated.value.settings, before.value.settings);
  assert.equal(source.formatVersion, 4); assert.deepEqual(source.previous, oldSource);
  const manifest = JSON.parse(source.files['member.json']!);
  assert.equal(manifest.version, undefined); assert.equal(manifest.memberId, undefined); assert.equal(manifest.revision, undefined);
  assert.deepEqual(manifest.designScope, member.harness.designScope);
  assert.equal(source.files['prompts/member.md'], 'Exact old prompt\n');
  assert.equal((migrated.value.harness as unknown as Record<string, unknown>).implementationScope, undefined);
  assert.deepEqual((await f.team.service.get(f.workspaceId, member.memberId)).harness.implementationScope.paths, ['src']);
  assert.equal(await readFile(join(files.root, 'src/pending.txt'), 'utf8'), 'Keep pending implementation');
  await f.team.configuration.materialize(f.lead.memberId);
  assert.equal(await readFile(join(leadFiles.root, current.path), 'utf8'), 'Existing pending bytes');
  await f.team.initialize(); assert.deepEqual(await f.team.service.find(member.memberId), migrated);
}));

test('runtime admission still rejects an actual concurrent backend configuration update', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  f.runtime.prepareRun = async () => {
    await f.team.service.update(f.workspaceId, member.memberId, member.revision, { name: member.name, role: member.role, responsibility: member.responsibility, harness: assignment(member), settings: { ...member.settings, prompt: 'new' } });
    return {} as never;
  };
  await assert.rejects(f.team.runner.postUser(f.workspaceId, '@Backend start'), code('config_conflict'));
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).messages.length, 0);
  assert.equal(f.runtime.runs.length, 0);
}));

test('version-three sources gain execute assignment from backend policy once without rewriting existing drafts', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const stored = f.store.members.get(member.memberId)!.member;
  const { execute: _execute, ...manifest } = JSON.parse(stored.value.configuration!.files['member.json']!);
  stored.value.harness.allowedCommands = [{kind:'executable',executable:'bash'}];
  const old = { ...sourceBundle(stored.value.configuration!.path,{...stored.value.configuration!.files,'member.json':JSON.stringify(manifest)},'user'),formatVersion:3 };
  stored.value.configuration = old;
  await f.team.configuration.materialize(f.lead.memberId);
  const files = await f.team.harness.files(f.lead.memberId);
  await f.team.initialize();
  const migrated = await f.team.configuration.accepted(f.workspaceId,member.memberId);
  assert.deepEqual(JSON.parse(migrated.files['member.json']!).execute,{allowedCommands:[{kind:'executable',executable:'bash'}]});
  assert.deepEqual(migrated.previous,old);
  assert.equal(await readFile(join(files.root,old.path),'utf8'),old.files['member.json']);
}));
