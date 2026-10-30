import {resolveAssignment} from '../src/core/team/member-workspace.js';
import { seedDesign } from './design-fixture.js';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { TeamSystem } from '../src/core/team/team-system.js';
import { code, settle, stubConfig, withTeam, worker, type Fixture } from './team-fixture.js';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const manifest = (name: string) => ({ name, role: 'developer', responsibility: `Own ${name}`, settings: {}, designScope: { working: ['work/metadata.json'], dependencies: [] } });
async function setup(f: Fixture) {
  await seedDesign(f.workspaces, f.workspaceId, 'work/metadata.json', { content: 'Work', implementation: ['src'] });
  }
async function draft(f: Fixture, path: string, value: unknown, prompt = 'Member prompt') {
  const files = await f.team.memberWorkspace.files(f.lead.memberId);
  await files.write.mkdir(join(files.root, dirname(path), 'prompts'));
  await files.write.writeFile(join(files.root, path), JSON.stringify(value));
  await files.write.writeFile(join(files.root, dirname(path), 'agent.md'), prompt);
  return files;
}
const validate=(f:Fixture)=>f.team.configuration.validate(f.lead.memberId,'.rsi/members');
const activate = async (f: Fixture) => { const review = await validate(f); assert.equal(review.valid, true, JSON.stringify(review.issues)); return f.team.activateConfiguration(f.workspaceId); };

test('activation reads current files without a repository; later edits stay inactive across restart', () => withTeam(async f => {
  await setup(f); const path='.rsi/members/Backend/member.json';
  const files=await draft(f,path,manifest('Backend'),'First prompt');
  assert.equal((await validate(f)).valid,true);
  assert.equal((await f.team.service.active(f.workspaceId)).length,1,'validation does not activate');
  await files.write.writeFile(join(files.root,dirname(path),'agent.md'),'Latest file prompt');
  const result=await f.team.activateConfiguration(f.workspaceId);
  assert.equal(result.changes.length,1);assert.match(result.revision,/^[0-9a-f-]{36}$/);
  const member=(await f.team.service.byName(f.workspaceId,'Backend'))!;
  assert.equal(member.value.settings.prompt,'Latest file prompt');
  assert.equal('acceptedRevision' in member.value.configuration!,false);
  await assert.rejects(readFile(join(f.directory,'.git/HEAD')),code('ENOENT'));
  await files.write.writeFile(join(files.root,dirname(path),'agent.md'),'Not activated');
  const reopened=new TeamSystem(f.store,f.workspaces,stubConfig);reopened.attach(f.runtime);
  try {await reopened.initialize();assert.equal((await reopened.service.find(member.id))!.value.settings.prompt,'Latest file prompt');}
  finally {await reopened.runner.close();}
  assert.deepEqual((await resolveAssignment(f.team.designs,f.workspaceId,member.value.designScope)).working.flatMap(d=>d.implementation),['work']);
  const repeat=await f.team.activateConfiguration(f.workspaceId);assert.equal(repeat.changes.length,1);
  assert.equal((await f.team.service.find(member.id))!.value.settings.prompt,'Not activated');
  assert.deepEqual((await f.team.activateConfiguration(f.workspaceId)).changes,[]);
}));

test('updates allow responsibility and prompts while preserving identity, models and assignments', () => withTeam(async f => {
  await setup(f); const path = '.rsi/members/Backend/member.json'; await draft(f, path, manifest('Backend')); await activate(f);
  const before = (await f.team.service.byName(f.workspaceId, 'Backend'))!;
  const original = JSON.parse(before.value.configuration!.files['member.json']!);
  await draft(f, path, { ...original, responsibility: 'New responsibility' }, 'New prompt');
  await activate(f);
  const after = (await f.team.service.byName(f.workspaceId, 'Backend'))!;
  assert.equal(after.id, before.id); assert.equal(after.revision, before.revision + 1); assert.equal(after.value.settings.modelId, before.value.settings.modelId);
  assert.equal(after.value.responsibility, 'New responsibility'); assert.equal(after.value.settings.prompt, 'New prompt');
  assert.deepEqual(after.value.designScope, before.value.designScope);
  const current = JSON.parse(after.value.configuration!.files['member.json']!);
  for (const changed of [{ name: 'Renamed' }, { role: 'other' }, { settings: { modelOptions: [{ connectionId: 'conn', modelId: 'model', temperature: 0.2 }] } }, { settings: { modelId: 'other' } }, { designScope: { working: [], dependencies: ['work/metadata.json'] } }]) {
    await draft(f, path, { ...current, ...changed }, 'New prompt');
    const review = await f.team.configuration.validate(f.lead.memberId, '.rsi/members');
    assert.equal(review.valid, false); assert.ok(review.issues.some(i => i.code === 'forbidden_update'), JSON.stringify(review.issues));
    assert.deepEqual(await f.team.service.find(after.id), after);
  }
}));

