import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigClient, type AgentSettings, type PromptOption } from '../src/client/config-client.js';
import { BackendError } from '../src/client/agent-client.js';

test('config client preserves backend records, revisions and complete agent values', async () => {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const settings: AgentSettings = { name: 'Research', workspaceId: 'workspace-1', connectionId: 'main', modelId: 'backend-owned', toolOptionIds: [], prompt: '', promptOptionIds: [], modelOptions: [{ connectionId: 'main', modelId: 'backend-owned', reasoning: 'high', contextBudget: 4096 }] };
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(input) === '/agents/a/config' && init?.method === 'PUT') return new Response(JSON.stringify({ id: 'a', revision: 4, value: settings, issues: [] }));
    if (String(input) === '/agents/a/config') return new Response(JSON.stringify({ id: 'a', revision: 3, value: settings, issues: [] }));
    if (String(input) === '/config/catalog' && init?.method === 'POST') return new Response(JSON.stringify({ id: 'primary', revision: 0, value: JSON.parse(String(init.body)).value }), { status: 201 });
    throw new Error('Unexpected request');
  };
  const api = new ConfigClient(fetcher as typeof fetch);
  const record = await api.getAgent('a');
  await api.updateAgent(record, settings);
  const prompt: PromptOption = { kind: 'prompt', label: 'Shared', text: 'Be precise.' };
  await api.createCatalog('primary', prompt);
  assert.deepEqual(calls, [
    { path: '/agents/a/config', method: 'GET', body: undefined },
    { path: '/agents/a/config', method: 'PUT', body: { revision: 3, value: settings } },
    { path: '/config/catalog', method: 'POST', body: { id: 'primary', value: prompt } },
  ]);
});

test('connection key is write-only in the client contract and model choices come from backend', async () => {
  const calls: { path: string; body?: unknown }[] = [];
  const api = new ConfigClient((async (input, init) => {
    calls.push({ path: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(input) === '/config/connections') return new Response(JSON.stringify({ id: 'main', revision: 0, value: { label: 'Main', provider: 'openai', baseUrl: 'https://example.com/v1', api: 'openai-responses', keyConfigured: true } }), { status: 201 });
    if (String(input) === '/config/connections/main/models/refresh' && init?.method === 'POST') return new Response(JSON.stringify([{ source: 'endpoint', modelId: 'backend-owned', label: 'Available model', api: 'openai-responses', reasoning: false, reasoningLevels: [], defaultReasoning: null, reasoningSentAs: {}, contextWindow: 8192, maxTokens: 2048, verified: false }]));
    throw new Error('Unexpected request');
  }) as typeof fetch);
  const connection = await api.createConnection('main', { label: 'Main', provider: 'openai', baseUrl: 'https://example.com/v1', api: 'openai-responses', apiKey: 'private-key' });
  assert.equal(connection.value.keyConfigured, true);
  assert.equal('apiKey' in connection.value, false);
  assert.equal((await api.modelChoices('main', true))[0]?.label, 'Available model');
  assert.deepEqual(calls.map(call => call.path), ['/config/connections', '/config/connections/main/models/refresh']);
});

test('config client exposes backend revision conflicts for editor recovery', async () => {
  const api = new ConfigClient((async () => new Response(JSON.stringify({ error: { code: 'config_conflict', message: 'Config revision changed' } }), { status: 409 })) as typeof fetch);
  await assert.rejects(api.updateApp({ id: 'settings', revision: 2, value: { title: 'Old', maxInputBytes: 2048, allowAgentCreation: true } },
    { title: 'New', maxInputBytes: 2048, allowAgentCreation: true }), error => error instanceof BackendError && error.status === 409 && error.code === 'config_conflict');
});
