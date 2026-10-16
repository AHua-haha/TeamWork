import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { DesignService } from '../src/design.js';
import { emptyHarness } from '../src/harness-config.js';
import { teamTools } from '../src/member-tools.js';
import type { StepScope } from '../src/runtime.js';
import { maxMembers, newLead, TeamService } from '../src/team.js';
import { WorkspaceService } from '../src/workspace.js';
import { testModels, testModelValidator, MemoryStore, withFolder } from './memory-store.js';
import { code, stubConfig, withTeam, worker } from './team-fixture.js';

const scope = (agentId: string, runId = 'r'): StepScope => ({ agentId, runId, step: 1, signal: new AbortController().signal, config: { systemPrompt: 'own words' } } as unknown as StepScope);

test('a workspace is created with its lead, and reading the team changes nothing', () => withTeam(async fixture => {
  const view = await fixture.team.service.team(fixture.workspaceId);
  assert.deepEqual(view.members.map(member => [member.name, member.role, member.lead]), [['Lead', 'Lead', true]]);
  assert.equal(view.members[0]!.ready, true);
  const before = JSON.stringify([...fixture.store.members.keys()]);
  await fixture.team.service.team(fixture.workspaceId);
  assert.equal(JSON.stringify([...fixture.store.members.keys()]), before);
  assert.equal(fixture.store.members.size, 1);
  const status = await fixture.team.team(fixture.workspaceId);
  assert.deepEqual(status.members.map(member => member.running), [false]);
}));

test('a failed lead leaves no workspace, and the startup step gives an older workspace its lead', () => withFolder(async folder => {
  const store = new MemoryStore();
  const workspaces = new WorkspaceService(store, testModelValidator);
  try {
    const failing = store.createMember.bind(store);
    store.createMember = async () => { throw new Error('store down'); };
    await assert.rejects(workspaces.create({ name: 'Lost', directory: join(folder, 'lost'), models: testModels(), adopt: false }), /store down/);
    assert.deepEqual(await workspaces.list(), []);
    store.createMember = failing;

    const { workspaceId } = await workspaces.create({ name: 'Older', directory: join(folder, 'older'), models: testModels(), adopt: false });
    const team = new TeamService(store, workspaces, stubConfig, new DesignService(workspaces));
    store.members.clear();
    await assert.rejects(team.team(workspaceId), code('corrupt_data'));
    await team.initialize();
    await team.initialize();
    assert.deepEqual((await team.team(workspaceId)).members.map(member => member.name), ['Lead']);
    assert.equal(newLead(workspaceId).value.lead, true);
  } finally { await workspaces.close(); }
}));

test('member names stay unique, and fields are checked', () => withTeam(async fixture => {
  const backend = await fixture.team.service.create(fixture.workspaceId, { name: 'Backend', role: 'backend developer', responsibility: 'Own the API', harness: emptyHarness(), settings: { prompt: 'Be brief' } });
  assert.deepEqual([backend.lead, backend.harness, backend.settings.connectionId, backend.settings.modelId, backend.settings.prompt, backend.ready], [false, { ...emptyHarness(), implementationScope: { paths: [], usePaths: [] } }, 'conn', 'model', 'Be brief', false]);
  assert.deepEqual((await fixture.team.service.team(fixture.workspaceId)).members.map(member => member.name), ['Lead', 'Backend']);
  await assert.rejects(fixture.team.service.create(fixture.workspaceId, { name: 'backend', role: 'x' }), code('member_exists'));
  await assert.rejects(fixture.team.service.create(fixture.workspaceId, { name: ' Bad', role: 'x' }), code('invalid_input'));
  await assert.rejects(fixture.team.service.create(fixture.workspaceId, { name: 'Ok', role: '' }), code('invalid_input'));
  await assert.rejects(fixture.team.service.create(fixture.workspaceId, { name: 'Ok', role: 'x', harness: { ...emptyHarness(), designScope: { working: ['agent/spec'], dependencies: [] }, allowedCommands: [] } }), code('read_only'));
  await assert.rejects(fixture.team.service.create(fixture.workspaceId, { name: 'Ok', role: 'x', harness: { ...emptyHarness(), designScope: { working: ['user/a', 'user/A'], dependencies: [] }, allowedCommands: [] } }), code('invalid_config'));
  await assert.rejects(fixture.team.service.create(fixture.workspaceId, { name: 'Ok', role: 'x', extra: 1 }), code('invalid_config'));
  await assert.rejects(fixture.team.service.team('missing'), code('not_found'));
}));

