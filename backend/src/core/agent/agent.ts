import { AgentState, AgentContextState } from './data/state.js';
import { compactedContext, compactionInput, estimateRequestTokens, interruptedCompactionContext, validateCompactionSettings, type CompactionState, type CompactionTrigger } from './data/compaction.js';
import { finalAnswer, textPhase } from './final-answer.js';
import { AgentMessageContext, type GroupContextReference } from './data/context.js';
import { randomUUID } from 'node:crypto';
import { AssistantMessageFrameEncoder, validateToolArguments, type Api, type AssistantMessage, type Model, type Models, type SimpleStreamOptions, type ToolResultMessage, type JsonObject, type Message } from '@earendil-works/pi-ai';
import { validateEntries } from './data/validation.js';
import { ProgressStore } from './data/progress.js';
import { AppError, type CompletedMessage, type ContextEntry, type ContextHistory, type ContextPatch, type ReactHarnessMessageEffects, type ContextMetadataUpdate, type RunState } from './data/model.js';
import type { ModelStream, ModelRequest, AgentConfiguration, RuntimePolicy, RuntimeTool, StepScope, ReactHarness, ReactHarnessContext } from './contracts.js';
import { DefaultReactHarness } from './react-harness.js';
export { DefaultReactHarness } from './react-harness.js';
export type * from './contracts.js';

/** Optional caller acknowledgements. No database, record codec or hosting dependency is required. */
export interface AgentObserver {
  assertActive?(): void;
  messageStart?(state: RunState, historyPosition: number): Promise<number | void>;
  message?(record: CompletedMessage): Promise<CompletedMessage | void>;
  reactHarnessMessage?(record: CompletedMessage, effects: ReactHarnessMessageEffects): Promise<CompletedMessage>;
  contextChanged?(revision: number, entries: ContextEntry[]): Promise<ContextHistory | void>;
  contextPatched?(revision: number, patch: ContextPatch): Promise<void>;
  compactionStarted?(state: CompactionState): Promise<void>;
  compactionMessage?(record: CompletedMessage): Promise<CompletedMessage | void>;
  compactionFinished?(state: CompactionState, revision: number, entries: ContextEntry[]): Promise<ContextHistory | void>;
  finished?(state: RunState): Promise<RunState | void>;
}
function projectContextEntry(entry: ContextEntry): ContextEntry {
  const message = structuredClone(entry.message);
  if (entry.metadata.modelContextHidden === true && message.role === 'toolResult') {
    message.content = [{type:'text',text:'[File view omitted; a newer aggregate is available.]'}];
  }
  if (message.role === 'assistant' && Array.isArray(message.content) && Array.isArray(entry.metadata.suppressedToolCallArguments)) {
    const suppressed = new Set(entry.metadata.suppressedToolCallArguments.filter((id): id is string => typeof id === 'string'));
    message.content = message.content.map(part => part.type === 'toolCall' && suppressed.has(part.id)
      ? {...part,arguments:{...part.arguments,content:'[Written successfully; content omitted from future context.]'}} : part);
  }
  return {...entry,message};
}

