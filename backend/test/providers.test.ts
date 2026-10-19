import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModels, clampThinkingLevel, type AnthropicMessagesCompat, type OpenAICompletionsCompat } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { createBackendModels } from '../src/providers.js';
import { bindModelflareModel, modelflareProvider, modelflareSupportsModel } from '../src/providers/modelflare.js';
import { inheritedModels, supportedModelApis, unsupportedModels } from '../src/providers/modelflare-catalog.js';

const registered = createBackendModels();

test('backend registers the complete supported Modelflare catalog without changing upstream providers', () => {
  const builtin = builtinModels();
  const models = registered.getModels('modelflare');
  assert.equal(models.length, 32);
  assert.equal(new Set(models.map(model => model.id)).size, models.length);
  assert.deepEqual(models.map(model => model.id).sort(), Object.keys(supportedModelApis).sort());
  assert.equal(unsupportedModels.size + models.length, 76, 'every observed model is accounted for');
  assert.deepEqual(registered.getModels('anthropic'), builtin.getModels('anthropic'));
  assert.deepEqual(registered.getModels('openai'), builtin.getModels('openai'));
  for (const model of models) {
    assert.equal(model.provider, 'modelflare');
    assert.ok(model.contextWindow > 0 && model.maxTokens > 0);
    assert.ok(modelflareSupportsModel(model.id, model.api));
    assert.equal(model.baseUrl, model.api === 'anthropic-messages' ? 'https://modelflare.dev' : 'https://modelflare.dev/v1');
    assert.equal(model.headers, undefined);
    assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 'unpriced gateway rates do not inherit upstream billing');
  }
  for (const { id, provider } of inheritedModels) {
    const model = registered.getModel('modelflare', id)!;
    const original = builtin.getModel(provider, id)!;
    for (const field of ['reasoning', 'thinkingLevelMap', 'input', 'contextWindow', 'maxTokens'] as const) assert.deepEqual(model[field], original[field], `${id}: ${field}`);
  }
});

test('new documented models carry their own capabilities and reasoning constraints', () => {
  const haiku = registered.getModel('modelflare', 'claude-haiku-5-5')!;
  const sonnet = registered.getModel('modelflare', 'claude-sonnet-5-5')!;
  const sol = registered.getModel('modelflare', 'gpt-6.1-sol')!;
  for (const model of [haiku, sonnet, sol]) {
    assert.equal(model.reasoning, true);
    assert.equal(model.maxTokens, 128_000);
    assert.deepEqual(model.input, ['text', 'image']);
    assert.equal(clampThinkingLevel(model, 'xhigh'), 'xhigh');
  }
  assert.equal(haiku.contextWindow, 1_000_000);
  assert.equal(sonnet.contextWindow, 1_000_000);
  assert.equal(sol.contextWindow, 1_050_000);
  assert.equal(clampThinkingLevel(haiku, 'off'), 'off');
  assert.equal(clampThinkingLevel(sonnet, 'off'), 'low');
  assert.equal(clampThinkingLevel(sol, 'off'), 'low');
  assert.equal((haiku.compat as AnthropicMessagesCompat).forceAdaptiveThinking, true);
  assert.equal((haiku.compat as AnthropicMessagesCompat).supportsTemperature, false);
  assert.equal(registered.getModel('anthropic', haiku.id), undefined, 'gateway registration does not alter another provider catalog');
});

test('unsupported models and protocol pairs are excluded while future discovered IDs retain normal discovery behavior', () => {
  for (const id of unsupportedModels) for (const api of ['anthropic-messages', 'openai-completions', 'openai-responses']) assert.equal(modelflareSupportsModel(id, api), false);
  assert.equal(modelflareSupportsModel('gpt-6.1-sol', 'anthropic-messages'), false);
  assert.equal(modelflareSupportsModel('claude-haiku-5-5', 'openai-responses'), false);
  assert.equal(modelflareSupportsModel('claude-haiku-5-5', 'openai-completions'), true);
  assert.equal(modelflareSupportsModel('glm-5.3', 'anthropic-messages'), true);
  assert.equal(modelflareSupportsModel('future-discovered-model', 'openai-completions'), true);
});

