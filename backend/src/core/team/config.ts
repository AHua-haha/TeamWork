import { clampThinkingLevel, createModels, createProvider, type Api, type Model, type ModelThinkingLevel, type Models, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { createHash } from 'node:crypto';
import { TeamData, type StoredConfig } from './data.js';
import type { RuntimeTool } from '../agent/contracts.js';
import { ConfigSecrets } from './secrets.js';
import { AppError, identity } from '../agent/types.js';
import { bindModelflareModel, modelflareSupportsModel } from '../agent/providers/modelflare.js';

/** One reasoning scale for every reasoning model; each level is clamped to the model's supported Pi level when sent. */
export const reasoningScale = ['off', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningLevel = typeof reasoningScale[number];
const isReasoningLevel = (value: unknown): value is ReasoningLevel => reasoningScale.includes(value as ReasoningLevel);
const appId = 'settings';
export const initialAppSettings: AppSettings = { title: 'RSI Agent', maxInputBytes: 2 * 1024 * 1024, allowAgentCreation: true };

export interface AppSettings { title: string; maxInputBytes: number; allowAgentCreation: boolean }
export interface ProviderConnection {
  label: string; provider: string; baseUrl: string; api: 'openai-completions' | 'openai-responses' | 'anthropic-messages'; encryptedKey: string | null;
}
export interface ConnectionView { label: string; provider: string; baseUrl: string; api: ProviderConnection['api']; keyConfigured: boolean }
export interface ModelChoice {
  source: 'pi' | 'endpoint'; modelId: string; label: string; api: Api; reasoning: boolean;
  reasoningLevels: ReasoningLevel[]; defaultReasoning: ReasoningLevel | null; reasoningSentAs: Partial<Record<ReasoningLevel, ModelThinkingLevel>>;
  contextWindow: number; maxTokens: number; verified: boolean;
}
interface ModelCache { provider: string; baseUrl: string; api: ProviderConnection['api']; checkedAt: string; models: ModelChoice[] }
export interface ToolOption { kind: 'tool'; label: string; toolName: string }
export interface PromptOption { kind: 'prompt'; label: string; text: string }
export type CatalogOption = ToolOption | PromptOption;
export interface ModelOptions { connectionId: string; modelId: string; reasoning?: ReasoningLevel; temperature?: number; maxTokens?: number; contextBudget?: number }
/** What a run needs from its agent: the model, tools, prompts, instructions, and per-model options. Agents and team members share it. */
export interface RunSettings {
  connectionId: string | null; modelId: string | null; toolOptionIds: string[];
  prompt: string; promptOptionIds: string[]; modelOptions: ModelOptions[];
}
export interface AgentSettings extends RunSettings { name: string }
export interface AgentConfigView extends StoredConfig<AgentSettings> { issues: string[] }
export interface AgentSummary { agentId: string; name: string; ready: boolean; issues: string[] }
export interface ModelCapability { provider: string; modelId: string; label: string; api: string; baseUrl: string; reasoning: boolean; maxTokens: number; reasoningLevels: ReasoningLevel[]; defaultReasoning: ReasoningLevel | null; reasoningSentAs: Partial<Record<ReasoningLevel, ModelThinkingLevel>> }
export interface ToolCapability { name: string; description: string }
import type { AgentConfiguration } from '../agent/contracts.js';
export interface ResolvedRunConfig extends AgentConfiguration {
  source: { appRevision: number; agentRevision: number; catalogRevisions: Record<string, number>; connectionRevision?: number; modelCacheRevision?: number };
}
export interface RunConfigSource { resolveForRun(agentId: string): Promise<ResolvedRunConfig> }

type LegacyModelOption = {
  kind: 'model'; label: string; connectionId?: string; provider: string; modelId: string;
  api: Api; source: 'pi' | 'endpoint'; maxTokens: number; reasoning: boolean;
};
export function obj(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid_config', `${label} must be an object`);
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new AppError('invalid_config', `Unknown config field: ${key}`);
}
function title(value: unknown, label: string, max = 80): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError('invalid_config', `${label} must be 1–${max} characters`);
  return value.trim();
}
function content(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 20_000) throw new AppError('invalid_config', `${label} must be at most 20,000 characters`);
  return value;
}
function ids(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new AppError('invalid_config', `${label} must be a list`);
  for (const id of value) identity(id, label);
  if (new Set(value).size !== value.length) throw new AppError('invalid_config', `${label} contains duplicates`);
  return value as string[];
}
export function validateAppSettings(value: unknown): AppSettings {
  const data = obj(value, 'App config');
  keys(data, ['title', 'maxInputBytes', 'allowAgentCreation']);
  if (!Number.isSafeInteger(data.maxInputBytes) || (data.maxInputBytes as number) < 1024 || (data.maxInputBytes as number) > 2 * 1024 * 1024) throw new AppError('invalid_config', 'maxInputBytes must be 1024–2097152');
  if (typeof data.allowAgentCreation !== 'boolean') throw new AppError('invalid_config', 'allowAgentCreation must be a boolean');
  return { title: title(data.title, 'App title'), maxInputBytes: data.maxInputBytes as number, allowAgentCreation: data.allowAgentCreation };
}
export function validateCatalogOption(value: unknown, tools: ReadonlyMap<string, RuntimeTool>): CatalogOption {
  const data = obj(value, 'Catalog option');
  const label = title(data.label, 'Option label');
  if (data.kind === 'tool') {
    keys(data, ['kind', 'label', 'toolName']);
    const toolName = title(data.toolName, 'Tool name', 64);
    if (!tools.has(toolName)) throw new AppError('invalid_config', `Tool is not registered: ${toolName}`);
    return { kind: 'tool', label, toolName };
  }
  if (data.kind === 'prompt') {
    keys(data, ['kind', 'label', 'text']);
    return { kind: 'prompt', label, text: content(data.text, 'Prompt text') };
  }
  throw new AppError('invalid_config', 'Unknown catalog option kind');
}
function modelOptions(value: unknown): ModelOptions {
  const data = obj(value, 'Model options');
  keys(data, ['connectionId', 'modelId', 'reasoning', 'temperature', 'maxTokens', 'contextBudget']);
  identity(data.connectionId, 'connectionId');
  const entry: ModelOptions = { connectionId: data.connectionId, modelId: title(data.modelId, 'Model ID', 160) };
  if (data.reasoning !== undefined) {
    if (!isReasoningLevel(data.reasoning)) throw new AppError('invalid_config', 'Invalid reasoning level');
    entry.reasoning = data.reasoning;
  }
  if (data.temperature !== undefined) {
    if (typeof data.temperature !== 'number' || !Number.isFinite(data.temperature) || data.temperature < 0 || data.temperature > 2) throw new AppError('invalid_config', 'Temperature must be 0–2');
    entry.temperature = data.temperature;
  }
  if (data.maxTokens !== undefined) {
    if (!Number.isSafeInteger(data.maxTokens) || (data.maxTokens as number) < 1) throw new AppError('invalid_config', 'maxTokens must be a positive integer');
    entry.maxTokens = data.maxTokens as number;
  }
  if (data.contextBudget !== undefined) {
    if (!Number.isSafeInteger(data.contextBudget) || (data.contextBudget as number) < 1) throw new AppError('invalid_config', 'contextBudget must be a positive integer');
    entry.contextBudget = data.contextBudget as number;
  }
  return entry;
}
export const emptyRunSettings: RunSettings = { connectionId: null, modelId: null, toolOptionIds: [], prompt: '', promptOptionIds: [], modelOptions: [] };
export function validateRunSettings(value: unknown, label = 'Run settings', allowed: readonly string[] = []): RunSettings {
  const data = obj(value, label);
  keys(data, [...allowed, 'connectionId', 'modelId', 'toolOptionIds', 'prompt', 'promptOptionIds', 'modelOptions']);
  if (data.connectionId !== null) identity(data.connectionId, 'connectionId');
  if (data.modelId !== null) title(data.modelId, 'Model ID', 160);
  if (!Array.isArray(data.modelOptions)) throw new AppError('invalid_config', 'modelOptions must be a list');
  const entries = data.modelOptions.map(modelOptions);
  if (new Set(entries.map(entry => JSON.stringify([entry.connectionId, entry.modelId]))).size !== entries.length) throw new AppError('invalid_config', 'modelOptions contains duplicate models');
  return {
    connectionId: data.connectionId as string | null,
    modelId: data.modelId as string | null, toolOptionIds: ids(data.toolOptionIds, 'toolOptionIds'),
    prompt: content(data.prompt, 'Instructions'), promptOptionIds: ids(data.promptOptionIds, 'promptOptionIds'),
    modelOptions: entries,
  };
}
export function validateAgentSettings(value: unknown): AgentSettings {
  const data = obj(value, 'Agent config');
  return { name: data.name === '' ? '' : title(data.name, 'Agent name'), ...validateRunSettings(data, 'Agent config', ['name']) };
}
function normalizedAgent(value: unknown): AgentSettings {
  const { callOptions: _dropped, workspaceId: _bound, ...data } = obj(value, 'Agent config');
  // Levels outside the shared scale (stored before it existed) read as unset.
  if (Array.isArray(data.modelOptions)) data.modelOptions = data.modelOptions.map(entry => {
    if (!entry || typeof entry !== 'object' || !('reasoning' in entry) || isReasoningLevel(entry.reasoning)) return entry;
    const { reasoning: _old, ...rest } = entry;
    return rest;
  });
  return validateAgentSettings({ name: '', ...emptyRunSettings, ...data });
}
function selectedOptions(settings: RunSettings): ModelOptions | undefined {
  return settings.modelOptions.find(entry => entry.connectionId === settings.connectionId && entry.modelId === settings.modelId);
}
function connectionInput(value: unknown, previous: ProviderConnection | null, secrets: ConfigSecrets): ProviderConnection {
  const data = obj(value, 'Provider connection');
  keys(data, ['label', 'provider', 'baseUrl', 'api', 'apiKey']);
  const provider = title(data.provider, 'Provider', 64);
  const rawUrl = title(data.baseUrl, 'Base URL', 2048);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new AppError('invalid_config', 'Base URL must be an absolute HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new AppError('invalid_config', 'Base URL must be HTTP or HTTPS without credentials, query, or fragment');
  if (data.api !== 'openai-completions' && data.api !== 'openai-responses' && data.api !== 'anthropic-messages') throw new AppError('invalid_config', 'Custom endpoint protocol must be OpenAI Completions, OpenAI Responses, or Anthropic Messages');
  let encryptedKey = previous?.encryptedKey ?? null;
  if (data.apiKey === null) encryptedKey = null;
  else if (data.apiKey !== undefined) {
    if (typeof data.apiKey !== 'string' || !data.apiKey.trim() || data.apiKey.length > 4096) throw new AppError('invalid_config', 'API key must be 1–4096 characters');
    encryptedKey = secrets.encrypt(data.apiKey);
  }
  return { label: title(data.label, 'Connection name'), provider, baseUrl: url.toString().replace(/\/$/, ''), api: data.api, encryptedKey };
}
function publicConnection(record: StoredConfig<ProviderConnection>): StoredConfig<ConnectionView> {
  const { label, provider, baseUrl, api, encryptedKey } = record.value;
  return { id: record.id, revision: record.revision, value: { label, provider, baseUrl, api, keyConfigured: encryptedKey !== null } };
}
function reasoningChoices(model: Model<Api>): Pick<ModelChoice, 'reasoningLevels' | 'defaultReasoning' | 'reasoningSentAs'> {
  if (!model.reasoning) return { reasoningLevels: [], defaultReasoning: null, reasoningSentAs: {} };
  return { reasoningLevels: [...reasoningScale], defaultReasoning: 'off',
    reasoningSentAs: Object.fromEntries(reasoningScale.map(level => [level, clampThinkingLevel(model, level)])) };
}
function choiceFromPi(model: Model<Api>, api: Api = model.api): ModelChoice {
  return { source: 'pi', modelId: model.id, label: model.name, api, reasoning: model.reasoning,
    ...reasoningChoices(model), contextWindow: model.contextWindow, maxTokens: model.maxTokens, verified: true };
}
function unknownChoice(modelId: string, label: string, api: ProviderConnection['api']): ModelChoice {
  return { source: 'endpoint', modelId, label, api, reasoning: false, reasoningLevels: [], defaultReasoning: null, reasoningSentAs: {}, contextWindow: 8192, maxTokens: 2048, verified: false };
}
function cacheMatches(connection: ProviderConnection, cache?: ModelCache): cache is ModelCache {
  return !!cache && cache.provider === connection.provider && cache.baseUrl === connection.baseUrl && cache.api === connection.api;
}

export class ConfigService {
  private readonly tools: ReadonlyMap<string, RuntimeTool>;
  private readonly secrets: ConfigSecrets;
  constructor(readonly store: TeamData, readonly models: Models, registeredTools: readonly RuntimeTool[] = [], encryptionKey?: string) {
    this.tools = new Map(registeredTools.map(tool => [tool.definition.name, tool]));
    if (this.tools.size !== registeredTools.length) throw new AppError('invalid_config', 'Duplicate registered tool name');
    this.secrets = new ConfigSecrets(encryptionKey);
  }
  async initialize(): Promise<void> {
    try { await this.store.createConfig('app', appId, initialAppSettings); }
    catch (error) { if (!(error instanceof AppError && error.status === 409)) throw error; }
    validateAppSettings((await this.store.getConfig('app', appId)).value);
    for (const agentId of await this.store.listAgents()) {
      try { await this.store.createConfig('agent', agentId, {}); }
      catch (error) { if (!(error instanceof AppError && error.status === 409)) throw error; }
    }
    const profiles = new Map<string, LegacyModelOption>();
    for (const record of await this.store.listConfigs<LegacyModelOption>('catalog')) {
      if (record.value.kind !== 'model') continue;
      let profile = record.value;
      if (!profile.connectionId) {
        const model = this.models.getModel(profile.provider, profile.modelId);
        if (model) {
          const connectionId = `legacy-${createHash('sha256').update(record.id).digest('hex').slice(0, 32)}`;
          try { await this.store.createConfig('connection', connectionId, { label: `${profile.label} connection`, provider: model.provider,
            baseUrl: model.baseUrl, api: model.api === 'anthropic-messages' ? 'anthropic-messages' : model.api === 'openai-responses' ? 'openai-responses' : 'openai-completions', encryptedKey: null } satisfies ProviderConnection); }
          catch (error) { if (!(error instanceof AppError && error.status === 409)) throw error; }
          profile = { ...profile, connectionId };
          await this.store.updateConfig('catalog', record.id, record.revision, profile);
        }
      }
      profiles.set(record.id, profile);
    }
    const legacyEndpointModels = new Map<string, ModelChoice[]>();
    for (const profile of profiles.values()) {
      if (!profile.connectionId || profile.source !== 'endpoint' || this.models.getModel(profile.provider, profile.modelId)) continue;
      const connection = await this.store.getConfig<ProviderConnection>('connection', profile.connectionId).catch(error => {
        if (error instanceof AppError && error.status === 404) return null;
        throw error;
      });
      if (!connection) continue;
      const existing = legacyEndpointModels.get(profile.connectionId) ?? [];
      existing.push(unknownChoice(profile.modelId, profile.label, connection.value.api));
      legacyEndpointModels.set(profile.connectionId, existing);
    }
    for (const [connectionId, choices] of legacyEndpointModels) {
      const connection = (await this.store.getConfig<ProviderConnection>('connection', connectionId)).value;
      const existing = await this.store.getConfig<ModelCache>('model_cache', connectionId).catch(error => {
        if (error instanceof AppError && error.status === 404) return null;
        throw error;
      });
      if (existing && cacheMatches(connection, existing.value)) continue;
      const value: ModelCache = { provider: connection.provider, baseUrl: connection.baseUrl, api: connection.api,
        checkedAt: new Date().toISOString(), models: choices };
      if (existing) await this.store.updateConfig('model_cache', connectionId, existing.revision, value);
      else await this.store.createConfig('model_cache', connectionId, value);
    }
    for (const record of await this.store.listConfigs<Record<string, unknown>>('agent')) {
      if (!('modelOptionId' in record.value)) continue;
      const { modelOptionId, ...rest } = record.value;
      const profile = typeof modelOptionId === 'string' ? profiles.get(modelOptionId) : undefined;
      await this.store.updateConfig('agent', record.id, record.revision, { ...rest, connectionId: profile?.connectionId ?? null,
        modelId: profile?.connectionId ? profile.modelId : null });
    }
  }
  async getApp(): Promise<StoredConfig<AppSettings>> {
    const record = await this.store.getConfig('app', appId);
    return { ...record, value: validateAppSettings(record.value) };
  }
  async updateApp(revision: number, value: unknown): Promise<StoredConfig<AppSettings>> {
    return this.store.updateConfig('app', appId, revision, validateAppSettings(value));
  }
  async listConnections(): Promise<StoredConfig<ConnectionView>[]> {
    return (await this.store.listConfigs<ProviderConnection>('connection')).map(publicConnection);
  }
  async getConnection(id: string): Promise<StoredConfig<ConnectionView>> {
    return publicConnection(await this.store.getConfig<ProviderConnection>('connection', id));
  }
  async createConnection(id: string, value: unknown): Promise<StoredConfig<ConnectionView>> {
    return publicConnection(await this.store.createConfig('connection', id, connectionInput(value, null, this.secrets)));
  }
  async updateConnection(id: string, revision: number, value: unknown): Promise<StoredConfig<ConnectionView>> {
    const previous = await this.store.getConfig<ProviderConnection>('connection', id);
    const next = connectionInput(value, previous.value, this.secrets);
    const changedIdentity = next.provider !== previous.value.provider || next.baseUrl !== previous.value.baseUrl || next.api !== previous.value.api;
    return publicConnection(await this.store.updateConfig('connection', id, revision, next, changedIdentity));
  }
  async deleteConnection(id: string, revision: number): Promise<void> {
    await this.store.deleteConfig('connection', id, revision, true);
  }
  private choices(connection: ProviderConnection, cache?: ModelCache): ModelChoice[] {
    const known = this.models.getModels().filter(model => model.provider === connection.provider).map(model => choiceFromPi(model, connection.api));
    const choices = new Map(known.map(item => [item.modelId, item]));
    if (cacheMatches(connection, cache)) for (const item of cache.models) if (!choices.has(item.modelId)) choices.set(item.modelId, item);
    return [...choices.values()].filter(item => connection.provider !== 'modelflare' || modelflareSupportsModel(item.modelId, connection.api));
  }
  async modelChoices(connectionId: string, discover = false): Promise<ModelChoice[]> {
    const connection = (await this.store.getConfig<ProviderConnection>('connection', connectionId)).value;
    if (discover) {
      const headers: Record<string, string> = {};
      const anthropic = connection.api === 'anthropic-messages';
      if (anthropic) headers['anthropic-version'] = '2023-06-01';
      if (connection.encryptedKey) headers[anthropic ? 'x-api-key' : 'Authorization'] = anthropic
        ? this.secrets.decrypt(connection.encryptedKey)
        : `Bearer ${this.secrets.decrypt(connection.encryptedKey)}`;
      const discovered = new Map<string, ModelChoice>();
      const signal = AbortSignal.timeout(10_000);
      let afterId: string | undefined;
      for (let page = 0; page < 50; page++) {
        const url = new URL(`${connection.baseUrl}/${anthropic ? 'v1/models' : 'models'}`);
        if (afterId) url.searchParams.set('after_id', afterId);
        let payload: unknown;
        try {
          const response = await fetch(url, { headers, redirect: 'error', signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          payload = await response.json();
        } catch { throw new AppError('model_discovery_failed', 'Could not discover models from this connection', 502); }
        const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : null;
        if (!Array.isArray(data)) throw new AppError('model_discovery_failed', 'Provider model list has an unsupported format', 502);
        for (const item of data) {
          if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || item.id.length > 160) continue;
          if (connection.provider === 'modelflare' && !modelflareSupportsModel(item.id, connection.api)) continue;
          const known = this.models.getModel(connection.provider, item.id);
          const label = anthropic ? item.display_name : item.name;
          discovered.set(item.id, known ? choiceFromPi(known, connection.api) : unknownChoice(item.id, typeof label === 'string' && label && label.length <= 160 ? label : item.id, connection.api));
        }
        if (discovered.size > 5000) throw new AppError('model_discovery_failed', 'Provider model list is too large', 502);
        if (!anthropic || !(payload && typeof payload === 'object' && 'has_more' in payload && payload.has_more === true)) break;
        const cursor = 'last_id' in payload ? payload.last_id : null;
        if (typeof cursor !== 'string' || !cursor || cursor === afterId || page === 49) throw new AppError('model_discovery_failed', 'Provider model list pagination is invalid', 502);
        afterId = cursor;
      }
      const value: ModelCache = { provider: connection.provider, baseUrl: connection.baseUrl, api: connection.api, checkedAt: new Date().toISOString(), models: [...discovered.values()] };
      const old = await this.store.listConfigs<ModelCache>('model_cache');
      const existing = old.find(item => item.id === connectionId);
      if (existing) await this.store.updateConfig('model_cache', connectionId, existing.revision, value);
      else await this.store.createConfig('model_cache', connectionId, value);
    }
    const cache = await this.store.listConfigs<ModelCache>('model_cache');
    return this.choices(connection, cache.find(item => item.id === connectionId)?.value);
  }
  capabilities(): { models: ModelCapability[]; tools: ToolCapability[] } {
    return { models: this.models.getModels().map(model => ({ provider: model.provider, modelId: model.id, label: model.name,
      api: model.api, baseUrl: model.baseUrl, reasoning: model.reasoning, maxTokens: model.maxTokens,
      ...reasoningChoices(model) })),
      tools: [...this.tools.values()].map(tool => ({ name: tool.definition.name, description: tool.definition.description })) };
  }
  async listCatalog(): Promise<StoredConfig<CatalogOption>[]> {
    return (await this.store.listConfigs<CatalogOption | LegacyModelOption>('catalog')).filter((item): item is StoredConfig<CatalogOption> => item.value.kind !== 'model');
  }
  async getCatalog(id: string): Promise<StoredConfig<CatalogOption>> {
    const record = await this.store.getConfig<CatalogOption | LegacyModelOption>('catalog', id);
    if (record.value.kind === 'model') throw new AppError('not_found', 'Catalog option not found', 404);
    return record as StoredConfig<CatalogOption>;
  }
  async createCatalog(id: string, value: unknown): Promise<StoredConfig<CatalogOption>> {
    return this.store.createConfig('catalog', id, validateCatalogOption(value, this.tools));
  }
  async updateCatalog(id: string, revision: number, value: unknown): Promise<StoredConfig<CatalogOption>> {
    const previous = await this.getCatalog(id);
    const next = validateCatalogOption(value, this.tools);
    if (next.kind !== previous.value.kind) throw new AppError('invalid_config', 'Catalog option kind cannot change');
    return this.store.updateConfig('catalog', id, revision, next);
  }
  async deleteCatalog(id: string, revision: number): Promise<void> {
    await this.getCatalog(id);
    await this.store.deleteConfig('catalog', id, revision);
  }
  async getAgent(agentId: string): Promise<AgentConfigView> {
    const record = await this.store.getConfig('agent', agentId);
    const value = normalizedAgent(record.value);
    const [catalog, connections, caches] = await Promise.all([this.listCatalog(), this.store.listConfigs<ProviderConnection>('connection'), this.store.listConfigs<ModelCache>('model_cache')]);
    return { ...record, value, issues: this.issues(value, new Map(catalog.map(item => [item.id, item])), new Map(connections.map(item => [item.id, item])), new Map(caches.map(item => [item.id, item]))) };
  }
  async createAgentConfig(agentId: string, value: unknown): Promise<AgentConfigView> {
    await this.store.createConfig('agent', agentId, validateAgentSettings(value));
    return this.getAgent(agentId);
  }
  async updateAgent(agentId: string, revision: number, value: unknown): Promise<AgentConfigView> {
    await this.store.updateConfig('agent', agentId, revision, validateAgentSettings(value));
    return this.getAgent(agentId);
  }
  /** What stops each of these run settings from running, checked against the current catalog and connections. */
  async issuesFor(settings: readonly RunSettings[]): Promise<string[][]> {
    const [catalog, connections, caches] = await Promise.all([this.listCatalog(), this.store.listConfigs<ProviderConnection>('connection'), this.store.listConfigs<ModelCache>('model_cache')]);
    const options = new Map(catalog.map(item => [item.id, item]));
    const connectionMap = new Map(connections.map(item => [item.id, item]));
    const cacheMap = new Map(caches.map(item => [item.id, item]));
    return settings.map(item => this.issues(item, options, connectionMap, cacheMap));
  }
  async deleteAgent(agentId: string, revision: number): Promise<void> { await this.store.deleteConfig('agent', agentId, revision); }
  async listAgents(): Promise<AgentSummary[]> {
    const [ids, records, catalog, connections, caches] = await Promise.all([this.store.listAgents(), this.store.listConfigs('agent'), this.listCatalog(), this.store.listConfigs<ProviderConnection>('connection'), this.store.listConfigs<ModelCache>('model_cache')]);
    const byId = new Map(records.map(record => [record.id, record]));
    const options = new Map(catalog.map(item => [item.id, item]));
    const connectionMap = new Map(connections.map(item => [item.id, item]));
    const cacheMap = new Map(caches.map(item => [item.id, item]));
    return ids.map(agentId => {
      const raw = byId.get(agentId);
      if (!raw) return { agentId, name: '', ready: false, issues: ['Agent config is missing'] };
      const value = normalizedAgent(raw.value);
      const issues = this.issues(value, options, connectionMap, cacheMap);
      return { agentId, name: value.name, ready: issues.length === 0, issues };
    });
  }
  private selectedChoice(settings: RunSettings, connection?: ProviderConnection, cache?: ModelCache): ModelChoice | undefined {
    return connection && settings.modelId ? this.choices(connection, cache).find(item => item.modelId === settings.modelId) : undefined;
  }
  private issues(settings: RunSettings, catalog: ReadonlyMap<string, StoredConfig<CatalogOption>>, connections: ReadonlyMap<string, StoredConfig<ProviderConnection>>, caches: ReadonlyMap<string, StoredConfig<ModelCache>>): string[] {
    const issues: string[] = [];
    if (!settings.connectionId || !settings.modelId) issues.push('Select a provider and model');
    else {
      const connection = connections.get(settings.connectionId)?.value;
      if (!connection) issues.push('Selected provider connection is unavailable');
      else {
        const choice = this.selectedChoice(settings, connection, caches.get(settings.connectionId)?.value);
        if (!choice) issues.push('Selected model is unavailable');
        else {
          const { reasoning, maxTokens, contextBudget } = selectedOptions(settings) ?? {};
          if (reasoning && !choice.reasoningLevels.includes(reasoning)) issues.push('Reasoning level is unavailable for this model');
          if (maxTokens !== undefined && maxTokens > choice.maxTokens) issues.push('Maximum output tokens exceed this model limit');
          if (contextBudget !== undefined && contextBudget > choice.contextWindow) issues.push('Context budget exceeds this model context window');
        }
      }
    }
    for (const id of settings.toolOptionIds) {
      const option = catalog.get(id)?.value;
      if (!option || option.kind !== 'tool' || !this.tools.has(option.toolName)) issues.push(`Tool option is unavailable: ${id}`);
    }
    for (const id of settings.promptOptionIds) {
      const option = catalog.get(id)?.value;
      if (!option || option.kind !== 'prompt') issues.push(`Prompt option is unavailable: ${id}`);
    }
    return issues;
  }
  async resolveForRun(agentId: string): Promise<ResolvedRunConfig> {
    const bundle = await this.store.configBundle(agentId);
    if (!bundle.agent) throw new AppError('invalid_agent_config', 'App or agent config is missing', 409);
    return this.resolve(bundle, normalizedAgent(bundle.agent.value), bundle.agent.revision);
  }
  /** Resolves run settings that belong to something other than an agent config, such as a team member, by the same rules. */
  async resolveSettings(settings: unknown, revision: number): Promise<ResolvedRunConfig> {
    return this.resolve(await this.store.configBundle(null), validateRunSettings(settings), revision);
  }
  private resolve(bundle: Awaited<ReturnType<TeamData['configBundle']>>, settings: RunSettings, revision: number): ResolvedRunConfig {
    if (!bundle.app) throw new AppError('invalid_agent_config', 'App or agent config is missing', 409);
    validateAppSettings(bundle.app.value);
    const catalog = new Map(bundle.catalog.filter(item => (item.value as {kind?:string}).kind !== 'model').map(item => [item.id, item as StoredConfig<CatalogOption>]));
    const connections = new Map(bundle.connections.map(item => [item.id, item as StoredConfig<ProviderConnection>]));
    const caches = new Map(bundle.modelCaches.map(item => [item.id, item as StoredConfig<ModelCache>]));
    const issues = this.issues(settings, catalog, connections, caches);
    if (issues.length) throw new AppError('invalid_agent_config', issues.join('; '), 409);
    const connectionRecord = connections.get(settings.connectionId!)!;
    const connection = connectionRecord.value;
    const choice = this.selectedChoice(settings, connection, caches.get(settings.connectionId!)?.value)!;
    const knownModel = choice.source === 'pi' ? this.models.getModel(connection.provider, choice.modelId) : undefined;
    const model: Model<Api> = knownModel ? (connection.provider === 'modelflare'
      ? bindModelflareModel(knownModel, connection.api, connection.baseUrl)
      : { ...structuredClone(knownModel), api: connection.api, baseUrl: connection.baseUrl }) : {
      id: choice.modelId, name: choice.label, api: connection.api, provider: connection.provider,
      baseUrl: connection.baseUrl, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: choice.contextWindow, maxTokens: choice.maxTokens,
    };
    if (knownModel && knownModel.api !== connection.api && connection.provider !== 'modelflare') delete model.compat;
    const runModels = createModels();
    const keylessAuth = { apiKey: { name: connection.label, resolve: async () => ({ auth: {} }) } };
    const provider = this.models.getProvider(connection.provider);
    const auth = connection.encryptedKey ? keylessAuth : provider?.auth ?? keylessAuth;
    if (knownModel && knownModel.api === connection.api) {
      runModels.setProvider({ ...provider!, id: connection.provider, name: connection.label, baseUrl: connection.baseUrl,
        auth, getModels: () => [model] });
    } else {
      runModels.setProvider(createProvider({ id: connection.provider, name: connection.label, baseUrl: connection.baseUrl,
        auth, models: [model], api: connection.api === 'anthropic-messages' ? anthropicMessagesApi() : connection.api === 'openai-responses' ? openAIResponsesApi() : openAICompletionsApi() }));
    }
    const tools = settings.toolOptionIds.map(id => this.tools.get((catalog.get(id)!.value as ToolOption).toolName)!);
    const prompts = settings.promptOptionIds.map(id => (catalog.get(id)!.value as PromptOption).text);
    if (settings.prompt) prompts.push(settings.prompt);
    const catalogRevisions = Object.fromEntries([...settings.toolOptionIds, ...settings.promptOptionIds].map(id => [id, catalog.get(id)!.revision]));
    const { reasoning = choice.defaultReasoning, temperature, maxTokens, contextBudget } = selectedOptions(settings) ?? {};
    const sent = reasoning ? choice.reasoningSentAs[reasoning] : undefined;
    const options: SimpleStreamOptions = {
      ...(sent && sent !== 'off' ? { reasoning: sent } : {}),
      ...(temperature !== undefined ? { temperature } : {}), ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(connection.encryptedKey ? { apiKey: this.secrets.decrypt(connection.encryptedKey) } : {}),
    };
    return { model, models: runModels, tools: [...tools], systemPrompt: prompts.join('\n\n'), options, contextBudget,
      source: { appRevision: bundle.app.revision, agentRevision: revision, catalogRevisions,
        connectionRevision: connectionRecord.revision, modelCacheRevision: caches.get(settings.connectionId!)?.revision } };
  }
}
