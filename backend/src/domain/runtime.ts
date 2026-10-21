import { randomUUID } from 'node:crypto';
import { AssistantMessageFrameEncoder, getCurrentTools, normalizeContext, validateToolArguments, type Api, type AssistantMessage, type AssistantMessageEvent, type Context, type JsonObject, type Message, type Model, type Models, type SimpleStreamOptions, type Tool, type ToolCall, type ToolResultMessage, type UserMessage } from '@earendil-works/pi-ai';
import { MySqlStore } from '../storage/database.js';
import type { ResolvedRunConfig } from './config.js';
import { encode, validateMessage } from '../foundation/codec.js';
import { ProgressStore } from './progress.js';
import { AppError, type CompletedMessage, type ContextEntry, type ContextHistory, type CurrentState, type FollowEvent, type FollowSnapshot, type RunState } from '../foundation/types.js';

export interface StepScope {
  agentId: string;
  runId: string;
  step: number;
  signal: AbortSignal;
  config: ResolvedRunConfig;
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
  /** Compaction writes canonical context here. The loop rereads storage afterward. */
  beforeStep?(scope: StepScope): Promise<void>;
  buildRequest(scope: StepScope, history: ContextHistory): Promise<ModelRequest> | ModelRequest;
  executeTool?(tool: RuntimeTool, args: JsonObject, scope: StepScope, call: ToolCall): Promise<Pick<ToolResultMessage, 'content' | 'isError' | 'details'>>;
  shouldContinue?(scope: StepScope, response: AssistantMessage, results: ToolResultMessage[], record: CompletedMessage): Promise<boolean> | boolean;
  messageMetadata?(scope: StepScope, message: Message): JsonObject;
  /** Filesystem/history finalization after pending policy/tool effects settle, before terminal persistence. */
  afterRun?(run: { agentId: string; runId: string; status: 'completed' | 'failed' | 'cancelled' | 'interrupted' }): Promise<void>;
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
  readonly progress: ProgressStore;
  private readonly completionReads = new Map<string, Promise<RunState>>();
  private readonly jobs = new Map<string, Job>();
  private readonly finalizationFailures = new Map<string, unknown>();
  private accepting = false;
  private readonly maxSteps: number;
  private pendingStarts = new Set<Promise<RunState>>();

  constructor(readonly store: MySqlStore, private readonly config: RunConfigSource, private readonly policy: RuntimePolicy, private readonly stream: ModelStream, options: { progressCapacity?: number; maxSteps?: number } = {}) {
    this.progress = new ProgressStore(options.progressCapacity);
    this.maxSteps = options.maxSteps ?? 64;
    if (!Number.isSafeInteger(this.maxSteps) || this.maxSteps < 1) throw new AppError('invalid_config', 'Invalid runtime limits');
  }

