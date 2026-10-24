import { compactedContext, compactionInput, estimateRequestTokens, interruptedCompactionContext, validateCompactionSettings, type CompactionState, type CompactionTrigger } from './compaction.js';
import { finalAnswer, textPhase } from './final-answer.js';
import { AgentMessageContext, type GroupContextReference } from './context.js';
import { randomUUID } from 'node:crypto';
import { AssistantMessageFrameEncoder, getCurrentTools, normalizeContext, validateToolArguments, type Api, type AssistantMessage, type Model, type Models, type SimpleStreamOptions, type ToolResultMessage, type JsonObject } from '@earendil-works/pi-ai';
import { validateEntries, validateRun } from './message-validation.js';
import { ProgressStore } from './progress.js';
import { AppError, type CompletedMessage, type ContextEntry, type ContextHistory, type RunState } from './types.js';
import type { ModelStream, ModelRequest, AgentConfiguration, RuntimePolicy, RuntimeTool, StepScope } from './contracts.js';
export type * from './contracts.js';

/** Optional caller acknowledgements. No database, record codec or hosting dependency is required. */
export interface AgentObserver {
  assertActive?(): void;
  messageStart?(state: RunState, historyPosition: number): Promise<number | void>;
  message?(record: CompletedMessage): Promise<CompletedMessage | void>;
  contextChanged?(revision: number, entries: ContextEntry[]): Promise<ContextHistory | void>;
  compactionStarted?(state: CompactionState): Promise<void>;
  compactionMessage?(record: CompletedMessage): Promise<CompletedMessage | void>;
  compactionFinished?(state: CompactionState, revision: number, entries: ContextEntry[]): Promise<ContextHistory | void>;
  finished?(state: RunState): Promise<RunState | void>;
}
export class AgentExecution {
  private context: ContextHistory;
  private runState: RunState;
  private historyPosition: number;
  private started = false;
  constructor(run: RunState, context: ContextHistory, historyPosition: number,
    private readonly config: AgentConfiguration, private readonly policy: RuntimePolicy,
    private readonly stream: ModelStream, private readonly observer: AgentObserver = {},
    readonly progress = new ProgressStore(), private readonly maxSteps = 64) {
    validateRun(run); validateEntries(context.entries);
    this.runState = structuredClone(run); this.context = structuredClone(context); this.historyPosition = historyPosition;
    if (config.compaction) validateCompactionSettings(config.compaction);
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new AppError('invalid_config', 'Invalid model call limit');
  }
  snapshot() { return structuredClone({ run: this.runState, context: this.context, historyPosition: this.historyPosition }); }
  restoreContext(context: ContextHistory): void { validateEntries(context.entries); this.context = structuredClone(context); }
  receive(record: CompletedMessage): void {
    if (record.agentId !== this.runState.agentId || record.runId !== this.runState.runId) throw new AppError('invalid_input', 'Message belongs to another execution');
    this.context.entries.push(structuredClone({ messageId: record.messageId, message: record.message, metadata: record.metadata }));
    this.context.revision++; this.historyPosition = record.position;
    if (record.messageId === this.runState.activeMessageId) this.runState = { ...this.runState, activeMessageId: null, phase: 'tools' };
  }
  private async record(entry: ContextEntry): Promise<CompletedMessage> {
    validateEntries([entry]);
    const proposed = { ...entry, agentId: this.runState.agentId, runId: this.runState.runId, position: this.historyPosition + 1 };
    const record = await this.observer.message?.(structuredClone(proposed)) ?? proposed;
    this.receive(record); return structuredClone(record);
  }
  async replaceContext(revision: number, entries: ContextEntry[]): Promise<ContextHistory> {
    validateEntries(entries);
    if (revision !== this.context.revision) throw new AppError('context_conflict', 'Context revision changed', 409);
    const proposed = { revision: revision + 1, entries: structuredClone(entries) };
    this.context = await this.observer.contextChanged?.(revision, entries) ?? proposed;
    return structuredClone(this.context);
  }
  async run(signal: AbortSignal): Promise<RunState> {
    if (this.started) throw new AppError('run_conflict', 'Execution already started', 409);
    this.started = true;
    const run = this.runState, config = this.config;
    let status: 'completed' | 'failed' | 'cancelled' = 'completed';
    let failure: RunState['error'] = null;
    let release: (() => void) | undefined;
    let entered = !this.policy.acquireRun;
    let group: GroupContextReference | undefined;
    let preparationFailed = false;
    let acknowledgementFailure: unknown;
    const synchronize = async () => {
      const entries = await new AgentMessageContext(run.agentId, this.context).incoming(group);
      if (entries) await this.replaceContext(this.context.revision, entries);
    };
    const pendingEffects = new Set<Promise<unknown>>();
    const track = <T>(operation: Promise<T>): Promise<T> => {
      pendingEffects.add(operation);
      void operation.finally(() => pendingEffects.delete(operation)).catch(() => undefined);
      return operation;
    };
    try {
      if (this.policy.acquireRun) { release = await this.policy.acquireRun(run, signal); entered = true; }
      signal.throwIfAborted();
      group = await this.policy.groupContext?.(run.agentId);
      await synchronize();
      for (let step = 1; ; step++) {
        signal.throwIfAborted();
        this.observer.assertActive?.();
        if (step > this.maxSteps) throw new AppError('step_limit', 'Maximum model calls reached');
        const scope: StepScope = {
          agentId: run.agentId, runId: run.runId, step, signal, config, mode: 'work',
          readContext: async () => structuredClone(this.context),
          replaceContext: (revision, entries) => {
            signal.throwIfAborted();
            return this.replaceContext(revision, entries);
          },
          recordInput: async (text, metadata) => {
            signal.throwIfAborted();
            this.observer.assertActive?.();
            await this.record({ messageId: randomUUID(), message: { role: 'user', content: text, timestamp: Date.now() }, metadata });
            this.progress.changed(run.agentId);
          },
        };
        if (this.policy.beforeStep) await abortable(track(this.policy.beforeStep(scope)), signal);
        let request = await abortable(track(Promise.resolve(this.policy.buildRequest(scope, structuredClone(this.context)))), signal);
        if (config.compaction && estimateRequestTokens(request) > config.compaction.thresholdTokens) {
          try { await this.compact('before-model', scope, group, track, () => Promise.allSettled([...pendingEffects])); }
          catch (error) { preparationFailed = true; throw error; }
          request = await abortable(track(Promise.resolve(this.policy.buildRequest(scope, structuredClone(this.context)))), signal);
        }
        const {response, results, record} = await this.turn(scope, request, entry => this.record(entry), track);
        const again = this.policy.shouldContinue ? await abortable(track(Promise.resolve(this.policy.shouldContinue(scope, response, results, record))), signal) : response.content.some(part => part.type === 'toolCall');
        signal.throwIfAborted();
        if (!again) break;
      }
    } catch (error) {
      if (error instanceof AppError && error.code === 'compaction_persistence_failure') acknowledgementFailure = error;
      status = signal.aborted ? 'cancelled' : 'failed';
      failure = { code: signal.aborted ? 'cancelled' : error instanceof AppError ? error.code : 'runtime_error', message: signal.aborted ? 'Run cancelled' : error instanceof Error ? error.message : 'Runtime failed' };
    }
    // Cancellation stops observation promptly, but finalization must wait for tool effects to stop.
    await Promise.allSettled([...pendingEffects]);
    try {
      if (entered) {
        if (config.compaction && !signal.aborted && !preparationFailed) {
          await synchronize();
          const scope = this.scope(Math.max(1, this.runState.step), signal, 'work');
          const request = await this.policy.buildRequest(scope, structuredClone(this.context));
          if (estimateRequestTokens(request) > config.compaction.thresholdTokens) {
            // A finishing preparation failure must not overwrite the ordinary outcome.
            try { await this.compact('after-run', scope, group, track, () => Promise.allSettled([...pendingEffects])); }
            catch (error) { if (!(error instanceof AppError) || error.code !== 'compaction_failed') throw error; }
          }
        }
        await this.policy.afterRun?.({ agentId: run.agentId, runId: run.runId, status });
        await synchronize();
      }
    } catch (error) {
      if (error instanceof AppError && error.code === 'compaction_persistence_failure') acknowledgementFailure = error;
      status = 'failed';
      failure = { code: error instanceof AppError ? error.code : 'harness_finalization_failed', message: error instanceof Error ? error.message : 'Run finalization failed' };
    }
    const terminal: RunState = { ...this.runState, status, phase: 'finished', activeMessageId: null, endedAt: Date.now(), endPosition: this.historyPosition, error: failure };
    this.runState = terminal;
    try {
      this.observer.assertActive?.();
      this.runState = await this.observer.finished?.(structuredClone(terminal)) ?? terminal;
      if (acknowledgementFailure) throw acknowledgementFailure;
      return structuredClone(this.runState);
    } finally { this.progress.settle(run.agentId, run.runId); release?.(); }
  }

