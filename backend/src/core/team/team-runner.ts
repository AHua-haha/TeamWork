import { TeamExecutionData } from './data/execution.js';
import type { PreparedChatImage } from './data/chat-images.js';
import { OperationQueue } from '../workspace/workspace-git.js';
import type { AgentRuntime } from '../agent/runtime.js';
import type { TeamService, TeamStore } from './data/members.js';
import { Changes } from '../changes.js';
import { chatText, userMentions, mentionLimit, type ChatStore, type ChatMessage, type ChatAcceptance } from './data/group-chat.js';
import { parseMemberResponse } from './member-response.js';
import { AppError, type RunState } from '../agent/data/model.js';

export type RunHost = Pick<AgentRuntime, 'start' | 'cancel' | 'finished' | 'getState' | 'prepareRun' | 'launch' | 'feedback' | 'clearProgress' | 'syncGroupContext'>;

/** Shared publication and independent member activations. Private calls and call chains do not exist here. */
export class TeamRunner {
  private readonly changes = new Changes();
  private readonly executionData=new TeamExecutionData();
  private closed = false;
  private readonly publications = new Set<Promise<unknown>>();
  private readonly gate = new OperationQueue();
  private readonly execution = new OperationQueue();
  constructor(private readonly team: TeamService, private readonly store: ChatStore & Pick<TeamStore, 'listMembers'>, private readonly runtime: () => RunHost, private readonly resetShells: (ids?: string[]) => Promise<void> = async () => {}) {}

  isRunning(memberId: string): boolean { return this.executionData.isRunning(memberId); }

