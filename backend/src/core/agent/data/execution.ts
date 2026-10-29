import type {Api, JsonObject, Model, Models, SimpleStreamOptions, Tool, ToolCall, ToolResultMessage} from '@earendil-works/pi-ai';
import type {CompactionSettings} from './compaction.js';
import type {ContextHistory, ContextEntry} from './model.js';

export interface AgentConfiguration {
  model: Model<Api>; models?: Models; tools: RuntimeTool[]; systemPrompt: string;
  options: SimpleStreamOptions; contextBudget?: number; compaction?: CompactionSettings;
}

export interface ResolvedRunConfig extends AgentConfiguration {
  source: { appRevision: number; agentRevision: number; catalogRevisions: Record<string, number>; connectionRevision?: number; modelCacheRevision?: number };
}
export interface RunConfigSource { resolveForRun(agentId: string): Promise<ResolvedRunConfig> }


export interface StepScope {
  mode?: 'work' | 'compaction';
  agentId: string;
  runId: string;
  step: number;
  signal: AbortSignal;
  config: AgentConfiguration;
  readContext(): Promise<ContextHistory>;
  replaceContext(revision: number, entries: ContextEntry[]): Promise<ContextHistory>;
  recordInput(text: string, metadata: JsonObject): Promise<void>;
}

export interface RuntimeTool {
  definition: Tool;
  execute(args: JsonObject, scope: StepScope, call: ToolCall): Promise<Pick<ToolResultMessage, 'content' | 'isError' | 'details'>>;
}
