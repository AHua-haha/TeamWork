import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentSettings, ConfigRecord, ConnectionView, ModelChoice } from '../src/shared/backend-client/config-client.js';
import { clampedTo, customizedCount, effectiveReasoning, misfits, modelKey, modelSettings, selectModel, selectedModel, withModelSettings, type ModelEntry } from '../src/features/chat/model-selection.js';

const settings: AgentSettings = {
  name: 'Conversation', connectionId: 'first', modelId: 'shared', prompt: 'Keep this',
  promptOptionIds: ['prompt-a'], toolOptionIds: ['tool-a'],
  modelOptions: [{ connectionId: 'first', modelId: 'shared', reasoning: 'high', temperature: 0.7, maxTokens: 10000 }],
};
const choice: ModelChoice = {
  source: 'pi', modelId: 'shared', label: 'Shared model', api: 'openai-responses', reasoning: true,
  reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh'], defaultReasoning: 'off',
  reasoningSentAs: { off: 'off', low: 'high', medium: 'high', high: 'high', xhigh: 'max' }, contextWindow: 16000, maxTokens: 4096, verified: true,
};
const plain: ModelChoice = { ...choice, reasoning: false, reasoningLevels: [], defaultReasoning: null, reasoningSentAs: {} };
function entry(id: string, model = choice): ModelEntry {
  const connection: ConfigRecord<ConnectionView> = {
    id, revision: 1,
    value: { label: id, provider: 'openai', baseUrl: 'https://example.test/v1', api: 'openai-responses', keyConfigured: true },
  };
  return { connection, model };
}

test('model identity includes connection even when model IDs repeat', () => {
  const entries = [entry('first'), entry('second')];
  assert.notEqual(modelKey(entries[0]!), modelKey(entries[1]!));
  assert.equal(selectedModel(entries, settings)?.connection.id, 'first');
});

test('switching model changes only the selection and keeps each model its own settings', () => {
  const original = structuredClone(settings);
  const switched = selectModel(settings, entry('second'));
  assert.equal(switched.connectionId, 'second');
  assert.deepEqual(switched.modelOptions, settings.modelOptions);
  assert.deepEqual(modelSettings(switched, entry('second')), {});
  const withSecond = withModelSettings(switched, entry('second'), { reasoning: 'low' });
  const back = selectModel(withSecond, entry('first'));
  assert.deepEqual(modelSettings(back, entry('first')), { reasoning: 'high', temperature: 0.7, maxTokens: 10000 });
  assert.deepEqual(modelSettings(back, entry('second')), { reasoning: 'low' });
  assert.equal(back.prompt, 'Keep this');
  assert.deepEqual(back.toolOptionIds, ['tool-a']);
  assert.deepEqual(settings, original);
});

test('clearing every value removes the entry and unset reasoning shows the effective default', () => {
  const cleared = withModelSettings(settings, entry('first'), { reasoning: undefined });
  assert.deepEqual(cleared.modelOptions, []);
  assert.equal(effectiveReasoning(choice, {}), 'off');
  assert.equal(effectiveReasoning(plain, {}), null);
  assert.equal(customizedCount(modelSettings(settings, entry('first'))), 2);
});

test('scale levels the model does not support report the clamped level sent', () => {
  assert.equal(clampedTo(choice, 'off'), undefined);
  assert.equal(clampedTo(choice, 'high'), undefined);
  assert.equal(clampedTo(choice, 'medium'), 'high');
  assert.equal(clampedTo(choice, 'xhigh'), 'max');
  assert.equal(clampedTo(plain, null), undefined);
});

test('values that do not fit the model are reported without being changed', () => {
  assert.deepEqual(misfits(choice, { reasoning: 'xhigh', maxTokens: 4096 }), {});
  assert.deepEqual(Object.keys(misfits(choice, { maxTokens: 10000, contextBudget: 20000 })), ['maxTokens', 'contextBudget']);
  assert.deepEqual(Object.keys(misfits(plain, { reasoning: 'low' })), ['reasoning']);
});