  /** Admission remains atomic; only actual execution waits, including sender finalization. */
  async acquireExecution(memberId: string, signal: AbortSignal): Promise<() => void> {
    const workspaceId = this.executionData.activeRun(memberId)?.workspaceId ?? (await this.team.find(memberId))?.workspaceId;
    if (!workspaceId) return () => {};
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(new AppError('cancelled', 'Run cancelled before execution'));
      signal.addEventListener('abort', abort, { once: true });
      void this.execution.run(workspaceId, async () => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) { abort(); return; }
        return new Promise<void>(release => resolve(release));
      }).catch(reject);
      if (signal.aborted) abort();
    });
  }


  async startUser(agentId: string, input: Parameters<AgentRuntime['start']>[1]): Promise<RunState> {
    if (await this.team.find(agentId)) throw new AppError('member_conversation', 'Post workspace input to the shared team chat', 409);
    return this.runtime().start(agentId, input);
  }

  async postUser(workspaceId: string, value: unknown, images: PreparedChatImage[] = []) {
    const text = chatText(value, images.map(image => image.metadata));
    return this.workspaceOperation(workspaceId, () => this.acceptPublication(workspaceId, text, undefined, images));
  }

  async publishFinal(memberId: string, runId: string, value: unknown, finalMessageId: string): Promise<ChatMessage> {
    const member = await this.team.find(memberId);
    const active = this.executionData.activeRun(memberId);
    if (!member || member.value.retiredAt !== null || active?.runId !== runId) throw new AppError('member_unavailable', 'The sending member is no longer working', 409);
    const response = parseMemberResponse(chatText(value));
    const result = await this.publish(member.workspaceId, response.body, { memberId, name: member.value.name, runId, exchangeId: active.exchangeId, finalMessageId, names: response.names });
    return result.message;
  }

  private publish(workspaceId: string, text: string, sender?: { memberId: string; name: string; runId: string; exchangeId: string; finalMessageId: string; names: string[] }) {
    return this.workspaceOperation(workspaceId, () => this.acceptPublication(workspaceId, text, sender));
  }

  private async acceptPublication(workspaceId: string, text: string, sender?: { memberId: string; name: string; runId: string; exchangeId: string; finalMessageId: string; names: string[] }, images: PreparedChatImage[] = []) {
    const roster = await this.team.active(workspaceId);
    const names = sender ? sender.names : userMentions(text);
    const recipients = names.map(name => {
      const member = roster.find(item => item.value.name.toLowerCase() === name.toLowerCase());
      if (!member) throw new AppError('not_found', `No active member named "${name}"`, 404);
      if (member.id === sender?.memberId) throw new AppError('self_mention', 'A member cannot trigger itself; revise the response', 409);
      return member;
    });
    if (!sender && !names.length) {
      const lead = roster.find(item => item.value.lead);
      if (!lead) throw new AppError('not_found', 'Workspace lead not found', 404);
      recipients.push(lead);
    }
    const issues = await this.team.issues(recipients);
    for (const [index, member] of recipients.entries()) {
      if (issues[index]!.length) throw new AppError('member_unavailable', `${member.value.name} cannot run: ${issues[index]!.join('; ')}`, 409);
      if (this.isRunning(member.id)) throw new AppError('member_busy', `${member.value.name} is working; revise or try again when it is free`, 409);
    }
    const configs = await Promise.all(recipients.map(member => this.runtime().prepareRun(member.id)));
    if (images.length) for (const [index, config] of configs.entries()) {
      if (!config.model.input.includes('image')) throw new AppError('image_not_supported', `${recipients[index]!.value.name} uses a model without image input; select a vision-capable model`, 409);
    }
    // The store rechecks busy state and budget with publication and all run records in one transaction.
    const result = await this.store.publishChat({ workspaceId, text, ...(images.length ? { images } : {}), memberRevisions: Object.fromEntries(recipients.map((member, index) => [member.id, configs[index]!.source?.agentRevision ?? member.revision])), recipients: recipients.map(member => member.id), author: sender ? { type: 'member', memberId: sender.memberId, name: sender.name, runId: sender.runId } : { type: 'user' }, ...(sender ? { exchangeId: sender.exchangeId, finalMessageId: sender.finalMessageId } : {}) });
    if (sender) this.executionData.published(sender.memberId);
    for (const [index, run] of result.runs.entries()) {
      this.executionData.admitted(run.agentId,run.runId,result.message.exchangeId,workspaceId);
      this.runtime().launch(run, configs[index]!);
      const settled = () => {
        // A successor run may already have started after atomic final publication.
        this.executionData.settled(run.agentId,run.runId);
        this.changes.publish();
      };
      void this.runtime().finished(run.agentId, run.runId).then(settled, settled);
    }
    this.changes.publish();
    await Promise.all(roster.map(member => this.runtime().syncGroupContext(member.id)));
    return result;
  }

  workspaceOperation<T>(workspaceId: string, action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new AppError('runtime_unavailable', 'Team is shutting down', 503));
    const operation = this.gate.run(workspaceId, () => {
      if (this.closed) throw new AppError('runtime_unavailable', 'Team is shutting down', 503);
      return action();
    });
    this.publications.add(operation);
    void operation.finally(() => this.publications.delete(operation)).catch(() => undefined);
    return operation;
  }
  idleWorkspace<T>(workspaceId: string, action: () => Promise<T>, reason = 'All workspace members must finish before activating configuration'): Promise<T> {
    return this.workspaceOperation(workspaceId, async () => {
      if (this.executionData.workspaceBusy(workspaceId)) throw new AppError('workspace_busy', reason, 409);
      const result = await action(); this.changes.publish(); return result;
    });
  }

  async image(workspaceId: string, imageId: string) { return this.store.chatImage(workspaceId, imageId); }

  async snapshot(workspaceId: string, after = 0, limit = 100) { return this.store.chatSnapshot(workspaceId, after, limit); }
  async timeline(workspaceId: string, after = 0, limit = 100) { return this.store.chatTimeline(workspaceId, after, limit); }

  async *followTimeline(workspaceId: string, after = 0, signal?: AbortSignal) {
    let first = true;
    let settings: number | undefined;
    while (!signal?.aborted && !this.closed) {
      const version = this.changes.version;
      const snapshot = await this.timeline(workspaceId, after, 500);
      if (after < snapshot.resetCursor) {
        after = snapshot.resetCursor; first = true;
        yield { version: 1, type: 'reset', workspaceId, cursor: after };
      }
      for (const change of snapshot.changes) {
        after = change.cursor;
        yield { version: 1, type: 'entry', workspaceId, change };
      }
      if (snapshot.more) continue;
      if (first) { first = false; yield { version: 1, type: 'sync', workspaceId, cursor: after }; }
      if (settings !== snapshot.mentionLimit) {
        settings = snapshot.mentionLimit;
        yield { version: 1, type: 'settings', workspaceId, mentionLimit: settings };
      }
      await this.changes.wait(version, signal);
    }
  }

  async configure(workspaceId: string, value: unknown) {
    await this.store.configureChat(workspaceId, mentionLimit(value));
    this.changes.publish();
    return this.snapshot(workspaceId);
  }

  async *follow(workspaceId: string, after = 0, signal?: AbortSignal) {
    let first = true;
    let state = '';
    while (!signal?.aborted && !this.closed) {
      const version = this.changes.version;
      const snapshot = await this.snapshot(workspaceId, after, 500);
      if (after < snapshot.resetPosition) {
        after = snapshot.resetPosition; first = true;
        yield { version: 1, type: 'reset', workspaceId, position: after };
      }
      for (const message of snapshot.messages) {
        after = message.position;
        yield { version: 1, type: 'message', workspaceId, message };
      }
      if (snapshot.more) continue;
      if (first) { first = false; yield { version: 1, type: 'sync', workspaceId, position: after }; }
      const current = JSON.stringify({ mentionLimit: snapshot.mentionLimit, runs: snapshot.runs });
      if (current !== state) {
        state = current;
        yield { version: 1, type: 'state', workspaceId, mentionLimit: snapshot.mentionLimit, runs: snapshot.runs };
      }
      await this.changes.wait(version, signal);
    }
  }

  reset(workspaceId: string) {
    return this.idleWorkspace(workspaceId, async () => {
      const members = await this.store.listMembers(workspaceId);
      await this.resetShells(members.map(member => member.id));
      const result = await this.store.resetChat(workspaceId);
      for (const member of members) this.runtime().clearProgress(member.id);
      return result;
    }, 'Stop team work and wait for every member to finish before resetting the chat');
  }

  async stop(workspaceId: string): Promise<void> {
    const runs = await this.store.stopChat(workspaceId);
    const work = new Map(runs.map(run => [run.runId, run.agentId]));
    for (const job of this.executionData.workspaceJobs(workspaceId)) work.set(job.runId,job.agentId);
    await Promise.all([...work].map(([runId, agentId]) => this.runtime().cancel(agentId, runId)));
    this.changes.publish();
  }

  async retire(workspaceId: string, memberId: string, revision: number) {
    const member = await this.team.retire(workspaceId, memberId, revision);
    const { run } = await this.runtime().getState(memberId);
    if (run?.status === 'running') await this.runtime().cancel(memberId, run.runId);
    await this.resetShells([memberId]);
    this.changes.publish();
    return member;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.publications);
    await this.resetShells();
    this.changes.publish();
  }
}
