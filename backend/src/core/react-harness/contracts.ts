import type {AgentInputData} from '../agent/data/index.js';
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
  /** Agent turn data, including paired results and deferred private instructions; also used during compaction. */
  data: AgentTurnData;
}

export interface ReactHarnessInputContext {agentId:string;input:ContextEntry;data:AgentInputData;signal:AbortSignal}

/** Purpose-owned reaction to input and assistant responses; harnesses may own purpose-specific model tool definitions. */
export interface ReactHarness {
  readonly harnessId?: string;
  onInput?(context:ReactHarnessInputContext):Promise<void>;
  /** Receive an acknowledged purpose-owned durable-state update. */
  applyUpdate?(revision: number, data: JsonObject): void;
  canHandle(response: AssistantMessage): boolean;
  handle(response: AssistantMessage, context: ReactHarnessContext): Promise<void>;
  /** Reconcile legacy state once from the already-loaded context when needed. */
  restoreContext?(context: AgentContextState): void;
  /** Declarations owned and executed by this harness, without a separate permission layer. */
  tools?(scope: StepScope): Array<RuntimeTool | ReactHarnessTool>;
  /** Fixed purpose-owned rules appended to each model request, including compaction. Changing context is separate. */
  systemPrompt?(scope: StepScope): string | Promise<string>;
  /** Purpose-owned model projection; stable history and stored message bytes remain intact. */
  projectContextEntry?(entry: ContextEntry): ContextEntry | null;
  /** Names whose configured implementations are replaced by this harness. */
  overrideToolNames?(scope: StepScope): string[];
}

/** Creates one durable harness instance for an Agent. The instance is reused across runs. */
export interface ReactHarnessFactory {
  harnessId: string;
  create(data: ComponentState, persist: (revision: number, data: JsonObject) => Promise<ComponentState>): ReactHarness;
}
