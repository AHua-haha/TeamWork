import { BackendError } from './agent-client.js';

/** The shared reasoning scale; the backend clamps each level to one the model supports (see `reasoningSentAs`). */
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh';
/** A level Pi actually sends to the provider. */
export type SentReasoningLevel = ReasoningLevel | 'minimal' | 'max';
export interface ConfigRecord<T> { id: string; revision: number; value: T }
export interface AppSettings { title: string; maxInputBytes: number; allowAgentCreation: boolean }
export interface ConnectionView { label: string; provider: string; baseUrl: string; api: 'openai-completions' | 'openai-responses' | 'anthropic-messages'; keyConfigured: boolean }
export interface ConnectionInput { label: string; provider: string; baseUrl: string; api: ConnectionView['api']; apiKey?: string | null }
export interface ModelChoice { source: 'pi' | 'endpoint'; modelId: string; label: string; api: string; reasoning: boolean; reasoningLevels: ReasoningLevel[]; defaultReasoning: ReasoningLevel | null; reasoningSentAs: Partial<Record<ReasoningLevel, SentReasoningLevel>>; contextWindow: number; maxTokens: number; verified: boolean }
export interface ToolOption { kind: 'tool'; label: string; toolName: string }
export interface PromptOption { kind: 'prompt'; label: string; text: string }
export type CatalogOption = ToolOption | PromptOption;
export interface ModelOptions { connectionId: string; modelId: string; reasoning?: ReasoningLevel; temperature?: number; maxTokens?: number; contextBudget?: number }
export interface AgentSettings {
  name: string; connectionId: string | null; modelId: string | null; toolOptionIds: string[];
  prompt: string; promptOptionIds: string[]; modelOptions: ModelOptions[];
}
export interface AgentConfig extends ConfigRecord<AgentSettings> { issues: string[] }
export interface AgentSummary { agentId: string; name: string; ready: boolean; issues: string[] }
export interface Capabilities {
  models: { provider: string; modelId: string; label: string; api: string; baseUrl: string; reasoning: boolean; maxTokens: number; reasoningLevels: ReasoningLevel[]; defaultReasoning: ReasoningLevel | null; reasoningSentAs: Partial<Record<ReasoningLevel, SentReasoningLevel>> }[];
  tools: { name: string; description: string }[];
}

async function json<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload && typeof payload === 'object' && 'error' in payload) ? payload.error as { code?: string; message?: string } : null;
    throw new BackendError(error?.message ?? `Backend request failed (${response.status})`, response.status, error?.code ?? 'http_error');
  }
  return payload as T;
}

/** Config requests stay in the backend's record format; no assistant-ui types enter here. */
export class ConfigClient {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  private get<T>(path: string): Promise<T> { return this.fetcher(path).then(json<T>); }
  private write<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', data: object): Promise<T> {
    return this.fetcher(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json<T>);
  }
  getApp(): Promise<ConfigRecord<AppSettings>> { return this.get('/config/app'); }
  updateApp(record: ConfigRecord<AppSettings>, value: AppSettings): Promise<ConfigRecord<AppSettings>> {
    return this.write('/config/app', 'PUT', { revision: record.revision, value });
  }
  listAgents(): Promise<AgentSummary[]> { return this.get('/agents'); }
  capabilities(): Promise<Capabilities> { return this.get('/config/capabilities'); }
  listConnections(): Promise<ConfigRecord<ConnectionView>[]> { return this.get('/config/connections'); }
  createConnection(id: string, value: ConnectionInput): Promise<ConfigRecord<ConnectionView>> {
    return this.write('/config/connections', 'POST', { id, value });
  }
  updateConnection(record: ConfigRecord<ConnectionView>, value: ConnectionInput): Promise<ConfigRecord<ConnectionView>> {
    return this.write(`/config/connections/${encodeURIComponent(record.id)}`, 'PUT', { revision: record.revision, value });
  }
  deleteConnection(record: ConfigRecord<ConnectionView>): Promise<{ deleted: string }> {
    return this.write(`/config/connections/${encodeURIComponent(record.id)}`, 'DELETE', { revision: record.revision });
  }
  modelChoices(connectionId: string, discover = false): Promise<ModelChoice[]> {
    const path = `/config/connections/${encodeURIComponent(connectionId)}/models`;
    return discover ? this.write(`${path}/refresh`, 'POST', {}) : this.get(path);
  }
  listCatalog(): Promise<ConfigRecord<CatalogOption>[]> { return this.get('/config/catalog'); }
  createCatalog(id: string, value: CatalogOption): Promise<ConfigRecord<CatalogOption>> {
    return this.write('/config/catalog', 'POST', { id, value });
  }
  updateCatalog(record: ConfigRecord<CatalogOption>, value: CatalogOption): Promise<ConfigRecord<CatalogOption>> {
    return this.write(`/config/catalog/${encodeURIComponent(record.id)}`, 'PUT', { revision: record.revision, value });
  }
  deleteCatalog(record: ConfigRecord<CatalogOption>): Promise<{ deleted: string }> {
    return this.write(`/config/catalog/${encodeURIComponent(record.id)}`, 'DELETE', { revision: record.revision });
  }
  getAgent(agentId: string): Promise<AgentConfig> { return this.get(`/agents/${encodeURIComponent(agentId)}/config`); }
  createAgentConfig(agentId: string, value: AgentSettings): Promise<AgentConfig> {
    return this.write(`/agents/${encodeURIComponent(agentId)}/config`, 'POST', { value });
  }
  updateAgent(record: AgentConfig, value: AgentSettings): Promise<AgentConfig> {
    return this.write(`/agents/${encodeURIComponent(record.id)}/config`, 'PUT', { revision: record.revision, value });
  }
}
