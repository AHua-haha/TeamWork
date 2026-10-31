import {AgentInputData, countedMessage} from './data/input.js';
import {reactToUserInputs} from './input-reactions.js';
import {AgentMessageData, AgentTurnData, type AgentMessagePersistence} from './data/messages.js';
import { AgentState, AgentContextState } from './data/state.js';
import { compactedContext, compactionInput, estimateRequestTokens, compactionAcknowledgement, validateCompactionSettings, type CompactionState, type CompactionTrigger, type PreparedComponentState } from './data/compaction.js';
import { finalAnswer, textPhase } from './final-answer.js';
import { AgentMessageContext, type GroupContextReference } from './data/context.js';
import { randomUUID } from 'node:crypto';
import { AssistantMessageFrameEncoder, validateToolArguments, type Api, type AssistantMessage, type Model, type Models, type SimpleStreamOptions, type ToolResultMessage, type JsonObject } from '@earendil-works/pi-ai';
import { validateEntries } from './data/validation.js';
import { ProgressStore } from './data/progress.js';
import { AppError, type CompletedMessage, type ContextEntry, type ContextHistory, type RunState } from './data/model.js';
import type { ModelStream, ModelRequest, AgentConfiguration, RuntimePolicy, RuntimeTool, StepScope } from './contracts.js';
import type {ReactHarness, ReactHarnessCompaction, ReactHarnessContext} from '../react-harness/index.js';
import { DefaultReactHarness } from '../react-harness/index.js';
export { DefaultReactHarness } from '../react-harness/index.js';
export type * from './contracts.js';

/** Optional caller acknowledgements. No database, record codec or hosting dependency is required. */
export interface AgentObserver extends AgentMessagePersistence {
  assertActive?(): void;
  messageStart?(state: RunState, historyPosition: number): Promise<number | void>;
  compactionStarted?(state: CompactionState): Promise<void>;
  compactionFinished?(state: CompactionState, revision: number, entries: ContextEntry[]): Promise<ContextHistory | void>;
  finished?(state: RunState): Promise<RunState | void>;
}

export class AgentExecution {
  private readonly state:AgentState;
  private readonly messages: AgentMessageData;
  private readonly reactHarnesses: ReactHarness[];
  private get context(){return this.state.context;}
  private set context(value:ContextHistory){this.state.acceptContext(value);}
  private get runState(){return this.state.run;}
  private set runState(value:RunState){this.state.acceptRun(value);}
  private get historyPosition(){return this.state.historyPosition;}
  private set historyPosition(value:number){this.state.acceptPosition(value);}
  private started = false;
  constructor(run: RunState, context: ContextHistory | AgentContextState, historyPosition: number,
    private readonly config: AgentConfiguration, private readonly policy: RuntimePolicy,
    private readonly stream: ModelStream, private readonly observer: AgentObserver = {},
    readonly progress = new ProgressStore(), private readonly maxSteps = 64,
    reactHarnesses?: ReactHarness[]) {
    this.state=new AgentState(run,context,historyPosition);
    this.messages=new AgentMessageData(this.state, observer, () => this.progress.changed(run.agentId));
    this.reactHarnesses = reactHarnesses ?? policy.createReactHarnesses?.(run.agentId) ?? [];
    if (config.compaction) validateCompactionSettings(config.compaction);
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new AppError('invalid_config', 'Invalid model call limit');
  }
  snapshot(){return this.state.snapshot();}
  restoreContext(context:ContextHistory):void{this.state.acceptContext(context);}
  attachContext(context:AgentContextState):void{this.state.attachContext(context);}
  receive(record:CompletedMessage):void{this.state.receive(record);}
  private async buildModelRequest(scope: StepScope, history: ContextHistory, messages = this.messages, harnesses = this.reactHarnesses): Promise<ModelRequest> {
    for (const harness of harnesses) harness.restoreContext?.(messages.context);
    const projected = structuredClone(history);
    projected.entries=projected.entries.flatMap(entry=>{
      let value:ContextEntry|null=entry;
      for(const harness of harnesses)if(value){const next:ContextEntry|null|undefined=harness.projectContextEntry?.(value);if(next!==undefined)value=next;}
      return value?[value]:[];
    });
    const request = await this.policy.buildRequest(scope, projected);
    const owned = harnesses.flatMap(harness => harness.tools?.(scope) ?? []);
    const overridden = new Set(harnesses.flatMap(harness => harness.overrideToolNames?.(scope) ?? []));
    const prompts = (await Promise.all(harnesses.map(harness => harness.systemPrompt?.(scope)))).map(prompt => prompt?.trim()).filter((prompt): prompt is string => !!prompt);
    if (!owned.length && !overridden.size && !prompts.length) return request;
    const ownedNames = new Set(owned.map(tool => tool.definition.name));
    const tools = [...request.tools.filter(tool => !overridden.has(tool.definition.name) && !ownedNames.has(tool.definition.name)), ...owned];
    const definitions = tools.map(tool => tool.definition);
    request.tools = tools;
    request.context = {...request.context, tools: definitions,
      ...(prompts.length ? {systemPrompt: [request.context.systemPrompt, ...prompts].filter(Boolean).join('\n\n')} : {})};
    return request;
  }

