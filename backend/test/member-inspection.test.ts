import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { TeamSystem } from '../src/team-system.js';
import { code, stubConfig, withTeam, worker, type Fixture } from './team-fixture.js';

async function accept(f: Fixture, message = 'Accept member files') {
  const view = await f.team.currentConfiguration(f.workspaceId);
  await f.team.commitConfiguration(f.workspaceId, view.commit.revision, view.commit.base, message);
  return f.team.currentConfiguration(f.workspaceId);
}
async function activate(f: Fixture) {
  const view = await f.team.currentConfiguration(f.workspaceId);
  return f.team.activateConfiguration(f.workspaceId, view.activation.revision, view.activation.digest);
}

test('current inspection compares files with active snapshot and independently reports pending and committed states', () => withTeam(async f => {
  const workerView = await worker(f, 'Backend', ['src']);
  await f.team.configuration.materialize(f.lead.memberId);
  await accept(f); await activate(f);
  const source = await f.team.configuration.accepted(f.workspaceId, workerView.memberId), files = await f.team.harness.files(f.lead.memberId);
  const manifest = JSON.parse(source.files['member.json']!);
  await files.write.writeFile(join(files.root, source.path), JSON.stringify({ ...manifest, responsibility: 'Accepted responsibility' }));
  await accept(f, 'Update responsibility');
  await files.write.writeFile(join(files.root, dirname(source.path), 'prompts/member.md'), 'Pending instructions');
  const view = await f.team.currentConfiguration(f.workspaceId);
  assert.equal(view.status.hasPending, true);
  assert.deepEqual(view.status.pendingPaths, [join(dirname(source.path), 'prompts/member.md')]);
  assert.equal(view.status.commits.length, 1); assert.equal(view.status.commits[0]!.message, 'Update responsibility');
  assert.equal(view.status.historyKnown, true);
  assert.equal(view.changes.length, 2); assert.ok(view.changes.some(file => file.patch.includes('Pending instructions')));
  assert.equal(view.current.members.find(m => m.memberId === workerView.memberId)!.fields.responsibility, 'Accepted responsibility');
  assert.equal((await f.team.member(f.workspaceId, workerView.memberId)).responsibility, workerView.responsibility);
  await f.team.activateConfiguration(f.workspaceId, view.activation.revision, view.activation.digest);
  const next = await f.team.currentConfiguration(f.workspaceId);
  assert.equal(next.status.hasPending, true); assert.equal(next.status.commits.length, 0);
  assert.equal(next.changes.length, 1); assert.match(next.changes[0]!.patch, /Pending instructions/);
  assert.equal((await f.team.member(f.workspaceId, workerView.memberId)).responsibility, 'Accepted responsibility');
  const reopened = new TeamSystem(f.store, f.workspaces, stubConfig); reopened.attach(f.runtime);
  try { assert.deepEqual((await reopened.currentConfiguration(f.workspaceId)).active, next.active); }
  finally { await reopened.runner.close(); }
}));

test('malformed pending files remain inspectable and do not block activation of valid committed content', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']); await f.team.configuration.materialize(f.lead.memberId); await accept(f); await activate(f);
  const source = await f.team.configuration.accepted(f.workspaceId, member.memberId), files = await f.team.harness.files(f.lead.memberId);
  await files.write.writeFile(join(files.root, source.path), JSON.stringify({ ...JSON.parse(source.files['member.json']!), responsibility: 'Committed only' }));
  await accept(f);
  await files.write.writeFile(join(files.root, source.path), '{ invalid');
  const view = await f.team.currentConfiguration(f.workspaceId);
  assert.equal(view.status.valid, false); assert.equal(view.activation.valid, true);
  assert.equal(view.current.files.find(file => file.path === source.path)!.content, '{ invalid');
  await f.team.activateConfiguration(f.workspaceId, view.activation.revision, view.activation.digest);
  assert.equal((await f.team.member(f.workspaceId, member.memberId)).responsibility, 'Committed only');
  assert.equal((await f.team.currentConfiguration(f.workspaceId)).status.valid, false);
}));

test('file commit rejects changed reviewed content and activation marker participates in rollback and stale checks', () => withTeam(async f => {
  await f.team.configuration.materialize(f.lead.memberId);
  const review = await f.team.currentConfiguration(f.workspaceId), files = await f.team.harness.files(f.lead.memberId);
  const source = await f.team.configuration.accepted(f.workspaceId, f.lead.memberId);
  await files.write.writeFile(join(files.root, dirname(source.path), 'prompts/member.md'), 'Changed after review');
  await assert.rejects(f.team.commitConfiguration(f.workspaceId, review.commit.revision, review.commit.base, 'Stale'), code('stale_revision'));
  const committed = await accept(f);
  const initialMarker = await f.store.getMemberActivation(f.workspaceId);
  const original = f.store.activateMembers.bind(f.store); f.store.activateMembers = async () => { throw new Error('injected failure'); };
  await assert.rejects(f.team.activateConfiguration(f.workspaceId, committed.activation.revision, committed.activation.digest), /injected failure/);
  assert.deepEqual(await f.store.getMemberActivation(f.workspaceId), initialMarker); f.store.activateMembers = original;
  await f.team.activateConfiguration(f.workspaceId, committed.activation.revision, committed.activation.digest);
  assert.equal((await f.store.getMemberActivation(f.workspaceId))!.revision, committed.activation.revision);
  await assert.rejects(f.team.activateConfiguration(f.workspaceId, committed.activation.revision, committed.activation.digest), code('stale_revision'));
  const noChange = await f.team.currentConfiguration(f.workspaceId);
  await f.team.activateConfiguration(f.workspaceId, noChange.activation.revision, noChange.activation.digest);
  await assert.rejects(f.team.activateConfiguration(f.workspaceId, noChange.activation.revision, noChange.activation.digest), code('stale_revision'));
}));

test('binary extra files have explicit preview issues and legacy active sources retain an honest history boundary', () => withTeam(async f => {
  await f.team.configuration.materialize(f.lead.memberId);
  const files = await f.team.harness.files(f.lead.memberId);
  await writeFile(join(files.root, '.rsi/members/extra.bin'), Buffer.from([0xff, 0, 0xfe]));
  let view = await f.team.currentConfiguration(f.workspaceId);
  assert.match(view.current.files.find(file => file.path.endsWith('extra.bin'))!.problem!, /Binary/);
  assert.ok(view.changes.some(file => file.path.endsWith('extra.bin')));
  const stored = f.store.members.get(f.lead.memberId)!.member;
  stored.value.configuration!.acceptedRevision = 'old-source-reference';
  f.store.memberActivations.delete(f.workspaceId);
  view = await f.team.currentConfiguration(f.workspaceId);
  assert.equal(view.status.historyKnown, false);
}));
