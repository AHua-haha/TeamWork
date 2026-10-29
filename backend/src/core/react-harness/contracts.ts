import type {AssistantMessage, JsonObject, Tool, ToolCall, ToolResultMessage} from '@earendil-works/pi-ai';
import type {StepScope, RuntimeTool} from '../agent/data/index.js';
import type {ComponentState, ContextEntry} from '../agent/data/index.js';
import type {AgentContextState} from '../agent/data/index.js';
import type {AgentTurnData} from '../agent/data/index.js';

export interface ReactHarnessTool { definition: Tool; execute?: never }

export interface ReactHarnessContext {
  scope: StepScope;
  toolCalls: ToolCall[];
  /** Executes one configured tool and records its protocol-paired result. Optional metadata is attached to that retained result. */
  execute(call: ToolCall, metadata?: JsonObject): Promise<ToolResultMessage>;
  /** Validate the call against tool definitions admitted to this model request. */
  validateToolCall(call: ToolCall): JsonObject;
  /** Completes earlier calls in this assistant turn, except explicitly deferred call identities. */
  beforeToolCall(call: ToolCall, deferCallIds?: string[]): Promise<void>;
  /** The actual Agent data model for this turn, including preparation context when compacting. */
  data: AgentTurnData;
}

/** Purpose-owned reaction to an assistant response; harnesses may own purpose-specific model tool definitions. */
export interface ReactHarness {
  readonly harnessId?: string;
  /** Receive an acknowledged purpose-owned durable-state update. */
  applyUpdate?(revision: number, data: JsonObject): void;
  canHandle(response: AssistantMessage): boolean;
  handle(response: AssistantMessage, context: ReactHarnessContext): Promise<void>;
  /** Reconcile legacy state once from the already-loaded context when needed. */
  restoreContext?(context: AgentContextState): void;
  /** Declarations owned and executed by this harness, without a separate permission layer. */
  tools?(scope: StepScope): Array<RuntimeTool | ReactHarnessTool>;
  /** Component-owned instructions appended to each model request, including compaction. */
  systemPrompt?(scope: StepScope): string | Promise<string>;
  /** Purpose-owned model projection; stable history and stored message bytes remain intact. */
  projectContextEntry?(entry: ContextEntry): ContextEntry;
  /** Names whose configured implementations are replaced by this harness. */
  overrideToolNames?(scope: StepScope): string[];
}

/** Creates one durable harness instance for an Agent. The instance is reused across runs. */
export interface ReactHarnessFactory {
  harnessId: string;
  create(data: ComponentState, persist: (revision: number, data: JsonObject) => Promise<ComponentState>): ReactHarness;
}
