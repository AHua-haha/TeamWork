import { createProvider, type AnthropicMessagesCompat, type Api, type Model, type Models, type Provider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { inheritedModels, supportedModelApis, unsupportedModels } from './modelflare-catalog.js';

export type ModelflareApi = 'anthropic-messages' | 'openai-completions' | 'openai-responses';
const unpriced = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const reasoningLevels = { minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } as const;

/** Known non-chat models and unsupported API/model pairs never become agent choices through discovery. */
export function modelflareSupportsModel(id: string, api: Api): boolean {
  if (unsupportedModels.has(id)) return false;
  const apis = (supportedModelApis as Readonly<Record<string, readonly string[]>>)[id];
  return !apis || apis.includes(api);
}

/** Gateway transport rules belong to the gateway, not to the upstream catalog being reused. */
export function bindModelflareModel(source: Model<Api>, api: ModelflareApi, baseUrl: string): Model<Api> {
  const { compat: _upstream, headers: _headers, promptCache: _cache, samplingParams: _sampling, ...model } = structuredClone(source);
  if (api === 'anthropic-messages') {
    const compat = source.api === api ? source.compat as AnthropicMessagesCompat | undefined : undefined;
    return { ...model, api, baseUrl, compat: {
      ...(compat?.forceAdaptiveThinking ? { forceAdaptiveThinking: true } : {}),
      ...(compat?.supportsTemperature === false ? { supportsTemperature: false } : {}),
      supportsLongCacheRetention: false,
    } };
  }
  if (api === 'openai-responses') return { ...model, api, baseUrl, compat: { supportsLongCacheRetention: false } };
  const thinkingFormat = source.id.startsWith('deepseek-') ? 'deepseek'
    : source.id.startsWith('glm-') ? 'zai' : source.id.startsWith('qwen') ? 'qwen' : 'openai';
  return { ...model, api, baseUrl, compat: {
    supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens',
    supportsReasoningEffort: true, supportsLongCacheRetention: false, thinkingFormat,
    requiresReasoningContentOnAssistantMessages: source.id.startsWith('deepseek-') || source.id.startsWith('kimi-'),
  } };
}

/** Reuse exact upstream capabilities only; credentials, pricing, endpoint and request behavior are provider-owned. */
export function modelflareProvider(registered: Models): Provider {
  const inherited = inheritedModels.map(({ id, provider }) => {
    const model = registered.getModel(provider, id);
    if (!model) throw new Error(`Modelflare catalog requires registered metadata: ${provider}/${id}`);
    return structuredClone(model);
  });
  const additions: Model<Api>[] = [
    ...(['haiku', 'sonnet'] as const).map(tier => ({
      id: `claude-${tier}-5-5`, name: `Claude ${tier === 'haiku' ? 'Haiku' : 'Sonnet'} 5.5`,
      provider: 'modelflare', api: 'anthropic-messages' as const, baseUrl: 'https://modelflare.dev',
      reasoning: true, thinkingLevelMap: { ...reasoningLevels, off: tier === 'sonnet' ? null : 'none' },
      input: ['text', 'image'] as ('text' | 'image')[], contextWindow: 1_000_000, maxTokens: 128_000,
      cost: { ...unpriced }, compat: { forceAdaptiveThinking: true, supportsTemperature: false },
    })),
    {
      id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'modelflare', api: 'openai-responses', baseUrl: 'https://modelflare.dev/v1',
      reasoning: true, thinkingLevelMap: { ...reasoningLevels, off: null }, input: ['text', 'image'],
      contextWindow: 1_050_000, maxTokens: 128_000, cost: { ...unpriced },
    },
  ];
  const models = [...inherited, ...additions].map(source => {
    const apis = supportedModelApis[source.id as keyof typeof supportedModelApis] as readonly ModelflareApi[];
    const api = apis.includes(source.api as ModelflareApi) ? source.api as ModelflareApi : apis[0]!;
    return bindModelflareModel({ ...source, provider: 'modelflare', cost: { ...unpriced } }, api,
      api === 'anthropic-messages' ? 'https://modelflare.dev' : 'https://modelflare.dev/v1');
  }).sort((a, b) => a.id.localeCompare(b.id));
  return createProvider({
    id: 'modelflare', name: 'Modelflare', baseUrl: 'https://modelflare.dev',
    // Credentials are supplied by ConfigService's connection snapshot; never inherit another provider's auth.
    auth: { apiKey: { name: 'Modelflare API key', resolve: async ({ credential }) => credential?.key
      ? { auth: { apiKey: credential.key }, source: 'Modelflare credential' } : undefined } },
    models,
    api: { 'anthropic-messages': anthropicMessagesApi(), 'openai-completions': openAICompletionsApi(), 'openai-responses': openAIResponsesApi() },
  });
}