test('filesystem deletion persists through materialization/restart and activation retires without erasing history', () => withTeam(async f => {
  await setup(f); const path = '.rsi/members/Backend/member.json'; await draft(f, path, manifest('Backend')); await activate(f);
  const member = (await f.team.service.byName(f.workspaceId, 'Backend'))!;
  f.store.agentContexts.set(member.id, [{ messageId: 'retained', message: { role: 'user', content: 'History', timestamp: 0 }, metadata: {} }]);
  await rm(join(f.directory,dirname(path)),{recursive:true});
  const reopened = new TeamSystem(f.store, f.workspaces, stubConfig); reopened.attach(f.runtime);
  try { await reopened.initialize(); } finally { await reopened.runner.close(); }
  const pending = await f.team.configuration.validate(f.lead.memberId, '.rsi/members');
  assert.equal(pending.valid, true, JSON.stringify(pending.issues)); assert.equal(pending.changes[0]!.type, 'delete');
  await activate(f); assert.equal(await f.team.service.byName(f.workspaceId, 'Backend'), undefined);
  assert.ok((await f.team.service.find(member.id))!.value.retiredAt !== null); assert.equal(f.store.agentContexts.get(member.id)![0]!.messageId, 'retained');
  assert.ok((await f.team.memberWorkspace.root(f.lead.memberId)));
}));

test('malformed references, lead deletion, duplicate names and base-policy overrides refuse activation without changing active state', () => withTeam(async f => {
  await setup(f); const path = '.rsi/members/Backend/member.json', original = await f.team.service.team(f.workspaceId);
  for (const change of [{ promptFiles: [] }, { settings: {promptOptionIds: []} }, { designScope: { working: ['missing/metadata.json'], dependencies: [] } }, { name: 'Lead' }, { extra: true }, { execute: {allowedCommands: []} }]) {
    await draft(f, path, { ...manifest('Backend'), ...change });
    const pending = await f.team.configuration.validate(f.lead.memberId, '.rsi/members'); assert.equal(pending.valid, false);
    const review = await validate(f); await assert.rejects(f.team.activateConfiguration(f.workspaceId), code('invalid_config'));
    assert.deepEqual(await f.team.service.team(f.workspaceId), original);
  }
  const files = await f.team.memberWorkspace.files(f.lead.memberId), leadSource = await f.team.configuration.activeSource(f.workspaceId, f.lead.memberId);
  await rm(join(files.root, leadSource.path)); assert.ok((await f.team.configuration.validate(f.lead.memberId, '.rsi/members')).issues.some(i => i.code === 'lead_required'));
  await f.team.configuration.validate((await worker(f, 'Worker')).memberId,'.rsi/members');
}));

test('unrelated running member blocks activation and a persistence failure leaves active state intact', () => withTeam(async f => {
  await setup(f); const other = await worker(f, 'Other', ['other']);
  await draft(f, '.rsi/members/Backend/member.json', manifest('Backend'));
  const review = await validate(f); const before = await f.team.service.team(f.workspaceId);
  await f.team.runner.postUser(f.workspaceId, '@Other work');
  await assert.rejects(f.team.activateConfiguration(f.workspaceId), code('workspace_busy'));
  assert.deepEqual(await f.team.service.team(f.workspaceId), before);
  f.runtime.end(other.memberId); await settle();
  const design = await f.team.designs.read(f.workspaceId, 'work/metadata.json');
  await seedDesign(f.workspaces, f.workspaceId, design.path, { content: 'Changed design', implementation: ['src'] });
  const originalActivate = f.store.activateMembers.bind(f.store); f.store.activateMembers = async () => { throw new Error('injected persistence failure'); };
  await assert.rejects(f.team.activateConfiguration(f.workspaceId), /injected persistence/);
  assert.deepEqual(await f.team.service.team(f.workspaceId), before); f.store.activateMembers = originalActivate;
  await f.team.activateConfiguration(f.workspaceId);
}));