  private scope(step: number, signal: AbortSignal, mode: 'work' | 'compaction'): StepScope {
    return {agentId: this.runState.agentId, runId: this.runState.runId, step, signal, config: this.config, mode,
      readContext: async () => structuredClone(this.context),
      replaceContext: (revision, entries) => this.replaceContext(revision, entries),
      recordInput: async (text, metadata) => { signal.throwIfAborted(); await this.record(compactionInput(text, metadata)); }};
  }

  private async compact(trigger: CompactionTrigger, ordinaryScope: StepScope, group: GroupContextReference | undefined,
    track: <T>(promise: Promise<T>) => Promise<T>, settle: () => Promise<unknown>): Promise<void> {
    if (ordinaryScope.signal.aborted) { if (trigger === 'after-run') return; ordinaryScope.signal.throwIfAborted(); }
    const settings = this.config.compaction!, original = structuredClone(this.context);
    const state: CompactionState = {id: randomUUID(), agentId: this.runState.agentId, runId: this.runState.runId,
      trigger, status: 'preparing', startedAt: Date.now(), endedAt: null, error: null};
    const trace: ContextEntry[] = [], draft = structuredClone(original);
    await compactionAcknowledgement(() => this.observer.compactionStarted?.(structuredClone(state)));
    const record = async (entry: ContextEntry): Promise<CompletedMessage> => {
      const value = {...structuredClone(entry), metadata: {...entry.metadata, source: 'context-compaction', compactionId: state.id, trigger}};
      const proposed = {...value, agentId: state.agentId, runId: state.runId, position: this.historyPosition + 1};
      const saved = await compactionAcknowledgement(() => this.observer.compactionMessage?.(structuredClone(proposed))) ?? proposed;
      trace.push({messageId: saved.messageId, message: saved.message, metadata: saved.metadata});
      draft.entries.push(structuredClone(trace.at(-1)!)); draft.revision++;
      this.historyPosition = saved.position;
      this.progress.changed(state.agentId);
      return saved;
    };
    const finish = async (finished: CompactionState, revision: number, entries: ContextEntry[]) => {
      validateEntries(entries);
      if (this.observer.compactionFinished) {
        this.context = await compactionAcknowledgement(() => this.observer.compactionFinished!(structuredClone(finished), revision, structuredClone(entries))) ?? {revision: revision + 1, entries: structuredClone(entries)};
      } else await compactionAcknowledgement(() => this.replaceContext(revision, entries));
    };
    let committing = false;
    try {
      ordinaryScope.signal.throwIfAborted();
      await record(compactionInput(`${settings.prompt}\n\nCheckpoint: ${trigger}. ${trigger === 'before-model' ? 'Ordinary work will resume in the same run after successful preparation.' : 'Ordinary work has stopped. Save continuation information and remain idle afterward; do not start more ordinary work.'}`, {compactionPrompt: true}));
      for (let step = 1; ; step++) {
        ordinaryScope.signal.throwIfAborted(); this.observer.assertActive?.();
        if (step > this.maxSteps) throw new AppError('compaction_limit', 'Maximum compaction model calls reached');
        const scope: StepScope = {...ordinaryScope, mode: 'compaction', step,
          readContext: async () => structuredClone(draft),
          replaceContext: async () => { throw new AppError('context_conflict', 'Preparation context is replaced only at the compaction boundary'); },
          recordInput: async (text, metadata) => { ordinaryScope.signal.throwIfAborted(); await record(compactionInput(text, metadata)); }};
        const request = await abortable(track(Promise.resolve(this.policy.buildRequest(scope, draft))), scope.signal);
        const {response} = await this.turn(scope, request, record, track);
        if (response.content.some(block => block.type === 'toolCall')) continue;
        if (response.stopReason === 'stop' && finalAnswer(response)) break;
        if (response.stopReason === 'stop' && response.content.some(block => block.type === 'text' && textPhase(block) === 'commentary')) continue;
        throw new AppError('invalid_compaction', 'Compaction must finish naturally with nonempty continuation text');
      }
      ordinaryScope.signal.throwIfAborted();
      const entries = await compactedContext(state.agentId, original, trace.slice(1), group);
      committing = true;
      await finish({...state, status: 'completed', endedAt: Date.now()}, original.revision, entries);
    } catch (error) {
      if (committing || (error instanceof AppError && error.code === 'compaction_persistence_failure')) throw error; // Uncertain durable acknowledgement is recovered by the caller, never a competing replacement.
      await settle();
      const failure = {code: ordinaryScope.signal.aborted ? 'cancelled' : error instanceof AppError ? error.code : 'compaction_error', message: error instanceof Error ? error.message : 'Compaction failed'};
      const entries = interruptedCompactionContext(this.context, trace, failure);
      await finish({...state, status: 'failed', endedAt: Date.now(), error: failure}, this.context.revision, entries);
      throw new AppError('compaction_failed', `Context preparation failed: ${failure.message}`);
    }
  }

