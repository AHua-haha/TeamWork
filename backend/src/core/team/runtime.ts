import type { ResolvedRunConfig, RunConfigSource } from './config.js';
export type { ResolvedRunConfig, RunConfigSource } from './config.js';
import { randomUUID } from 'node:crypto';
import { type UserMessage } from '@earendil-works/pi-ai';
import { TeamData } from './data.js';
import { encode, validateMessage } from '../codec.js';
import { ProgressStore } from '../agent/progress.js';
import { AppError, type ContextEntry, type ContextHistory, type CurrentState, type FollowEvent, type FollowSnapshot, type RunState } from '../agent/types.js';

export { configuredPolicy, fixedPolicy, piModelStream } from '../agent/agent.js';
export type * from '../agent/contracts.js';
import { AgentMessageContext } from '../agent/context.js';
import { AgentExecution } from '../agent/agent.js';
import type { RuntimePolicy, ModelStream } from '../agent/contracts.js';

interface Job { execution?: AgentExecution; agentId: string; controller: AbortController; done: Promise<void> }

export class TeamRuntime {
  readonly progress: ProgressStore;
  private readonly completionReads = new Map<string, Promise<RunState>>();
  private readonly jobs = new Map<string, Job>();
  private readonly finalizationFailures = new Map<string, unknown>();
  private accepting = false;
  private readonly contextUpdates = new Map<string, Promise<void>>();
  private readonly contextFailures = new Map<string, unknown>();
  private readonly maxSteps: number;
  private pendingStarts = new Set<Promise<RunState>>();

  constructor(readonly store: TeamData, private readonly config: RunConfigSource, private readonly policy: RuntimePolicy, private readonly stream: ModelStream, options: { progressCapacity?: number; maxSteps?: number } = {}) {
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
    await Promise.allSettled(this.contextUpdates.values());
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
    const done = Promise.resolve().then(() => this.runLoop(run, config, controller.signal)).finally(async () => {
      this.jobs.delete(run.runId);
      // Close the notification race between the last busy read and becoming idle.
      await this.syncGroupContext(run.agentId);
    });
    this.jobs.set(run.runId, { agentId: run.agentId, controller, done });
    this.progress.changed(run.agentId);
  }

  /** Refused final publications are private input to the same model/tool loop. */
  async feedback(agentId: string, runId: string, text: string): Promise<void> {
    const record = await this.store.commitMessage(agentId, runId, { messageId: randomUUID(), message: { role: 'user', content: text, timestamp: Date.now() }, metadata: { source: 'publication-feedback' } });
    this.jobs.get(runId)?.execution?.receive(record);
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

  clearProgress(agentId: string): void { this.progress.clear(agentId); this.contextFailures.delete(agentId); }

  async getState(agentId: string): Promise<CurrentState> {
    this.available();
    if (this.contextFailures.has(agentId)) throw new AppError('persistence_failure', 'Group context synchronization failed; retry or trigger the member to restore its context', 503);
    const state = await this.store.getState(agentId);
    this.checkFinalization(state.run?.runId);
    return state;
  }

  async replaceContext(agentId: string, revision: number, entries: ContextEntry[]): Promise<ContextHistory> {
    this.available();
    const result = await this.store.replaceContext(agentId, revision, entries);
    for (const job of this.jobs.values()) if (job.agentId === agentId) job.execution?.restoreContext(result);
    this.progress.changed(agentId);
    return result;
  }

  /** Idle delivery uses Agent's context owner, never a Team-selected range. Busy executions catch up themselves. */
  async syncGroupContext(agentId: string): Promise<void> {
    const previous = this.contextUpdates.get(agentId) ?? Promise.resolve();
    const update = previous.then(async () => {
      if (!this.accepting || [...this.jobs.values()].some(job => job.agentId === agentId)) return;
      const reference = await this.policy.groupContext?.(agentId);
      if (!reference) return;
      const history = await this.store.getContext(agentId);
      const entries = await new AgentMessageContext(agentId, history).incoming(reference);
      if (entries) await this.store.replaceContext(agentId, history.revision, entries);
      this.contextFailures.delete(agentId);
    }).catch(error => { this.contextFailures.set(agentId, error); });
    this.contextUpdates.set(agentId, update);
    try { await update; }
    finally { if (this.contextUpdates.get(agentId) === update) this.contextUpdates.delete(agentId); }
  }

  private checkFinalization(runId?: string): void {
    if (runId && this.finalizationFailures.has(runId)) throw new AppError('persistence_failure', 'Run stopped but terminal state could not be persisted; restart runtime after database recovery', 503);
  }

  private async runLoop(run: RunState, config: ResolvedRunConfig, signal: AbortSignal): Promise<void> {
    try {
      let execution: AgentExecution;
      const policy: RuntimePolicy = {
        ...this.policy,
        acquireRun: async (state, activeSignal) => {
          const release = await this.policy.acquireRun?.(state, activeSignal);
          try {
            await this.contextUpdates.get(run.agentId);
            execution.restoreContext(await this.store.getContext(run.agentId));
            this.contextFailures.delete(run.agentId);
            return release ?? (() => {});
          } catch (error) { release?.(); throw error; }
        },
      };
      execution = new AgentExecution(run, { revision: 0, entries: [] }, 0, config, policy, this.stream, {
        assertActive: () => this.store.assertRuntime(),
        messageStart: state => this.store.beginMessage(state.agentId, state.runId, state.activeMessageId!, state.step),
        message: record => this.store.commitMessage(record.agentId, record.runId, { messageId: record.messageId, message: record.message, metadata: record.metadata }),
        contextChanged: (revision, entries) => this.replaceContext(run.agentId, revision, entries),
        finished: state => this.store.finishRun(state.agentId, state.runId, state.status as Exclude<RunState['status'], 'running'>, state.error),
      }, this.progress, this.maxSteps);
      const job = this.jobs.get(run.runId); if (job) job.execution = execution;
      await execution.run(signal);
    } catch (error) { this.finalizationFailures.set(run.runId, error); }
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