export class AgentExecution {
  private readonly state:AgentState;
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
    this.reactHarnesses = reactHarnesses ?? policy.createReactHarnesses?.(run.agentId) ?? [];
    if (config.compaction) validateCompactionSettings(config.compaction);
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new AppError('invalid_config', 'Invalid model call limit');
  }
  snapshot(){return this.state.snapshot();}
  restoreContext(context:ContextHistory):void{this.state.acceptContext(context);}
  attachContext(context:AgentContextState):void{this.state.attachContext(context);}
  receive(record:CompletedMessage):void{this.state.receive(record);}
  private async record(entry: ContextEntry, effects?: ReactHarnessMessageEffects): Promise<CompletedMessage> {
    validateEntries([entry]);
    const proposed = { ...entry, agentId: this.runState.agentId, runId: this.runState.runId, position: this.historyPosition + 1 };
    if (effects && this.observer.message && !this.observer.reactHarnessMessage) throw new AppError('invalid_config', 'Durable harness results require atomic persistence');
    const record = (effects ? await this.observer.reactHarnessMessage?.(structuredClone(proposed), effects) : await this.observer.message?.(structuredClone(proposed))) ?? proposed;
    this.receive(record);
    if (effects) this.state.contextModel.updateMetadata(effects.metadataUpdates);
    return structuredClone(record);
  }
  private async patchContext(patch: ContextPatch): Promise<void> {
    const revision = this.context.revision;
    if (this.observer.contextPatched) {
      await this.observer.contextPatched(revision, patch);
      this.state.patchContext(revision + 1, patch);
    } else if (this.observer.contextChanged) {
      const next = new AgentContextState(this.context);
      next.patch(revision + 1, patch);
      await this.replaceContext(revision, next.history.entries);
    } else this.state.patchContext(revision + 1, patch);
  }
  private async buildModelRequest(scope: StepScope, history: ContextHistory): Promise<ModelRequest> {
    const projected = {revision: history.revision, entries: history.entries.map(projectContextEntry)};
    const request = await this.policy.buildRequest(scope, projected);
    for (const harness of this.reactHarnesses) harness.restoreContext?.(history);
    const owned = this.reactHarnesses.flatMap(harness => harness.tools?.(scope) ?? []);
    const overridden = new Set(this.reactHarnesses.flatMap(harness => harness.overrideToolNames?.(scope) ?? []));
    const prompts = (await Promise.all(this.reactHarnesses.map(harness => harness.systemPrompt?.(scope)))).map(prompt => prompt?.trim()).filter((prompt): prompt is string => !!prompt);
    if (!owned.length && !overridden.size && !prompts.length) return request;
    const ownedNames = new Set(owned.map(tool => tool.definition.name));
    const tools = [...request.tools.filter(tool => !overridden.has(tool.definition.name) && !ownedNames.has(tool.definition.name)), ...owned];
    const definitions = tools.map(tool => tool.definition);
    request.tools = tools;
    request.context = {...request.context, tools: definitions,
      ...(prompts.length ? {systemPrompt: [request.context.systemPrompt, ...prompts].filter(Boolean).join('\n\n')} : {})};
    return request;
  }

  private async updateContextMetadata(updates: Array<{messageId: string; metadata: JsonObject}>): Promise<void> {
    if (!updates.length) return;
    const ids = new Set<string>();
    for (const item of updates) {
      if (!item.messageId || ids.has(item.messageId)) throw new AppError('invalid_context_update', 'Context metadata updates require unique message identities');
      ids.add(item.messageId);
      if (!this.state.contextModel.entry(item.messageId)) throw new AppError('invalid_context_update', `Context entry not found: ${item.messageId}`);
    }
    await this.patchContext({append: [], update: [], metadata: updates});
  }

  private async appendHint(message: Message, metadata: JsonObject = {}): Promise<void> {
    await this.record({messageId: randomUUID(), message: structuredClone(message), metadata: structuredClone(metadata)});
    this.progress.changed(this.runState.agentId);
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
      const change = await new AgentMessageContext(run.agentId, this.context).changes(group);
      if (!change) return;
      if ('replace' in change) await this.replaceContext(this.context.revision, change.replace);
      else await this.patchContext(change.patch);
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
        let request = await abortable(track(this.buildModelRequest(scope, structuredClone(this.context))), signal);
        if (config.compaction && estimateRequestTokens(request) > config.compaction.thresholdTokens) {
          try { await this.compact('before-model', scope, group, track, () => Promise.allSettled([...pendingEffects])); }
          catch (error) { preparationFailed = true; throw error; }
          request = await abortable(track(this.buildModelRequest(scope, structuredClone(this.context))), signal);
        }
        const {response, results, record} = await this.turn(scope, request, (entry, effects) => this.record(entry, effects), track);
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
          const request = await this.buildModelRequest(scope, structuredClone(this.context));
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
    const metadataChanges = new Map<string, ContextMetadataUpdate>();
    const trace: ContextEntry[] = [], traceById = new Map<string, ContextEntry>();
    const draftModel = new AgentContextState(original), draft = draftModel.history;
    await compactionAcknowledgement(() => this.observer.compactionStarted?.(structuredClone(state)));
    const record = async (entry: ContextEntry, effects?: ReactHarnessMessageEffects): Promise<CompletedMessage> => {
      const value = {...structuredClone(entry), metadata: {...entry.metadata, source: 'context-compaction', compactionId: state.id, trigger}};
      const proposed = {...value, agentId: state.agentId, runId: state.runId, position: this.historyPosition + 1};
      if (effects && this.observer.compactionMessage && !this.observer.reactHarnessMessage) throw new AppError('invalid_config', 'Durable harness results require atomic persistence');
      const saved = await compactionAcknowledgement(() => effects ? this.observer.reactHarnessMessage?.(structuredClone(proposed), effects) : this.observer.compactionMessage?.(structuredClone(proposed))) ?? proposed;
      const retained = {messageId: saved.messageId, message: saved.message, metadata: saved.metadata};
      trace.push(retained); traceById.set(retained.messageId, retained);
      draftModel.append(retained);
      if (effects) {
        draftModel.updateMetadata(effects.metadataUpdates);
        for (const update of effects.metadataUpdates) {
          metadataChanges.set(update.messageId, update);
          const existing = traceById.get(update.messageId);
          if (existing) existing.metadata = structuredClone(update.metadata);
        }
      }
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
        const request = await abortable(track(this.buildModelRequest(scope, draft)), scope.signal);
        const {response} = await this.turn(scope, request, record, track, draftModel);
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
      for (const entry of entries) { const update = metadataChanges.get(entry.messageId); if (update) entry.metadata = structuredClone(update.metadata); }
      await finish({...state, status: 'failed', endedAt: Date.now(), error: failure}, this.context.revision, entries);
      throw new AppError('compaction_failed', `Context preparation failed: ${failure.message}`);
    }
  }

  private async turn(scope: StepScope, request: ModelRequest, recordMessage: (entry: ContextEntry, effects?: ReactHarnessMessageEffects) => Promise<CompletedMessage>,
    track: <T>(promise: Promise<T>) => Promise<T>, contextModel = this.state.contextModel): Promise<{response: AssistantMessage; results: ToolResultMessage[]; record: CompletedMessage}> {
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
    const record = await recordMessage({ messageId, message: response, metadata: this.policy.messageMetadata?.(scope, response) ?? {} });
    if (scope.mode !== 'compaction') this.progress.settle(run.agentId, run.runId, messageId);
    if (scope.mode === 'compaction' && response.stopReason === 'length') throw new AppError('incomplete_compaction', 'Compaction output reached its token limit');
    const calls = response.content.filter(part => part.type === 'toolCall');
    if (new Set(calls.map(call => call.id)).size !== calls.length) throw new AppError('invalid_tool_calls', 'Duplicate tool-call identity');
    const executed = new Map<string, ToolResultMessage>();
    const hints: Array<{message: Message; metadata?: JsonObject}> = [];
    const ensurePrior = async (call: typeof calls[number], deferCallIds: string[] = []): Promise<void> => {
      const deferred = new Set(deferCallIds);
      const index = calls.findIndex(candidate => candidate.id === call.id);
      if (index < 0) throw new AppError('invalid_tool_calls', `React Harness requested unknown tool call: ${call.id}`);
      for (let prior = 0; prior < index; prior++) {
        const pending = calls[prior]!;
        if (!executed.has(pending.id) && !deferred.has(pending.id)) await executeOne(pending);
      }
    };
    const execute = async (call: typeof calls[number], entryMetadata: JsonObject = {}): Promise<ToolResultMessage> => {
      const existing = executed.get(call.id);
      if (existing) return structuredClone(existing);
      await ensurePrior(call);
      return executeOne(call, entryMetadata);
    };
    const executeOne = async (call: typeof calls[number], entryMetadata: JsonObject = {}): Promise<ToolResultMessage> => {
      const existing = executed.get(call.id);
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
      await recordMessage({messageId: randomUUID(), message: result, metadata: {...(this.policy.messageMetadata?.(scope, result) ?? {}), ...entryMetadata}});
      if (scope.mode !== 'compaction') this.progress.changed(run.agentId);
      executed.set(call.id, result);
      return structuredClone(result);
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
      contextEntry: id => { const entry = contextModel.entry(id); return entry ? structuredClone(entry) : undefined; },
      recordToolResult: async (call, output, metadata = {}, commit) => {
        const known = calls.find(candidate => candidate.id === call.id);
        if (!known || known.name !== call.name) throw new AppError('invalid_tool_calls', `React Harness requested unknown tool call: ${call.id}`);
        signal.throwIfAborted();
        const result: ToolResultMessage = {...output, role:'toolResult', toolCallId:call.id, toolName:call.name, timestamp:Date.now()};
        let effects: ReactHarnessMessageEffects | undefined;
        if (commit) {
          const updates: ContextMetadataUpdate[] = [];
          const previous = commit.hideMessageId ? contextModel.entry(commit.hideMessageId) : undefined;
          if (previous) updates.push({messageId: previous.messageId, metadata: {...previous.metadata, modelContextHidden: true}});
          if (commit.suppressArguments) {
            const assistant = contextModel.entry(record.messageId);
            if (!assistant) throw new AppError('invalid_context_update', 'Assistant response context entry is unavailable');
            const previousIds = Array.isArray(assistant.metadata.suppressedToolCallArguments) ? assistant.metadata.suppressedToolCallArguments as string[] : [];
            updates.push({messageId: assistant.messageId, metadata: {...assistant.metadata, suppressedToolCallArguments: [...new Set([...previousIds, call.id])]}});
          }
          effects = {harnessId: commit.harnessId, revision: commit.revision, data: commit.data, metadataUpdates: updates};
        }
        await recordMessage({messageId:commit?.messageId ?? randomUUID(),message:result,metadata:{...(this.policy.messageMetadata?.(scope,result)??{}),...metadata}}, effects);
        executed.set(call.id,result);
        if(scope.mode!=='compaction')this.progress.changed(run.agentId);
        return structuredClone(result);
      },
      appendHint: async (message, metadata = {}) => { hints.push({message: structuredClone(message), metadata: structuredClone(metadata)}); },
      updateMetadata: updates => this.updateContextMetadata(updates),
      suppressToolCallArguments: async callIds => {
        if (!callIds.length) return;
        const entry = contextModel.entry(record.messageId);
        if (!entry) throw new AppError('invalid_context_update', 'Assistant response context entry is unavailable');
        const existingIds = Array.isArray(entry.metadata.suppressedToolCallArguments) ? entry.metadata.suppressedToolCallArguments.filter((id): id is string => typeof id === 'string') : [];
        await this.updateContextMetadata([{messageId: entry.messageId, metadata: {...entry.metadata, suppressedToolCallArguments: [...new Set([...existingIds, ...callIds])]}}]);
      },
    };
    // Purpose-owned reactions claim their calls before the Default fallback, regardless of registration order.
    for (const harness of this.reactHarnesses) {
      if (!(harness instanceof DefaultReactHarness) && harness.canHandle(response)) await harness.handle(response, harnessContext);
    }
    const fallback = this.reactHarnesses.find(harness => harness instanceof DefaultReactHarness) ?? new DefaultReactHarness();
    await fallback.handle(response, {...harnessContext, toolCalls: calls.filter(call => !executed.has(call.id))});
    const results = calls.flatMap(call => executed.has(call.id) ? [structuredClone(executed.get(call.id)!)] : []);
    if (results.length !== calls.length) throw new AppError('invalid_tool_calls', 'React Harness did not produce a result for every tool call');
    for (const hint of hints) await this.appendHint(hint.message, hint.metadata);
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