  replaceContext(revision: number, entries: ContextEntry[]): Promise<ContextHistory> {return this.messages.replace(revision, entries);}
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
      const change = await new AgentMessageContext(run.agentId, this.context).changes(group);
      if (!change) return;
      if ('replace' in change) await this.replaceContext(this.context.revision, change.replace);
      else await this.messages.patch(change.patch);
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
      await reactToUserInputs(run.agentId,new AgentInputData(this.state.contextModel,this.observer.contextPatched?.bind(this.observer),!!(this.observer.message||this.observer.componentMessage||this.observer.contextChanged)),this.reactHarnesses,signal);
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
            await this.messages.append({ messageId: randomUUID(), message: { role: 'user', content: text, timestamp: Date.now() }, metadata:{...metadata,runtimeGenerated:true} });
            this.progress.changed(run.agentId);
          },
        };
        if (this.policy.beforeStep) await abortable(track(this.policy.beforeStep(scope)), signal);
        let request = await abortable(track(this.buildModelRequest(scope, this.context)), signal);
        if (config.compaction && estimateRequestTokens(request) > config.compaction.thresholdTokens) {
          try { await this.compact('before-model', scope, group, track, () => Promise.allSettled([...pendingEffects])); }
          catch (error) { preparationFailed = true; throw error; }
          request = await abortable(track(this.buildModelRequest(scope, this.context)), signal);
        }
        const {response, results, record} = await this.turn(scope, request, this.messages, track);
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
          const request = await this.buildModelRequest(scope, this.context);
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
      recordInput: async (text, metadata) => { signal.throwIfAborted(); await this.messages.append(compactionInput(text, metadata)); }};
  }

  private async compact(trigger: CompactionTrigger, ordinaryScope: StepScope, group: GroupContextReference | undefined,
    track: <T>(promise: Promise<T>) => Promise<T>, settle: () => Promise<unknown>): Promise<void> {
    if (ordinaryScope.signal.aborted) { if (trigger === 'after-run') return; ordinaryScope.signal.throwIfAborted(); }
    const settings = this.config.compaction!, original = structuredClone(this.context);
    const state: CompactionState = {id: randomUUID(), agentId: this.runState.agentId, runId: this.runState.runId,
      trigger, status: 'preparing', startedAt: Date.now(), endedAt: null, error: null};
    const draftModel = new AgentContextState(original), draft = draftModel.history;
    const messages = this.messages.prepare(state.id, trigger, draftModel);
    const trace = messages.trace, metadataChanges = messages.metadataChanges;
    const preparations: Array<ReactHarnessCompaction | undefined> = this.reactHarnesses.map(harness => harness.prepareCompaction?.());
    const compactionHarnesses = this.reactHarnesses.map((harness, index) => preparations[index]?.harness ?? harness);
    if (preparations.some(Boolean) && !this.observer.compactionFinished
      && (this.observer.message || this.observer.componentMessage || this.observer.contextChanged || this.observer.contextPatched)) {
      throw new AppError('invalid_config', 'Prepared React Harness state requires atomic compaction completion persistence');
    }
    await compactionAcknowledgement(() => this.observer.compactionStarted?.(structuredClone(state)));
    const finish = async (finished: CompactionState, revision: number, entries: ContextEntry[]) => {
      validateEntries(entries);
      if (this.observer.compactionFinished) {
        const result = await compactionAcknowledgement(() => this.observer.compactionFinished!(structuredClone(finished), revision, structuredClone(entries)));
        if (finished.status === 'completed') this.context = result ?? {revision: revision + 1, entries: structuredClone(entries)};
      } else if (finished.status === 'completed') {
        await compactionAcknowledgement(() => this.replaceContext(revision, entries));
      }
    };
    let committing = false;
    try {
      ordinaryScope.signal.throwIfAborted();
      await messages.append(compactionInput(`${settings.prompt}\n\nCheckpoint: ${trigger}. ${trigger === 'before-model' ? 'Ordinary work will resume in the same run after successful preparation.' : 'Ordinary work has stopped. Save continuation information and remain idle afterward; do not start more ordinary work.'}`, {compactionPrompt: true}));
      for (let step = 1; ; step++) {
        ordinaryScope.signal.throwIfAborted(); this.observer.assertActive?.();
        if (step > this.maxSteps) throw new AppError('compaction_limit', 'Maximum compaction model calls reached');
        const scope: StepScope = {...ordinaryScope, mode: 'compaction', step,
          readContext: async () => structuredClone(draft),
          replaceContext: async () => { throw new AppError('context_conflict', 'Preparation context is replaced only at the compaction boundary'); },
          recordInput: async (text, metadata) => { ordinaryScope.signal.throwIfAborted(); await messages.append(compactionInput(text, metadata)); }};
        const request = await abortable(track(this.buildModelRequest(scope, draft, messages, compactionHarnesses)), scope.signal);
        const {response} = await this.turn(scope, request, messages, track, compactionHarnesses);
        if (response.content.some(block => block.type === 'toolCall')) continue;
        if (response.stopReason === 'stop' && finalAnswer(response)) break;
        if (response.stopReason === 'stop' && response.content.some(block => block.type === 'text' && textPhase(block) === 'commentary')) continue;
        throw new AppError('invalid_compaction', 'Compaction must finish naturally with nonempty continuation text');
      }
      ordinaryScope.signal.throwIfAborted();
      const entries = await compactedContext(state.agentId, original, trace.slice(1), group);
      for (const entry of entries) {
        const update = metadataChanges.get(entry.messageId);
        if (update) {
          entry.metadata = {...structuredClone(update.metadata), ...(entry.metadata.contextUsageInvalidated === true ? {contextUsageInvalidated: true} : {})};
          metadataChanges.set(entry.messageId, {messageId: entry.messageId, metadata: structuredClone(entry.metadata)});
        }
      }
      const previousIds = new Set(original.entries.map(entry => entry.messageId));
      const messageCount = (original.messageCount ?? 0) + entries.filter(entry => !previousIds.has(entry.messageId)).reduce((count, entry) => count + countedMessage(entry), 0);
      const replacementContext = new AgentContextState({revision: original.revision, entries, messageCount});
      const prepared = preparations.flatMap(preparation => preparation ? [{preparation, replacement: preparation.replacement(replacementContext)}] : []);
      const componentStates: PreparedComponentState[] = prepared.map(item => item.replacement);
      const finished: CompactionState = {...state, status: 'completed', endedAt: Date.now(), contextMetadata: [...metadataChanges.values()], componentStates};
      committing = true;
      await finish(finished, original.revision, entries);
      for (const {preparation, replacement} of prepared) preparation.accept(replacement);
    } catch (error) {
      if (committing || (error instanceof AppError && error.code === 'compaction_persistence_failure')) throw error;
      await settle();
      const failure = {code: ordinaryScope.signal.aborted ? 'cancelled' : error instanceof AppError ? error.code : 'compaction_error', message: error instanceof Error ? error.message : 'Compaction failed'};
      await finish({...state, status: 'failed', endedAt: Date.now(), error: failure}, this.context.revision, this.context.entries);
      throw new AppError('compaction_failed', `Context preparation failed: ${failure.message}`);
    }
  }

  private async turn(scope: StepScope, request: ModelRequest, messages: AgentMessageData,
    track: <T>(promise: Promise<T>) => Promise<T>, harnesses = this.reactHarnesses): Promise<{response: AssistantMessage; results: ToolResultMessage[]; record: CompletedMessage}> {
    const run = this.runState, signal = scope.signal;
    const declared = request.tools.map(tool => tool.definition);
    const tools = new Map<string, ModelRequest['tools'][number]>();
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
    const record = await messages.append({ messageId, message: response, metadata: this.policy.messageMetadata?.(scope, response) ?? {} });
    if (scope.mode !== 'compaction') this.progress.settle(run.agentId, run.runId, messageId);
    if (scope.mode === 'compaction' && response.stopReason === 'length') throw new AppError('incomplete_compaction', 'Compaction output reached its token limit');
    const turn = new AgentTurnData(messages, record, message => this.policy.messageMetadata?.(scope, message) ?? {});
    const calls = turn.calls;
    const ensurePrior = async (call: typeof calls[number], deferCallIds: string[] = []): Promise<void> => {
      const deferred = new Set(deferCallIds);
      const index = calls.findIndex(candidate => candidate.id === call.id);
      if (index < 0) throw new AppError('invalid_tool_calls', `React Harness requested unknown tool call: ${call.id}`);
      for (let prior = 0; prior < index; prior++) {
        const pending = calls[prior]!;
        if (!turn.hasResult(pending.id) && !deferred.has(pending.id)) await executeOne(pending);
      }
    };
    const execute = async (call: typeof calls[number], entryMetadata: JsonObject = {}): Promise<ToolResultMessage> => {
      const existing = turn.result(call.id);
      if (existing) return structuredClone(existing);
      await ensurePrior(call);
      return executeOne(call, entryMetadata);
    };
    const executeOne = async (call: typeof calls[number], entryMetadata: JsonObject = {}): Promise<ToolResultMessage> => {
      const existing = turn.result(call.id);
      if (existing) return structuredClone(existing);
      signal.throwIfAborted();
      let result: ToolResultMessage;
      try {
        const definition = declared.find(tool => tool.name === call.name);
        const tool = tools.get(call.name);
        if (!definition || !tool) throw new AppError('unknown_tool', `Tool is unavailable: ${call.name}`);
        const args = validateToolArguments(definition, call) as JsonObject;
        if (!tool.execute) throw new AppError('react_harness_tool_only', `Tool must be executed by its React Harness: ${call.name}`);
        const output = await abortable(track(this.policy.executeTool ? this.policy.executeTool(tool as RuntimeTool, args, scope, call) : tool.execute(args, scope, call)), signal);
        result = {...output, role: 'toolResult', toolCallId: call.id, toolName: call.name, timestamp: Date.now()};
      } catch (error) {
        signal.throwIfAborted();
        this.observer.assertActive?.();
        result = {role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{type: 'text', text: error instanceof Error ? error.message : 'Tool failed'}], isError: true, timestamp: Date.now()};
      }
      signal.throwIfAborted();
      return turn.recordToolResult(call, result, entryMetadata);
    };
    const harnessContext: ReactHarnessContext = {
      scope, toolCalls: calls,
      execute: async (call, metadata = {}) => execute(call, metadata),
      beforeToolCall: (call, deferCallIds = []) => ensurePrior(call, deferCallIds),
      validateToolCall: call => {
        const definition = declared.find(tool => tool.name === call.name);
        if (!definition) throw new AppError('unknown_tool', `Tool is unavailable: ${call.name}`);
        return validateToolArguments(definition, call) as JsonObject;
      },
      data: turn,
    };
    // Purpose-owned reactions claim their calls before the Default fallback, regardless of registration order.
    for (const harness of harnesses) {
      if (!(harness instanceof DefaultReactHarness) && harness.canHandle(response)) await harness.handle(response, harnessContext);
    }
    const fallback = harnesses.find(harness => harness instanceof DefaultReactHarness) ?? new DefaultReactHarness();
    await fallback.handle(response, {...harnessContext, toolCalls: calls.filter(call => !turn.hasResult(call.id))});
    const results = turn.orderedResults();
    if (results.length !== calls.length) throw new AppError('invalid_tool_calls', 'React Harness did not produce a result for every tool call');
    await turn.flushInstructions();
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
