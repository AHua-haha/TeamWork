import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { TeamSystem } from '../src/team-system.js';
import { code, settle, stubConfig, withTeam, worker, type Fixture } from './team-fixture.js';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const signal = () => new AbortController().signal;
const manifest = (name: string) => ({ name, role: 'developer', responsibility: `Own ${name}`, settings: {}, promptFiles: ['prompts/member.md'], designScope: { working: ['user/work.json'], dependencies: [] }, execute: { allowedCommands: [] as unknown[] } });
async function setup(f: Fixture) {
  await f.team.designs.save(f.workspaceId, 'user/work.json', { content: 'Work', implementation: ['src'] }, null, 'Test design', { type: 'lead', memberId: f.lead.memberId, runId: 'fixture' });
  await f.team.configuration.materialize(f.lead.memberId);
}
async function draft(f: Fixture, path: string, value: unknown, prompt = 'Member prompt') {
  const files = await f.team.harness.files(f.lead.memberId);
  await files.write.mkdir(join(files.root, dirname(path), 'prompts'));
  await files.write.writeFile(join(files.root, path), JSON.stringify(value));
  await files.write.writeFile(join(files.root, dirname(path), 'prompts/member.md'), prompt);
  return files;
}
async function commit(f: Fixture) {
  const part = (await f.team.harness.inspect(f.lead.memberId)).parts.find(p => p.state.part.id === 'member-config')!;
  await f.team.harness.commit(f.lead.memberId, 'member-config', 'Accept member changes', { type: 'user', memberId: f.lead.memberId }, part.revision, part.state.committed);
  return f.team.reviewConfiguration(f.workspaceId);
}
const activate = async (f: Fixture) => { const review = await commit(f); assert.equal(review.valid, true, JSON.stringify(review.issues)); return f.team.activateConfiguration(f.workspaceId, review.revision, review.digest); };

test('file validation and user commit do not activate; separate activation consumes committed bytes only', () => withTeam(async f => {
  await setup(f); const path = '.team/members/backend/member.json', value = manifest('Backend');
  const files = await draft(f, path, value, 'Accepted prompt');
  const pending = await f.team.configuration.validate(f.lead.memberId, '.team/members');
  assert.equal(pending.valid, true, JSON.stringify(pending.issues)); assert.equal(pending.changes[0]!.type, 'create');
  assert.equal((await f.team.service.active(f.workspaceId)).length, 1);
  await assert.rejects(f.team.activateConfiguration(f.workspaceId, pending.revision, pending.digest), code('stale_revision'));
  const review = await commit(f);
  assert.equal((await f.team.service.active(f.workspaceId)).length, 1, 'commit alone leaves roster unchanged');
  await files.write.writeFile(join(files.root, dirname(path), 'prompts/member.md'), 'Uncommitted prompt');
  const result = await f.team.activateConfiguration(f.workspaceId, review.revision, review.digest);
  assert.equal(result.changes.length, 1); assert.equal(f.runtime.runs.length, 0);
  const member = (await f.team.service.byName(f.workspaceId, 'Backend'))!;
  assert.equal(member.value.settings.prompt, 'Accepted prompt');
  assert.equal(member.value.configuration!.acceptedRevision, review.revision);
  assert.equal(await readFile(join(files.root, dirname(path), 'prompts/member.md'), 'utf8'), 'Uncommitted prompt');
  assert.deepEqual((await f.team.service.get(f.workspaceId, member.id)).harness.implementationScope.paths, ['src']);
  await assert.rejects(f.team.activateConfiguration(f.workspaceId, review.revision, review.digest), code('stale_revision'));
}));

test('updates allow responsibility, prompt and execute rules while preserving identity, models and assignments', () => withTeam(async f => {
  await setup(f); const path = '.team/members/backend/member.json'; await draft(f, path, manifest('Backend')); await activate(f);
  const before = (await f.team.service.byName(f.workspaceId, 'Backend'))!;
  const original = JSON.parse(before.value.configuration!.files['member.json']!);
  await draft(f, path, { ...original, responsibility: 'New responsibility', execute: { allowedCommands: [{ kind: 'executable', executable: 'bash' }] } }, 'New prompt');
  await activate(f);
  const after = (await f.team.service.byName(f.workspaceId, 'Backend'))!;
  assert.equal(after.id, before.id); assert.equal(after.revision, before.revision + 1); assert.equal(after.value.settings.modelId, before.value.settings.modelId);
  assert.equal(after.value.responsibility, 'New responsibility'); assert.equal(after.value.settings.prompt, 'New prompt');
  assert.deepEqual(after.value.harness.allowedCommands, [{ kind: 'executable', executable: 'bash' }]); assert.deepEqual(after.value.harness.designScope, before.value.harness.designScope);
  const current = JSON.parse(after.value.configuration!.files['member.json']!);
  for (const changed of [{ name: 'Renamed' }, { role: 'other' }, { settings: { modelOptions: [{ connectionId: 'conn', modelId: 'model', temperature: 0.2 }] } }, { settings: { modelId: 'other' } }, { designScope: { working: [], dependencies: ['user/work.json'] } }]) {
    await draft(f, path, { ...current, ...changed }, 'New prompt');
    const review = await f.team.configuration.validate(f.lead.memberId, '.team/members');
    assert.equal(review.valid, false); assert.ok(review.issues.some(i => i.code === 'forbidden_update'), JSON.stringify(review.issues));
    assert.deepEqual(await f.team.service.find(after.id), after);
  }
}));