  private async turn(scope: StepScope, request: ModelRequest, recordMessage: (entry: ContextEntry) => Promise<CompletedMessage>,
    track: <T>(promise: Promise<T>) => Promise<T>): Promise<{response: AssistantMessage; results: ToolResultMessage[]; record: CompletedMessage}> {
    const run = this.runState, signal = scope.signal;
    const declared = getCurrentTools(normalizeContext(request.context).messages);
    const tools = new Map<string, RuntimeTool>();
    for (const tool of request.tools) {
      if (tools.has(tool.definition.name)) throw new AppError('invalid_tools', 'Duplicate executable tool name');
      tools.set(tool.definition.name, tool);
    }
    const messageId = randomUUID();
    if (scope.mode !== 'compaction') {
      this.runState = { ...this.runState, step: scope.step, phase: 'model', activeMessageId: messageId };
      const boundary = await this.observer.messageStart?.(structuredClone(this.runState), this.historyPosition) ?? this.historyPosition;
      this.historyPosition = boundary;
      this.progress.begin(run.agentId, run.runId, messageId, boundary);
    }
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
        if (frame && scope.mode !== 'compaction') this.progress.append(run.agentId, frame.type === 'start' ? { type: 'start', message: frame.partial } : frame);
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
    const record = await recordMessage({ messageId, message: response, metadata: this.policy.messageMetadata?.(scope, response) ?? {} });
    if (scope.mode !== 'compaction') this.progress.settle(run.agentId, run.runId, messageId);
    if (scope.mode === 'compaction' && response.stopReason === 'length') throw new AppError('incomplete_compaction', 'Compaction output reached its token limit');
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
        this.observer.assertActive?.();
        result = { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool failed' }], isError: true, timestamp: Date.now() };
      }
      signal.throwIfAborted();
      await recordMessage({ messageId: randomUUID(), message: result, metadata: this.policy.messageMetadata?.(scope, result) ?? {} });
      if (scope.mode !== 'compaction') this.progress.changed(run.agentId);
      results.push(result);
    }
    return {response, results, record};
  }

}

export function piModelStream(models: Models): ModelStream {
  return (request, signal) => (request.models ?? models).streamSimple(request.model, request.context, { maxRetries: 0, ...request.options, deferred: false, signal });
}

/** A simple starting policy. Every agent uses AgentExecution's single loop. */
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

async function compactionAcknowledgement<T>(operation: () => Promise<T> | undefined): Promise<T | undefined> {
  try { return await operation(); }
  catch (error) { throw new AppError('compaction_persistence_failure', `Context preparation could not be acknowledged: ${error instanceof Error ? error.message : 'persistence failed'}`); }
}
