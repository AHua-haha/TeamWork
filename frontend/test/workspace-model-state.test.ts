import assert from 'node:assert/strict';
import test from 'node:test';
import { addWorkspaceModel, removeWorkspaceModel, workspaceModelKey, workspaceModelsError } from '../src/ui/workspace-model-state.js';

test('workspace model choices keep provider identity, require a selected default and retain per-model options', () => {
  const first = { connectionId: 'a', modelId: 'same', reasoning: 'high' as const };
  const second = { connectionId: 'b', modelId: 'same' };
  const initial = addWorkspaceModel({ models: [], defaultModel: null }, first);
  assert.equal(workspaceModelsError(initial), null);
  const both = addWorkspaceModel(initial, second);
  assert.equal(both.models.length, 2);
  assert.notEqual(workspaceModelKey(first), workspaceModelKey(second));
  assert.deepEqual(addWorkspaceModel(both, first), both);
  assert.deepEqual(both.models[0], first);
  const removed = removeWorkspaceModel(both, first);
  assert.equal(removed.defaultModel, null, 'removing the default requires an explicit replacement');
  assert.match(workspaceModelsError(removed)!, /default/);
  assert.equal(workspaceModelsError({ ...removed, defaultModel: second }), null);
  assert.match(workspaceModelsError({ ...initial, models: [{ ...first, maxTokens: 0 }] })!, /positive/);
  assert.match(workspaceModelsError({ ...initial, models: [{ ...first, temperature: NaN }] })!, /Temperature/);
});