test('scoped Git deletion persists through materialization/restart and activation retires without erasing history', () => withTeam(async f => {
  await setup(f); const path = '.team/members/backend/member.json'; await draft(f, path, manifest('Backend')); await activate(f);
  const member = (await f.team.service.byName(f.workspaceId, 'Backend'))!;
  f.store.agentContexts.set(member.id, [{ messageId: 'retained', message: { role: 'user', content: 'History', timestamp: 0 }, metadata: {} }]);
  const deletion = await f.team.harness.bash(f.lead.memberId, { command: `git rm -r -- ${dirname(path)}`, metadata: { git: { scope: 'member-config' } } }, signal());
  assert.equal(deletion.exitCode, 0, deletion.stderr);
  await f.team.configuration.materialize(f.lead.memberId);
  const reopened = new TeamSystem(f.store, f.workspaces, stubConfig); reopened.attach(f.runtime);
  try { await reopened.configuration.materialize(f.lead.memberId); } finally { await reopened.runner.close(); }
  const pending = await f.team.configuration.validate(f.lead.memberId, '.team/members');
  assert.equal(pending.valid, true, JSON.stringify(pending.issues)); assert.equal(pending.changes[0]!.type, 'delete');
  await activate(f); assert.equal(await f.team.service.byName(f.workspaceId, 'Backend'), undefined);
  assert.ok((await f.team.service.find(member.id))!.value.retiredAt !== null); assert.equal(f.store.agentContexts.get(member.id)![0]!.messageId, 'retained');
  assert.ok((await f.team.harness.environment(f.lead.memberId)).root);
}));

test('malformed references, lead deletion, duplicate names and base-policy overrides refuse activation without changing active state', () => withTeam(async f => {
  await setup(f); const path = '.team/members/backend/member.json', original = await f.team.service.team(f.workspaceId);
  for (const change of [{ promptFiles: ['../escape.md'] }, { promptFiles: ['prompts/missing.md'] }, { designScope: { working: ['user/missing.json'], dependencies: [] } }, { name: 'Lead' }, { extra: true }, { execute: { tools: ['anything'], allowedCommands: [] } }]) {
    await draft(f, path, { ...manifest('Backend'), ...change });
    const pending = await f.team.configuration.validate(f.lead.memberId, '.team/members'); assert.equal(pending.valid, false);
    const review = await commit(f); await assert.rejects(f.team.activateConfiguration(f.workspaceId, review.revision, review.digest), code('invalid_config'));
    assert.deepEqual(await f.team.service.team(f.workspaceId), original);
  }
  const files = await f.team.harness.files(f.lead.memberId), leadSource = await f.team.configuration.accepted(f.workspaceId, f.lead.memberId);
  await rm(join(files.root, leadSource.path)); await f.team.configuration.materialize(f.lead.memberId);
  assert.ok((await f.team.configuration.validate(f.lead.memberId, '.team/members')).issues.some(i => i.code === 'lead_required'));
  await assert.rejects(f.team.configuration.validate((await worker(f, 'Worker')).memberId, '.team/members'), code('access_denied'));
}));

test('unrelated running workspace member blocks activation; stale active/config/design reviews fail without partial application', () => withTeam(async f => {
  await setup(f); const other = await worker(f, 'Other', ['other']);
  await f.team.configuration.materialize(f.lead.memberId);
  await draft(f, '.team/members/backend/member.json', manifest('Backend'));
  const review = await commit(f); const before = await f.team.service.team(f.workspaceId);
  await f.team.runner.postUser(f.workspaceId, '@Other work');
  await assert.rejects(f.team.activateConfiguration(f.workspaceId, review.revision, review.digest), code('workspace_busy'));
  assert.deepEqual(await f.team.service.team(f.workspaceId), before);
  f.runtime.end(other.memberId); await settle();
  const design = await f.team.designs.read(f.workspaceId, 'user/work.json');
  await f.team.designs.save(f.workspaceId, design.path, { content: 'Changed design', implementation: ['src'] }, design.revision, 'Change', { type: 'lead', memberId: f.lead.memberId, runId: 'test' });
  await assert.rejects(f.team.activateConfiguration(f.workspaceId, review.revision, review.digest), code('stale_revision'));
  const refreshed = await f.team.reviewConfiguration(f.workspaceId);
  const originalActivate = f.store.activateMembers.bind(f.store); f.store.activateMembers = async () => { throw new Error('injected persistence failure'); };
  await assert.rejects(f.team.activateConfiguration(f.workspaceId, refreshed.revision, refreshed.digest), /injected persistence/);
  assert.deepEqual(await f.team.service.team(f.workspaceId), before); f.store.activateMembers = originalActivate;
  await f.team.activateConfiguration(f.workspaceId, refreshed.revision, refreshed.digest);
}));

