import { acceptFiles } from './git-fixture.js';
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
  const files = await f.team.harness.files(f.lead.memberId);
  assert.equal(await readFile(join(files.root, source.path), 'utf8'), source.files['member.json']);
  await assert.rejects(f.team.configuration.validate(member.memberId,'.rsi/members'),code('access_denied'));
  await assert.rejects((await f.team.harness.files(member.memberId)).read.readFile(join((await f.team.harness.environment(member.memberId)).root, source.path)));
}));

test('invalid pending JSON and prompts never replace stable configuration, including after restart', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const accepted = await f.team.configuration.accepted(f.workspaceId, member.memberId);
  const stored = await f.team.service.find(member.memberId);
  const files = await f.team.harness.files(f.lead.memberId);
  await files.write.writeFile(join(files.root, accepted.path), '{invalid JSON');
  await files.write.writeFile(join(files.root, dirname(accepted.path), 'prompts/member.md'), 'Unaccepted prompt');
  assert.equal(await readFile(join(files.root, accepted.path), 'utf8'), '{invalid JSON');
  assert.deepEqual(await f.team.service.find(member.memberId), stored);
  const reopened = new TeamSystem(f.store, f.workspaces, stubConfig); reopened.attach(f.runtime);
  try { await reopened.initialize(); assert.deepEqual(await reopened.configuration.accepted(f.workspaceId, member.memberId), accepted); }
  finally { await reopened.runner.close(); }
}));

test('materialization preserves intentional deletions after seeding rather than inventing metadata', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const source = await f.team.configuration.accepted(f.workspaceId, member.memberId);
  const files = await f.team.harness.files(f.lead.memberId);
  await rm(join(files.root, dirname(source.path)), { recursive: true });
  await assert.rejects(readFile(join(files.root, source.path), 'utf8'), code('ENOENT'));
  const plan = await f.team.configuration.validate(f.lead.memberId, '.rsi/members');
  assert.ok(plan.changes.some(change => change.type === 'delete' && change.memberId === member.memberId));
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

test('user model preferences survive file activation and do not create pending member changes', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const initial = await f.team.currentConfiguration(f.workspaceId);
  const preference = { connectionId: 'conn', modelId: 'user-choice', modelOptions: [{ connectionId: 'conn', modelId: 'user-choice', reasoning: 'high' as const }] };
  await f.team.updateModelSettings(f.workspaceId, member.memberId, member.revision, preference);
  const current = await f.team.currentConfiguration(f.workspaceId);
  assert.deepEqual(current.changes,initial.changes);
  const source = await f.team.configuration.accepted(f.workspaceId,member.memberId);
  const files = await f.team.harness.files(f.lead.memberId);
  await files.write.writeFile(join(files.root, source.path),JSON.stringify({...JSON.parse(source.files['member.json']!),responsibility:'Updated responsibility'}));
  const pending = await f.team.currentConfiguration(f.workspaceId);
  assert.equal(pending.status.valid,true);
  await acceptFiles(f,'.rsi/members','Accept responsibility');
  const review = await f.team.currentConfiguration(f.workspaceId);
  await f.team.activateConfiguration(f.workspaceId,review.activation.revision,review.activation.digest);
  const active = await f.team.service.get(f.workspaceId,member.memberId);
  assert.equal(active.responsibility,'Updated responsibility'); assert.equal(active.settings.modelId,'user-choice');
  assert.equal((await f.team.service.find(member.memberId))!.value.settings.modelId,'model','manifest model remains unchanged');
}));
