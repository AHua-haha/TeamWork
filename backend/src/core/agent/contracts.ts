import type {Api, AssistantMessage, AssistantMessageEvent, Context, JsonObject, Message, Model, Models, SimpleStreamOptions, ToolCall, ToolResultMessage} from '@earendil-works/pi-ai';
import type {GroupContextReference} from './data/context.js';
import type {CompletedMessage, ContextHistory, RunState} from './data/model.js';
import type {StepScope, RuntimeTool} from './data/execution.js';
import type {ReactHarness, ReactHarnessTool, ReactHarnessFactory} from '../react-harness/index.js';
export type * from './data/execution.js';

export interface ModelRequest {
  model: Model<Api>;
  models?: Models;
  context: Context;
  tools: Array<RuntimeTool | ReactHarnessTool>;
  options?: SimpleStreamOptions;
}

export interface RuntimePolicy {
  /** Creates durable harness factories. AgentRuntime initializes each factory once per Agent and reuses the instances across runs. */
  createReactHarnessFactories?(agentId: string): ReactHarnessFactory[] | Promise<ReactHarnessFactory[]>;
  /** Optional in-memory instance provider for callers without durable factories; cached per Agent. */
  createReactHarnesses?(agentId: string): ReactHarness[];
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