test('changing a member checks the revision and keeps the lead flag', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend');
  const changed = await fixture.team.service.update(fixture.workspaceId, backend.memberId, backend.revision, { name: 'Server', role: 'server developer', responsibility: '', harness: { designScope: backend.harness.designScope, allowedCommands: backend.harness.allowedCommands }, settings: { ...backend.settings, modelId: null } });
  assert.deepEqual([changed.name, changed.revision, changed.ready, changed.issues], ['Server', 1, false, ['Select a provider and model']]);
  await assert.rejects(fixture.team.service.update(fixture.workspaceId, backend.memberId, backend.revision, { name: 'Late', role: 'x', responsibility: '', harness: emptyHarness(), settings: backend.settings }), code('config_conflict'));
  const lead = await fixture.team.service.update(fixture.workspaceId, fixture.lead.memberId, fixture.lead.revision, { name: 'Boss', role: 'Lead', responsibility: '', harness: emptyHarness(), settings: fixture.lead.settings });
  assert.equal(lead.lead, true);
  await assert.rejects(fixture.team.service.get('other', backend.memberId), code('not_found'));
}));

test('retiring frees the name, keeps the lead, and a team has a size limit', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend');
  await assert.rejects(fixture.team.runner.retire(fixture.workspaceId, fixture.lead.memberId, fixture.lead.revision), code('lead_required'));
  await fixture.team.runner.retire(fixture.workspaceId, backend.memberId, backend.revision);
  await assert.rejects(fixture.team.service.get(fixture.workspaceId, backend.memberId), code('not_found'));
  assert.equal((await fixture.team.service.find(backend.memberId))?.value.retiredAt !== null, true);
  const again = await worker(fixture, 'backend');
  assert.notEqual(again.memberId, backend.memberId);
  for (let index = 2; index < maxMembers; index++) await worker(fixture, `Member ${index}`);
  await assert.rejects(worker(fixture, 'One too many'), code('team_full'));
}));

test('model discovery is lead-only; configuration changes use pending management files', () => withTeam(async fixture => {
  const { management } = teamTools(fixture.team.service, fixture.team.configuration);
  assert.deepEqual(management.map(t => t.definition.name), ['list_models', 'validate_member_config']);
  const tool = management[0]!;
  const helper = await worker(fixture, 'Helper');
  const call = async (id: string) => JSON.stringify((await tool.execute({} as never, scope(id), {} as never)).content);
  assert.match(await call(helper.memberId), /access_denied/);
  assert.match(await call(fixture.lead.memberId), /connectionId/);
}));

test('startup replaces legacy scopes with empty harnesses once and preserves the member identity and settings', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend');
  const saved = fixture.store.members.get(backend.memberId)!;
  const { harness: _harness, ...other } = saved.member.value;
  saved.member.value = { ...other, scope: ['agent/systems/backend'] } as never;
  await fixture.team.initialize();
  const migrated = await fixture.team.service.get(fixture.workspaceId, backend.memberId);
  assert.deepEqual(migrated.harness, { ...emptyHarness(), implementationScope: { paths: [], usePaths: [] } });
  assert.deepEqual(migrated.settings, backend.settings);
  assert.equal(migrated.ready, false);
  assert.match(migrated.issues.join('; '), /Configure a design scope/);
  assert.equal(migrated.revision, backend.revision + 1);
  assert.equal('scope' in fixture.store.members.get(backend.memberId)!.member.value, false);
  await fixture.team.initialize();
  assert.equal((await fixture.team.service.get(fixture.workspaceId, backend.memberId)).revision, migrated.revision);
}));