  async open(): Promise<void> {
    await this.store.acquireRuntime(() => {
      this.accepting = false;
      for (const job of this.jobs.values()) job.controller.abort();
      this.progress.close();
    });
    try {
      await this.store.recoverInterruptedRuns(async run => this.policy.afterRun?.({ ...run, status: 'interrupted' }));
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
    this.progress.close();
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
    this.progress.changed(run.agentId);
  }

  /** Refused final publications are private input to the same model/tool loop. */
  async feedback(agentId: string, runId: string, text: string): Promise<void> {
    await this.store.commitMessage(agentId, runId, { messageId: randomUUID(), message: { role: 'user', content: text, timestamp: Date.now() }, metadata: { source: 'publication-feedback' } });
    this.progress.changed(agentId);
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
  finished(agentId: string, runId: string): Promise<RunState> {
    const key=agentId+'\0'+runId;
    const existing=this.completionReads.get(key);
    if(existing)return existing;
    const request=(async()=>{
      await this.jobs.get(runId)?.done;
      const {state}=await this.store.followSnapshot(agentId,runId,0,false);
      this.checkFinalization(runId);return state.run!;
    })();
    this.completionReads.set(key,request);
    void request.finally(()=>{if(this.completionReads.get(key)===request)this.completionReads.delete(key);}).catch(()=>{});
    return request;
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

  clearProgress(agentId: string): void { this.progress.clear(agentId); }

  async getState(agentId: string): Promise<CurrentState> {
    this.available();
    const state = await this.store.getState(agentId);
    this.checkFinalization(state.run?.runId);
    return state;
  }

  async replaceContext(agentId: string, revision: number, entries: ContextEntry[]): Promise<ContextHistory> {
    this.available();
    const result = await this.store.replaceContext(agentId, revision, entries);
    this.progress.changed(agentId);
    return result;
  }

  private checkFinalization(runId?: string): void {
    if (runId && this.finalizationFailures.has(runId)) throw new AppError('persistence_failure', 'Run stopped but terminal state could not be persisted; restart runtime after database recovery', 503);
  }

  private async runLoop(run: RunState, config: ResolvedRunConfig, signal: AbortSignal): Promise<void> {
    let status: 'completed' | 'failed' | 'cancelled' = 'completed';
    let failure: RunState['error'] = null;
    let release: (() => void) | undefined;
    let entered = !this.policy.acquireRun;
    const pendingEffects = new Set<Promise<unknown>>();
    const track = <T>(operation: Promise<T>): Promise<T> => {
      pendingEffects.add(operation);
      void operation.finally(() => pendingEffects.delete(operation)).catch(() => undefined);
      return operation;
    };
    try {
      if (this.policy.acquireRun) { release = await this.policy.acquireRun(run, signal); entered = true; }
      signal.throwIfAborted();
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
          recordInput: async (text, metadata) => {
            signal.throwIfAborted();
            this.store.assertRuntime();
            await this.store.commitMessage(run.agentId, run.runId, { messageId: randomUUID(), message: { role: 'user', content: text, timestamp: Date.now() }, metadata });
            this.progress.changed(run.agentId);
          },
        };
        if (this.policy.beforeStep) await abortable(track(this.policy.beforeStep(scope)), signal);
        const history = await this.store.getContext(run.agentId);
        const request = await abortable(track(Promise.resolve(this.policy.buildRequest(scope, history))), signal);
        const declared = getCurrentTools(normalizeContext(request.context).messages);
        const tools = new Map<string, RuntimeTool>();
        for (const tool of request.tools) {
          if (tools.has(tool.definition.name)) throw new AppError('invalid_tools', 'Duplicate executable tool name');
          tools.set(tool.definition.name, tool);
        }
        const messageId = randomUUID();
        const boundary = await this.store.beginMessage(run.agentId, run.runId, messageId, step);
        this.progress.begin(run.agentId, run.runId, messageId, boundary);
        const encoder = new AssistantMessageFrameEncoder();
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
            if (event.type === 'done' && event.reason !== event.message.stopReason) throw new AppError('invalid_stream', 'Terminal reason does not match completed message');
            const frame = encoder.encode(event);
            if (frame) this.progress.append(run.agentId, frame.type === 'start' ? { type: 'start', message: frame.partial } : frame);
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
        this.progress.settle(run.agentId, run.runId, messageId);
        const calls = response.content.filter(part => part.type === 'toolCall');
        if (new Set(calls.map(call => call.id)).size !== calls.length) throw new AppError('invalid_tool_calls', 'Duplicate tool-call identity');
        const results: ToolResultMessage[] = [];
        for (const call of calls) {
          signal.throwIfAborted();
          let result: ToolResultMessage;
          try {
            const definition = declared.find(tool => tool.name === call.name);
            const tool = tools.get(call.name);
            if (!definition || !tool) throw new AppError('unknown_tool', `Tool is unavailable: ${call.name}`);
            const args = validateToolArguments(definition, call) as JsonObject;
            const output = await abortable(track(this.policy.executeTool ? this.policy.executeTool(tool, args, scope, call) : tool.execute(args, scope, call)), signal);
            result = { ...output, role: 'toolResult', toolCallId: call.id, toolName: call.name, timestamp: Date.now() };
          } catch (error) {
            signal.throwIfAborted();
            this.store.assertRuntime();
            result = { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool failed' }], isError: true, timestamp: Date.now() };
          }
          signal.throwIfAborted();
          await this.store.commitMessage(run.agentId, run.runId, { messageId: randomUUID(), message: result, metadata: this.policy.messageMetadata?.(scope, result) ?? {} });
          this.progress.changed(run.agentId);
          results.push(result);
        }
        const again = this.policy.shouldContinue ? await abortable(track(Promise.resolve(this.policy.shouldContinue(scope, response, results, record))), signal) : calls.length > 0;
        signal.throwIfAborted();
        if (!again) break;
      }
    } catch (error) {
      status = signal.aborted ? 'cancelled' : 'failed';
      failure = { code: signal.aborted ? 'cancelled' : error instanceof AppError ? error.code : 'runtime_error', message: signal.aborted ? 'Run cancelled' : error instanceof Error ? error.message : 'Runtime failed' };
    }
    // Cancellation stops observation promptly, but finalization must wait for tool effects to stop.
    await Promise.allSettled([...pendingEffects]);
    try {
      if (entered) await this.policy.afterRun?.({ agentId: run.agentId, runId: run.runId, status });
    } catch (error) {
      status = 'failed';
      failure = { code: error instanceof AppError ? error.code : 'harness_finalization_failed', message: error instanceof Error ? error.message : 'Run finalization failed' };
    }
    try {
      this.store.assertRuntime();
      await this.store.finishRun(run.agentId, run.runId, status, failure);
    } catch (error) {
      this.finalizationFailures.set(run.runId, error);
    } finally { this.progress.settle(run.agentId, run.runId); release?.(); }
  }

  /** Completed SQL history and a bounded memory lane meet at the active message's start boundary. */
  async *follow(agentId: string, options: { runId?: string; after?: number; signal?: AbortSignal } = {}): AsyncGenerator<FollowEvent> {
    let selected: string | null | undefined = options.runId;
    let after = options.after ?? 0, first = true, lastState = '', durable = -1;
    let state: FollowSnapshot['state'] | undefined;
    let active: { id: string; next: number; gapped: boolean } | undefined;
    const lane = this.progress.lane(agentId);
    while (!options.signal?.aborted) {
      this.available();
      const version = lane.changes.version;
      if (!state || durable !== lane.durable) {
        // Capture before awaiting: commits during synchronization force another SQL read.
        durable = lane.durable;
        const snapshot = await this.store.followSnapshot(agentId, selected, after);
        state = snapshot.state; selected = state.run?.runId ?? null;
        this.checkFinalization(state.run?.runId);
        for (const record of snapshot.history) {
          after = record.position;
          if (active?.id === record.messageId) active = undefined;
          yield { version: 2, agentId, runId: selected, type: 'message', record };
        }
      }
      const { run } = state;
      const base = { version: 2 as const, agentId, runId: selected ?? null };
      if (first) { first = false; yield { ...base, type: 'sync', historyPosition: after, run }; }
      const current = encode(run);
      if (run && current !== lastState) { lastState = current; yield { ...base, type: 'state', run }; }
      // A completion may have happened while history/state events were yielded.
      if (durable !== lane.durable) continue;
      if (!run || run.status !== 'running') { yield { ...base, type: 'end', historyPosition: after, run }; return; }
      if (run.activeMessageId) {
        const id = run.activeMessageId;
        if (active?.id !== id) active = { id, next: 0, gapped: false };
        const range = this.progress.read(agentId, run.runId, id, active.next);
        if (range && range.historyPositionBeforeMessage === after && !active.gapped) {
          if (active.next < range.firstAvailable) {
            active.gapped = true;
            yield { ...base, type: 'gap', messageId: id, expectedSequence: active.next, firstAvailable: range.firstAvailable };
          } else {
            // Never hold a copied queue across a slow reader: recheck FIFO for every event.
            while (!options.signal?.aborted && durable === lane.durable) {
              const next = this.progress.read(agentId, run.runId, id, active.next);
              if (!next || active.next >= next.nextSequence) break;
              if (active.next < next.firstAvailable) {
                active.gapped = true;
                yield { ...base, type: 'gap', messageId: id, expectedSequence: active.next, firstAvailable: next.firstAvailable };
                break;
              }
              const chunk = next.chunks[0]; if (!chunk) break;
              active.next = chunk.sequence + 1;
              yield { ...base, type: 'chunk', messageId: id, sequence: chunk.sequence, event: chunk.event };
            }
          }
        }
      }
      await lane.changes.wait(version, options.signal);
    }
  }
}