test('create/update/delete activate together and a concurrent group input sees only the resulting team', () => withTeam(async f => {
  await setup(f);
  await draft(f, '.team/members/old/member.json', manifest('Old')); await activate(f);
  await draft(f, '.team/members/stay/member.json', manifest('Stay')); await activate(f);
  const old = (await f.team.service.byName(f.workspaceId, 'Old'))!, stay = (await f.team.service.byName(f.workspaceId, 'Stay'))!;
  const files = await f.team.harness.files(f.lead.memberId);
  await rm(join(files.root, '.team/members/old/member.json'));
  await draft(f, '.team/members/stay/member.json', { ...manifest('Stay'), responsibility: 'Changed together' });
  await draft(f, '.team/members/new/member.json', manifest('New'));
  const review = await commit(f); assert.equal(review.valid, true, JSON.stringify(review.issues));
  assert.deepEqual(review.changes.map(c => c.type).sort(), ['create', 'delete', 'update']);
  const entered = deferred(), release = deferred();
  const original = f.store.activateMembers.bind(f.store);
  f.store.activateMembers = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
  const activation = f.team.activateConfiguration(f.workspaceId, review.revision, review.digest);
  await entered.promise;
  const admission = f.team.runner.postUser(f.workspaceId, '@New start');
  assert.equal((await f.team.service.byName(f.workspaceId, 'Stay'))!.value.responsibility, stay.value.responsibility);
  release.resolve(); await activation; const accepted = await admission;
  assert.equal(accepted.runs.length, 1);
  assert.equal(await f.team.service.byName(f.workspaceId, 'Old'), undefined);
  assert.ok((await f.team.service.find(old.id))!.value.retiredAt !== null);
  assert.equal((await f.team.service.byName(f.workspaceId, 'Stay'))!.value.responsibility, 'Changed together');
  const created = (await f.team.service.byName(f.workspaceId, 'New'))!;
  assert.equal(accepted.runs[0]!.agentId, created.id);
  f.runtime.end(created.id); await settle();
}));

test('workspace finalization blocks activation even after a sender releases its mention slot', () => withTeam(async f => {
  await setup(f); await draft(f, '.team/members/backend/member.json', manifest('Backend')); const review = await commit(f);
  const finish = deferred();
  const original = f.runtime.finished.bind(f.runtime);
  f.runtime.finished = async (...args) => { const state = await original(...args); await finish.promise; return state; };
  const accepted = await f.team.runner.postUser(f.workspaceId, 'Work');
  await f.team.runner.publishFinal(f.lead.memberId, accepted.runs[0]!.runId, 'Done', 'final');
  assert.equal(f.team.runner.isRunning(f.lead.memberId), false, 'mention slot is released before finalization');
  await assert.rejects(f.team.activateConfiguration(f.workspaceId, review.revision, review.digest), code('workspace_busy'));
  finish.resolve(); await settle(); await f.team.activateConfiguration(f.workspaceId, review.revision, review.digest);
}));

test('admission already in progress takes precedence and activation refuses after its run becomes active', () => withTeam(async f => {
  await setup(f); await draft(f, '.team/members/backend/member.json', manifest('Backend')); const review = await commit(f);
  const entered = deferred(), release = deferred();
  const original = f.runtime.prepareRun.bind(f.runtime);
  f.runtime.prepareRun = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
  const admission = f.team.runner.postUser(f.workspaceId, 'Work'); await entered.promise;
  const activation = f.team.activateConfiguration(f.workspaceId, review.revision, review.digest);
  release.resolve(); await admission; await assert.rejects(activation, code('workspace_busy'));
  assert.equal(await f.team.service.byName(f.workspaceId, 'Backend'), undefined);
  f.runtime.end(f.lead.memberId); await settle();
}));

test('binary prompt bytes and an active configuration changed after review are rejected without activation', () => withTeam(async f => {
  await setup(f); const path = '.team/members/backend/member.json'; const files = await draft(f, path, manifest('Backend'));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(files.root, '.team/members/backend/prompts/member.md'), Buffer.from([0xff, 0xfe]));
  const invalid = await f.team.configuration.validate(f.lead.memberId, '.team/members');
  assert.equal(invalid.valid, false); assert.match(invalid.issues[0]!.message, /UTF-8/);
  await draft(f, path, manifest('Backend')); const review = await commit(f);
  const lead = (await f.team.service.find(f.lead.memberId))!;
  await f.team.service.update(f.workspaceId, lead.id, lead.revision, {name:lead.value.name,role:lead.value.role,responsibility:'Concurrent backend change',settings:lead.value.settings,harness:lead.value.harness});
  await assert.rejects(f.team.activateConfiguration(f.workspaceId, review.revision, review.digest), code('stale_revision'));
  assert.equal(await f.team.service.byName(f.workspaceId, 'Backend'), undefined);
}));
