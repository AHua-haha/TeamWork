import { randomUUID } from 'node:crypto';
import { getCurrentTools, normalizeContext, validateToolArguments, type Api, type AssistantMessage, type AssistantMessageEvent, type Context, type JsonObject, type Message, type Model, type Models, type SimpleStreamOptions, type Tool, type ToolCall, type ToolResultMessage, type UserMessage } from '@earendil-works/pi-ai';
import { MySqlStore } from './database.js';
import type { ResolvedRunConfig } from './config.js';
import { encode, validateMessage } from './codec.js';
import { Changes } from './changes.js';
import { AppError, type CompletedMessage, type ContextEntry, type ContextHistory, type CurrentState, type FollowEvent, type Retention, type RunState } from './types.js';

export interface StepScope {
  agentId: string;
  runId: string;
  step: number;
  signal: AbortSignal;
  config: ResolvedRunConfig;
  readContext(): Promise<ContextHistory>;
  replaceContext(revision: number, entries: ContextEntry[]): Promise<ContextHistory>;
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
  /** Compaction writes canonical context here. The loop rereads storage afterward. */
  beforeStep?(scope: StepScope): Promise<void>;
  buildRequest(scope: StepScope, history: ContextHistory): Promise<ModelRequest> | ModelRequest;
  executeTool?(tool: RuntimeTool, args: JsonObject, scope: StepScope, call: ToolCall): Promise<Pick<ToolResultMessage, 'content' | 'isError' | 'details'>>;
  shouldContinue?(scope: StepScope, response: AssistantMessage, results: ToolResultMessage[], record: CompletedMessage): Promise<boolean> | boolean;
  messageMetadata?(scope: StepScope, message: Message): JsonObject;
}

export type ModelStream = (request: ModelRequest, signal: AbortSignal) => AsyncIterable<AssistantMessageEvent>;
export interface RunConfigSource { resolveForRun(agentId: string): Promise<ResolvedRunConfig> }

export function piModelStream(models: Models): ModelStream {
  return (request, signal) => (request.models ?? models).streamSimple(request.model, request.context, { maxRetries: 0, ...request.options, deferred: false, signal });
}

/** A simple starting policy. Every agent still uses AgentRuntime's single loop. */
export function fixedPolicy(model: Model<Api>, tools: RuntimeTool[] = [], systemPrompt?: string, options?: SimpleStreamOptions): RuntimePolicy {
  return {
    buildRequest: (_scope, history) => ({ model, tools, options, context: { messages: history.entries.map(entry => entry.message), tools: tools.map(tool => tool.definition), ...(systemPrompt ? { systemPrompt } : {}) } }),
  };
}