test('gateway binding preserves capabilities, owns transport rules and does not mutate catalog definitions', () => {
  const source = registered.getModel('modelflare', 'claude-haiku-5-5')!;
  const before = structuredClone(source);
  const bound = bindModelflareModel(source, 'openai-completions', 'https://gateway.example/v1');
  assert.equal(bound.api, 'openai-completions');
  assert.equal(bound.baseUrl, 'https://gateway.example/v1');
  assert.equal((bound.compat as OpenAICompletionsCompat).supportsStore, false);
  assert.equal((bound.compat as AnthropicMessagesCompat).forceAdaptiveThinking, undefined);
  assert.deepEqual(bound.thinkingLevelMap, source.thinkingLevelMap);
  assert.deepEqual(source, before);
  assert.equal((registered.getModel('modelflare', 'deepseek-v4-flash')!.compat as OpenAICompletionsCompat).thinkingFormat, 'deepseek');
  assert.equal((registered.getModel('modelflare', 'qwen3.8-max')!.compat as OpenAICompletionsCompat).thinkingFormat, 'qwen');
});

test('a missing exact upstream definition fails registration explicitly', () => {
  assert.throws(() => modelflareProvider(createModels()), /requires registered metadata: anthropic\/claude-fable-5/);
});

test('Modelflare cannot fall back to an upstream provider credential', async () => {
  const provider = registered.getProvider('modelflare')!;
  assert.ok(provider.auth.apiKey);
  const ctx = { env: async () => 'unrelated-upstream-secret', fileExists: async () => true };
  const result = await provider.auth.apiKey.resolve({ ctx, credential: undefined, signal: new AbortController().signal });
  assert.equal(result, undefined);
});

test('registered APIs send model identity, gateway credentials and reasoning in the selected wire format', async () => {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = init?.body ?? (input instanceof Request ? await input.text() : '');
    requests.push({ url, headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)), body: JSON.parse(String(body)) });
    const id = requests.at(-1)!.body.model;
    if (new URL(url).pathname.endsWith('/messages')) {
      const events = [
        { type: 'message_start', message: { id: 'msg_gateway', type: 'message', role: 'assistant', content: [], model: id, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Gateway reply' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (new URL(url).pathname.endsWith('/chat/completions')) {
      const chunk = (delta: unknown, finish_reason: string | null) => ({ id: 'chat_gateway', object: 'chat.completion.chunk', model: id,
        choices: [{ index: 0, delta, finish_reason }] });
      return new Response([chunk({ role: 'assistant', content: 'Gateway reply' }, null), chunk({}, 'stop')]
        .map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    }
    const item = { id: 'msg_gateway', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Gateway reply', annotations: [] }] };
    const response = { id: 'resp_gateway', object: 'response', status: 'completed', model: id, output: [item], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } };
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Gateway reply' },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response },
    ];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const haiku = registered.getModel('modelflare', 'claude-haiku-5-5')!;
  for (const model of [haiku, registered.getModel('modelflare', 'gpt-6.1-sol')!,
    bindModelflareModel(haiku, 'openai-completions', 'https://modelflare.dev/v1'),
    registered.getModel('modelflare', 'deepseek-v4-flash')!, registered.getModel('modelflare', 'qwen3.8-max')!]) {
    const answer = await registered.completeSimple(model, { messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] },
      { apiKey: 'gateway-test-key', reasoning: 'xhigh', maxTokens: 10000, fetch: mockFetch });
    assert.equal(answer.stopReason, 'stop', answer.errorMessage);
    assert.ok(answer.content.some(block => block.type === 'text' && block.text === 'Gateway reply'));
  }
  const [anthropic, openai] = requests;
  assert.equal(new URL(anthropic!.url).origin + new URL(anthropic!.url).pathname, 'https://modelflare.dev/v1/messages');
  assert.equal(anthropic!.headers.get('x-api-key'), 'gateway-test-key');
  assert.deepEqual(anthropic!.body.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(anthropic!.body.output_config, { effort: 'xhigh' });
  assert.equal(openai!.url, 'https://modelflare.dev/v1/responses');
  assert.equal(openai!.headers.get('authorization'), 'Bearer gateway-test-key');
  assert.equal(openai!.body.model, 'gpt-6.1-sol');
  assert.equal((openai!.body.reasoning as { effort?: string }).effort, 'xhigh');
  const [, , chat, deepseek, qwen] = requests;
  assert.equal(chat!.url, 'https://modelflare.dev/v1/chat/completions');
  assert.equal(chat!.headers.get('authorization'), 'Bearer gateway-test-key');
  assert.equal(chat!.body.reasoning_effort, 'xhigh');
  assert.equal(chat!.body.max_tokens, 10000);
  assert.deepEqual(deepseek!.body.thinking, { type: 'enabled' });
  assert.equal(qwen!.body.enable_thinking, true);
});
