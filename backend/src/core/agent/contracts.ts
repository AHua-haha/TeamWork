import type { Api, AssistantMessage, AssistantMessageEvent, Context, JsonObject, Message, Model, Models, SimpleStreamOptions, Tool, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { CompactionSettings } from './data/compaction.js';
import type { GroupContextReference } from './data/context.js';
import type { CompletedMessage, ContextEntry, ContextHistory, RunState } from './data/model.js';

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

export interface ModelRequest {
  model: Model<Api>;
  models?: Models;
  context: Context;
  tools: RuntimeTool[];
  options?: SimpleStreamOptions;
}

export interface AssistantResponseHandlerContext {
  scope: StepScope;
  toolCalls: ToolCall[];
  /** Executes one existing configured tool and records its protocol-paired result. */
  execute(call: ToolCall): Promise<ToolResultMessage>;
  /** Append an Agent-owned private message after outstanding tool results have been recorded. */
  appendHint(message: Message, metadata?: JsonObject): Promise<void>;
  /** Persist targeted metadata changes without modifying stored message content. */
  updateMetadata(updates: Array<{messageId: string; metadata: JsonObject}>): Promise<void>;
}

/** Agent-owned reaction to an assistant response; handlers orchestrate existing tools, not define new tool capabilities. */
export interface AssistantResponseHandler {
  canHandle(response: AssistantMessage): boolean;
  handle(response: AssistantMessage, context: AssistantResponseHandlerContext): Promise<void>;
}

export interface RuntimePolicy {
  /** Creates run-local handlers so mutable handler state cannot leak between Agent executions. */
  createAssistantResponseHandlers?(agentId: string): AssistantResponseHandler[];
  /** Read reference only; Agent selects incoming messages using its own state. */
  groupContext?(agentId: string): Promise<GroupContextReference | undefined>;
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