test('create/update/delete activate together and a concurrent group input sees only the resulting team', () => withTeam(async f => {
  await setup(f);
  await draft(f, '.rsi/members/Old/member.json', manifest('Old')); await activate(f);
  await draft(f, '.rsi/members/Stay/member.json', manifest('Stay')); await activate(f);
  const old = (await f.team.service.byName(f.workspaceId, 'Old'))!, stay = (await f.team.service.byName(f.workspaceId, 'Stay'))!;
  const files = await f.team.memberWorkspace.files(f.lead.memberId);
  await rm(join(files.root, '.rsi/members/Old/member.json'));
  await draft(f, '.rsi/members/Stay/member.json', { ...manifest('Stay'), responsibility: 'Changed together' });
  await draft(f, '.rsi/members/New/member.json', manifest('New'));
  const review = await validate(f); assert.equal(review.valid, true, JSON.stringify(review.issues));
  assert.deepEqual(review.changes.map(c => c.type).sort(), ['create', 'delete', 'update']);
  const entered = deferred(), release = deferred();
  const original = f.store.activateMembers.bind(f.store);
  f.store.activateMembers = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
  const activation = f.team.activateConfiguration(f.workspaceId);
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
  await setup(f); await draft(f, '.rsi/members/Backend/member.json', manifest('Backend')); const review = await validate(f);
  const finish = deferred();
  const original = f.runtime.finished.bind(f.runtime);
  f.runtime.finished = async (...args) => { const state = await original(...args); await finish.promise; return state; };
  const accepted = await f.team.runner.postUser(f.workspaceId, 'Work');
  await f.team.runner.publishFinal(f.lead.memberId, accepted.runs[0]!.runId, 'Done', 'final');
  assert.equal(f.team.runner.isRunning(f.lead.memberId), false, 'mention slot is released before finalization');
  await assert.rejects(f.team.activateConfiguration(f.workspaceId), code('workspace_busy'));
  finish.resolve(); await settle(); await f.team.activateConfiguration(f.workspaceId);
}));

test('admission already in progress takes precedence and activation refuses after its run becomes active', () => withTeam(async f => {
  await setup(f); await draft(f, '.rsi/members/Backend/member.json', manifest('Backend')); const review = await validate(f);
  const entered = deferred(), release = deferred();
  const original = f.runtime.prepareRun.bind(f.runtime);
  f.runtime.prepareRun = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
  const admission = f.team.runner.postUser(f.workspaceId, 'Work'); await entered.promise;
  const activation = f.team.activateConfiguration(f.workspaceId);
  release.resolve(); await admission; await assert.rejects(activation, code('workspace_busy'));
  assert.equal(await f.team.service.byName(f.workspaceId, 'Backend'), undefined);
  f.runtime.end(f.lead.memberId); await settle();
}));

test('binary prompt bytes and concurrent active changes are rejected without activation', () => withTeam(async f => {
  await setup(f); const path = '.rsi/members/Backend/member.json'; const files = await draft(f, path, manifest('Backend'));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(files.root, '.rsi/members/Backend/agent.md'), Buffer.from([0xff, 0xfe]));
  await assert.rejects(f.team.configuration.validate(f.lead.memberId,'.rsi/members'),/UTF-8/);
  await draft(f, path, manifest('Backend')); const review = await validate(f);
  const original=f.store.activateMembers.bind(f.store);
  f.store.activateMembers=async (...args) => {
    const lead=(await f.team.service.find(f.lead.memberId))!;
    await f.team.service.update(f.workspaceId,lead.id,lead.revision,{name:lead.value.name,role:lead.value.role,responsibility:'Concurrent backend change',settings:lead.value.settings,designScope:lead.value.designScope});
    return original(...args);
  };
  await assert.rejects(f.team.activateConfiguration(f.workspaceId),code('config_conflict'));
  assert.equal(await f.team.service.byName(f.workspaceId, 'Backend'), undefined);
}));
