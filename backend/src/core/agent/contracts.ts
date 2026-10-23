import type { Api, AssistantMessage, AssistantMessageEvent, Context, JsonObject, Message, Model, Models, SimpleStreamOptions, Tool, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { CompletedMessage, ContextEntry, ContextHistory, RunState } from './types.js';

export interface AgentConfiguration {
  model: Model<Api>; models?: Models; tools: RuntimeTool[]; systemPrompt: string;
  options: SimpleStreamOptions; contextBudget?: number;
}

export interface StepScope {
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

export interface ModelRequest {
  model: Model<Api>;
  models?: Models;
  context: Context;
  tools: RuntimeTool[];
  options?: SimpleStreamOptions;
}

export interface RuntimePolicy {
  /** Acquire execution authority before any model/tool work; release after terminal finalization. */
  acquireRun?(run: RunState, signal: AbortSignal): Promise<() => void>;
  /** Caller policy may update the in-memory working context before the next request. */
  beforeStep?(scope: StepScope): Promise<void>;
  buildRequest(scope: StepScope, history: ContextHistory): Promise<ModelRequest> | ModelRequest;
  executeTool?(tool: RuntimeTool, args: JsonObject, scope: StepScope, call: ToolCall): Promise<Pick<ToolResultMessage, 'content' | 'isError' | 'details'>>;
  shouldContinue?(scope: StepScope, response: AssistantMessage, results: ToolResultMessage[], record: CompletedMessage): Promise<boolean> | boolean;
  messageMetadata?(scope: StepScope, message: Message): JsonObject;
  /** Filesystem/history finalization after pending policy/tool effects settle, before terminal acknowledgement. */
  afterRun?(run: { agentId: string; runId: string; status: 'completed' | 'failed' | 'cancelled' | 'interrupted' }): Promise<void>;
}

export type ModelStream = (request: ModelRequest, signal: AbortSignal) => AsyncIterable<AssistantMessageEvent>;