export function configuredPolicy(): RuntimePolicy {
  return {
    buildRequest: (scope, history) => ({
      model: scope.config.model, models: scope.config.models, tools: scope.config.tools, options: scope.config.options,
      context: { messages: history.entries.map(entry => entry.message), tools: scope.config.tools.map(tool => tool.definition), ...(scope.config.systemPrompt ? { systemPrompt: scope.config.systemPrompt } : {}) },
    }),
  };
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new AppError('cancelled', 'Run cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

interface Job { agentId: string; controller: AbortController; done: Promise<void> }

export class AgentRuntime {
  private readonly changes = new Changes();
  private readonly jobs = new Map<string, Job>();
  private readonly finalizationFailures = new Map<string, unknown>();
  private accepting = false;
  private readonly retention: Retention;
  private readonly maxSteps: number;
  private pendingStarts = new Set<Promise<RunState>>();

  constructor(readonly store: MySqlStore, private readonly config: RunConfigSource, private readonly policy: RuntimePolicy, private readonly stream: ModelStream, options: { retention?: Retention; maxSteps?: number } = {}) {
    this.retention = options.retention ?? { maxChunks: 256, maxBytes: 8 * 1024 * 1024 };
    this.maxSteps = options.maxSteps ?? 32;
    if (!Number.isSafeInteger(this.maxSteps) || this.maxSteps < 1 || Object.values(this.retention).some(value => !Number.isSafeInteger(value) || value < 0)) throw new AppError('invalid_config', 'Invalid runtime limits');
  }

  async open(): Promise<void> {
    await this.store.acquireRuntime(() => {
      this.accepting = false;
      for (const job of this.jobs.values()) job.controller.abort();
      this.changes.publish();
    });
    try {
      await this.store.recoverInterruptedRuns();
      this.finalizationFailures.clear();
      this.accepting = true;
    } catch (error) {
      await this.store.releaseRuntime();
      throw error;
    }
  }

  private available(): void {
    this.store.assertRuntime();
    if (!this.accepting) throw new AppError('runtime_unavailable', 'Runtime is not accepting work', 503);
  }

  async close(): Promise<void> {
    this.accepting = false;
    await Promise.allSettled(this.pendingStarts);
    for (const job of this.jobs.values()) job.controller.abort();
    this.changes.publish();
    await Promise.allSettled([...this.jobs.values()].map(job => job.done));
    await this.store.releaseRuntime();
  }

  start(agentId: string, content: UserMessage['content']): Promise<RunState> {
    this.available();
    const input: UserMessage = { role: 'user', content, timestamp: Date.now() };
    validateMessage(input);
    if ((typeof content === 'string' && !content.trim()) || (Array.isArray(content) && content.length === 0)) throw new AppError('invalid_input', 'User input cannot be empty');
    const accepted = (async () => {
      const config = await this.config.resolveForRun(agentId);
      const run = await this.store.startRun(agentId, input);
      this.launch(run, config);
      return run;
    })();
    this.pendingStarts.add(accepted);
    void accepted.finally(() => this.pendingStarts.delete(accepted)).catch(() => undefined);
    return accepted;
  }

  /** Resolve a member configuration before the team atomically accepts a publication. */
  async prepareRun(agentId: string): Promise<ResolvedRunConfig> {
    this.available();
    return this.config.resolveForRun(agentId);
  }

  /** Execute an already-persisted run. Group publication owns creation and input delivery. */
  launch(run: RunState, config: ResolvedRunConfig): void {
    // Shutdown waits for accepted starts to register, then aborts their jobs before releasing the lease.
    this.store.assertRuntime();
    if (this.jobs.has(run.runId)) throw new AppError('agent_busy', 'Run already launched', 409);
    const controller = new AbortController();
    const done = Promise.resolve().then(() => this.runLoop(run, config, controller.signal)).finally(() => this.jobs.delete(run.runId));
    this.jobs.set(run.runId, { agentId: run.agentId, controller, done });
    this.changes.publish();
  }

  /** Refused final publications are private input to the same model/tool loop. */
  async feedback(agentId: string, runId: string, text: string): Promise<void> {
    await this.store.commitMessage(agentId, runId, { messageId: randomUUID(), message: { role: 'user', content: text, timestamp: Date.now() }, metadata: { source: 'publication-feedback' } });
    this.changes.publish();
  }

  async cancel(agentId: string, runId: string): Promise<void> {
    this.available();
    const snapshot = await this.store.followSnapshot(agentId, runId, 0, false);
    if (snapshot.state.run?.status !== 'running') return;
    const job = this.jobs.get(runId);
    if (!job) throw new AppError('runtime_unavailable', 'Run has no live worker; restart runtime to recover', 503);
    job.controller.abort();
  }

  /** Resolves with the run's final state once its work has ended here. A run this runtime does not run reports its stored state at once. */
  async finished(agentId: string, runId: string): Promise<RunState> {
    await this.jobs.get(runId)?.done;
    const { state } = await this.store.followSnapshot(agentId, runId, 0, false);
    this.checkFinalization(runId);
    return state.run!;
  }

  /** The text of the last assistant message of a run that has any, or an empty string. */
  async finalText(agentId: string, runId: string): Promise<string> {
    const messages = await this.store.runMessages(agentId, runId);
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]!.message;
      if (message.role !== 'assistant') continue;
      const text = message.content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n').trim();
      if (text) return text;
    }
    return '';
  }

  async getState(agentId: string): Promise<CurrentState> {
    this.available();
    const state = await this.store.getState(agentId);
    this.checkFinalization(state.run?.runId);
    return state;
  }

  async replaceContext(agentId: string, revision: number, entries: ContextEntry[]): Promise<ContextHistory> {
    this.available();
    const result = await this.store.replaceContext(agentId, revision, entries);
    this.changes.publish();
    return result;
  }

  private checkFinalization(runId?: string): void {
    if (runId && this.finalizationFailures.has(runId)) throw new AppError('persistence_failure', 'Run stopped but terminal state could not be persisted; restart runtime after database recovery', 503);
  }

  private async runLoop(run: RunState, config: ResolvedRunConfig, signal: AbortSignal): Promise<void> {
    let status: 'completed' | 'failed' | 'cancelled' = 'completed';
    let failure: RunState['error'] = null;
    try {
      for (let step = 1; ; step++) {
        signal.throwIfAborted();
        this.store.assertRuntime();
        if (step > this.maxSteps) throw new AppError('step_limit', 'Maximum model calls reached');
        const scope: StepScope = {
          agentId: run.agentId, runId: run.runId, step, signal, config,
          readContext: () => this.store.getContext(run.agentId),
          replaceContext: (revision, entries) => {
            signal.throwIfAborted();
            return this.replaceContext(run.agentId, revision, entries);
          },
        };
        if (this.policy.beforeStep) await abortable(this.policy.beforeStep(scope), signal);
        const history = await this.store.getContext(run.agentId);
        const request = await abortable(Promise.resolve(this.policy.buildRequest(scope, history)), signal);
        const declared = getCurrentTools(normalizeContext(request.context).messages);
        const tools = new Map<string, RuntimeTool>();
        for (const tool of request.tools) {
          if (tools.has(tool.definition.name)) throw new AppError('invalid_tools', 'Duplicate executable tool name');
          tools.set(tool.definition.name, tool);
        }
        const messageId = randomUUID();
        await this.store.beginMessage(run.agentId, run.runId, messageId, step);
        this.changes.publish();
        let response: AssistantMessage | undefined;
        let started = false;
        const iterator = this.stream(request, signal)[Symbol.asyncIterator]();
        try {
          while (true) {
            const item = await abortable(iterator.next(), signal);
            if (item.done) break;
            const event = item.value;
            if (event.type === 'start') {
              if (started) throw new AppError('invalid_stream', 'Duplicate Pi start event');
              started = true;
            } else if (event.type !== 'error' && !started) throw new AppError('invalid_stream', 'Pi update arrived before start');
            await this.store.appendChunk(run.agentId, run.runId, messageId, event, this.retention);
            this.changes.publish();
            if (event.type === 'error') throw new AppError('model_error', event.error.errorMessage || 'Model request failed');
            if (event.type === 'done') {
              response = structuredClone(event.message);
              break;
            }
          }
        } finally {
          // A provider must honor signal; do not let an uncooperative iterator delay cancellation.
          void iterator.return?.().catch(() => undefined);
        }
        signal.throwIfAborted();
        if (!response) throw new AppError('invalid_stream', 'Model stream ended without a final response');
        if (!['stop', 'length', 'toolUse'].includes(response.stopReason)) throw new AppError('model_error', `Unsupported terminal model state: ${response.stopReason}`);
        const record = await this.store.commitMessage(run.agentId, run.runId, { messageId, message: response, metadata: this.policy.messageMetadata?.(scope, response) ?? {} });
        this.changes.publish();
        const calls = response.content.filter(part => part.type === 'toolCall');
        if (new Set(calls.map(call => call.id)).size !== calls.length) throw new AppError('invalid_tool_calls', 'Duplicate tool-call identity');
        const results: ToolResultMessage[] = [];
        for (const call of calls) {
          signal.throwIfAborted();
          let result: ToolResultMessage;
          let toolError: unknown;
          try {
            const definition = declared.find(tool => tool.name === call.name);
            const tool = tools.get(call.name);
            if (!definition || !tool) throw new AppError('unknown_tool', `Tool is unavailable: ${call.name}`);
            const args = validateToolArguments(definition, call) as JsonObject;
            const output = await abortable(this.policy.executeTool ? this.policy.executeTool(tool, args, scope, call) : tool.execute(args, scope, call), signal);
            result = { ...output, role: 'toolResult', toolCallId: call.id, toolName: call.name, timestamp: Date.now() };
            if (result.isError) toolError = new AppError('tool_error', `Tool reported failure: ${call.name}`);
          } catch (error) {
            signal.throwIfAborted();
            toolError = error;
            result = { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool failed' }], isError: true, timestamp: Date.now() };
          }
          signal.throwIfAborted();
          await this.store.commitMessage(run.agentId, run.runId, { messageId: randomUUID(), message: result, metadata: this.policy.messageMetadata?.(scope, result) ?? {} });
          this.changes.publish();
          results.push(result);
          if (toolError) throw toolError;
        }
        const again = this.policy.shouldContinue ? await abortable(Promise.resolve(this.policy.shouldContinue(scope, response, results, record)), signal) : calls.length > 0;
        signal.throwIfAborted();
        if (!again) break;
      }
    } catch (error) {
      status = signal.aborted ? 'cancelled' : 'failed';
      failure = { code: signal.aborted ? 'cancelled' : error instanceof AppError ? error.code : 'runtime_error', message: signal.aborted ? 'Run cancelled' : error instanceof Error ? error.message : 'Runtime failed' };
    }
    try {
      this.store.assertRuntime();
      await this.store.finishRun(run.agentId, run.runId, status, failure);
    } catch (error) {
      this.finalizationFailures.set(run.runId, error);
    } finally { this.changes.publish(); }
  }

  async *follow(agentId: string, options: { runId?: string; after?: number; signal?: AbortSignal } = {}): AsyncGenerator<FollowEvent> {
    let selected: string | null | undefined = options.runId;
    let after = options.after ?? 0;
    let first = true;
    let lastState = '';
    let active: { id: string; next: number; gapped: boolean } | undefined;
    while (!options.signal?.aborted) {
      this.available();
      const version = this.changes.version;
      const snapshot = await this.store.followSnapshot(agentId, selected, after);
      const { run } = snapshot.state;
      selected = run?.runId ?? null;
      this.checkFinalization(run?.runId);
      const base = { version: 1 as const, agentId, runId: selected };
      for (const record of snapshot.history) {
        after = record.position;
        yield { ...base, type: 'message', record };
      }
      if (first) {
        first = false;
        yield { ...base, type: 'sync', historyPosition: after, run };
      }
      const state = encode(run);
      if (run && state !== lastState) {
        lastState = state;
        yield { ...base, type: 'state', run };
      }
      if (!run || run.status !== 'running') {
        yield { ...base, type: 'end', historyPosition: after, run };
        return;
      }
      const live = snapshot.live;
      if (live) {
        if (active?.id !== live.messageId) active = { id: live.messageId, next: 0, gapped: false };
        if (!active.gapped && active.next < live.firstAvailable) {
          active.gapped = true;
          yield { ...base, type: 'gap', messageId: live.messageId, expectedSequence: active.next, firstAvailable: live.firstAvailable };
        }
        if (!active.gapped) {
          for (const chunk of live.chunks) {
            if (chunk.sequence < active.next) continue;
            active.next = chunk.sequence + 1;
            yield { ...base, type: 'chunk', messageId: live.messageId, ...chunk };
          }
        }
      }
      await this.changes.wait(version, options.signal);
    }
  }
}
