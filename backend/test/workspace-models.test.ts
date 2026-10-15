import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkspaceService } from '../src/workspace.js';
import { TeamService, newLead } from '../src/team.js';
import { DesignService } from '../src/design.js';
import { emptyRunSettings } from '../src/config.js';
import { workspaceModels } from '../src/workspace-models.js';
import { MemoryStore, testModels, testModelValidator, withFolder } from './memory-store.js';
import { code, stubConfig } from './team-fixture.js';

test('workspace models validate default membership, uniqueness and run options', () => {
  assert.deepEqual(workspaceModels(testModels()), testModels());
  for (const value of [undefined, { models: [], defaultModel: null }, { ...testModels(), defaultModel: { connectionId: 'other', modelId: 'model' } }, { ...testModels(), models: [testModels().models[0], testModels().models[0]] }, { ...testModels(), models: [{ connectionId: 'conn', modelId: 'model', temperature: 9 }] }]) assert.throws(() => workspaceModels(value));
});

test('create/adopt persist model defaults with the lead; invalid model config creates nothing', () => withFolder(async folder => {
  const store = new MemoryStore();
  const config = { issuesFor: async (settings: readonly typeof emptyRunSettings[]) => settings.map(s => s.connectionId === 'bad' ? ['Provider unavailable'] : []) };
  const service = new WorkspaceService(store, config);
  try {
    await assert.rejects(service.create({ name: 'Invalid', directory: join(folder, 'invalid'), adopt: false, models: testModels('bad') }), code('invalid_config'));
    await assert.rejects(stat(join(folder, 'invalid')));
    assert.equal((await service.list()).length, 0);
    const models = { ...testModels(), models: [{ connectionId: 'conn', modelId: 'model', reasoning: 'high' as const, maxTokens: 100 }] };
    const created = await service.create({ name: 'New', directory: join(folder, 'new'), adopt: false, models });
    const lead = (await store.listMembers(created.workspaceId))[0]!;
    assert.equal(lead.value.settings.modelId, 'model');
    assert.deepEqual(lead.value.settings.modelOptions, models.models);
    assert.deepEqual((await service.models(created.workspaceId)).value, models);
    const adopted = await mkdtemp(join(folder, 'adopt-'));
    await service.create({ name: 'Adopt', directory: adopted, adopt: true, models });
    assert.ok((await readdir(adopted)).includes('.context'));
    const insert = store.createMember.bind(store);
    store.createMember = async () => { throw new Error('Lead insert failed'); };
    await assert.rejects(service.create({ name: 'Fail', directory: join(folder, 'fail'), adopt: false, models }), /Lead insert failed/);
    store.createMember = insert;
    assert.equal((await service.list()).length, 2);
    assert.equal(store.workspaceModels.size, 2);
    await assert.rejects(stat(join(folder, 'fail')));
  } finally { await service.close(); }
}));

test('workspace settings are revision guarded; changing defaults preserves existing members and initializes a legacy lead once', () => withFolder(async folder => {
  const store = new MemoryStore(), service = new WorkspaceService(store, testModelValidator);
  try {
    const created = await service.create({ name: 'Project', directory: join(folder, 'project'), adopt: false, models: testModels() });
    const team = new TeamService(store, service, stubConfig, new DesignService(service));
    const lead = (await team.active(created.workspaceId))[0]!;
    await service.updateModels(created.workspaceId, 0, testModels('conn', 'second'));
    assert.deepEqual(await team.find(lead.id), lead, 'default updates do not rewrite the configured lead');
    const member = await team.create(created.workspaceId, { name: 'Worker', role: 'developer' });
    assert.equal(member.settings.modelId, 'second', 'new members follow workspace default, not lead');
    await assert.rejects(service.updateModels(created.workspaceId, 0, testModels()), code('config_conflict'));
    assert.equal((await service.models(created.workspaceId)).value.defaultModel?.modelId, 'second');
    const legacyId = 'legacy';
    await store.createWorkspace({ workspaceId: legacyId, name: 'Legacy', directory: join(folder, 'legacy'), createdAt: 1 }, 'legacy-key', newLead(legacyId));
    const oldLead = (await team.active(legacyId))[0]!;
    const saved = await service.updateModels(legacyId, 0, testModels('conn', 'first'));
    const initialized = (await team.find(oldLead.id))!;
    assert.equal(initialized.value.settings.modelId, 'first');
    assert.equal(initialized.revision, oldLead.revision + 1);
    assert.equal(JSON.parse(initialized.value.configuration!.files['member.json']!).settings.modelId, 'first');
    await service.updateModels(legacyId, saved.revision, testModels('conn', 'third'));
    assert.deepEqual(await team.find(oldLead.id), initialized, 'later default changes do not reinitialize the lead');
  } finally { await service.close(); }
}));

test('legacy model discovery is one-time and source-independent after model settings are stored', () => withFolder(async folder => {
  const store = new MemoryStore(), service = new WorkspaceService(store, testModelValidator);
  try {
    await store.createWorkspace({ workspaceId: 'old', name: 'Old', directory: folder, createdAt: 1 }, 'key', newLead('old'));
    await service.initializeModels('old', [{ ...emptyRunSettings, connectionId: 'conn', modelId: 'one', modelOptions: [{ connectionId: 'conn', modelId: 'one', maxTokens: 30 }] }]);
    const first = await service.models('old');
    await service.initializeModels('old', [{ ...emptyRunSettings, connectionId: 'conn', modelId: 'different' }]);
    assert.deepEqual(await service.models('old'), first);
    const reopened = new WorkspaceService(store, testModelValidator);
    try { assert.deepEqual(await reopened.models('old'), first); } finally { await reopened.close(); }
  } finally { await service.close(); }
}));
