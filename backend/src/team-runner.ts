import { HarnessQueue } from './harness-history.js';
import type { AgentRuntime } from './runtime.js';
import type { TeamService } from './team.js';
import { Changes } from './changes.js';
import { chatText, userMentions, mentionLimit, type ChatStore, type ChatMessage, type ChatAcceptance } from './group-chat.js';
import { parseMemberResponse } from './member-response.js';
import { AppError, type RunState } from './types.js';

export type RunHost = Pick<AgentRuntime, 'start' | 'cancel' | 'finished' | 'getState' | 'prepareRun' | 'launch' | 'feedback'>;

/** Shared publication and independent member activations. Private calls and call chains do not exist here. */
export class TeamRunner {
  private readonly changes = new Changes();
  private readonly active = new Map<string, { runId: string; exchangeId: string; workspaceId: string }>();
  private closed = false;
  private readonly publications = new Set<Promise<unknown>>();
  private readonly gate = new HarnessQueue();
  private readonly jobs = new Map<string, string>();
  constructor(private readonly team: TeamService, private readonly store: ChatStore, private readonly runtime: () => RunHost) {}

  isRunning(memberId: string): boolean { return this.active.has(memberId); }

  async startUser(agentId: string, input: Parameters<AgentRuntime['start']>[1]): Promise<RunState> {
    if (await this.team.find(agentId)) throw new AppError('member_conversation', 'Post workspace input to the shared team chat', 409);
    return this.runtime().start(agentId, input);
  }

  async postUser(workspaceId: string, value: unknown) {
    return this.publish(workspaceId, chatText(value));
  }

  async publishFinal(memberId: string, runId: string, value: unknown, finalMessageId: string): Promise<ChatMessage> {
    const member = await this.team.find(memberId);
    const active = this.active.get(memberId);
    if (!member || member.value.retiredAt !== null || active?.runId !== runId) throw new AppError('member_unavailable', 'The sending member is no longer working', 409);
    const response = parseMemberResponse(chatText(value));
    const result = await this.publish(member.workspaceId, response.body, { memberId, name: member.value.name, runId, exchangeId: active.exchangeId, finalMessageId, names: response.names });
    return result.message;
  }

  private publish(workspaceId: string, text: string, sender?: { memberId: string; name: string; runId: string; exchangeId: string; finalMessageId: string; names: string[] }) {
    return this.workspaceOperation(workspaceId, () => this.acceptPublication(workspaceId, text, sender));
  }

  private async acceptPublication(workspaceId: string, text: string, sender?: { memberId: string; name: string; runId: string; exchangeId: string; finalMessageId: string; names: string[] }) {
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
    // The store rechecks busy state and budget with publication and all run records in one transaction.
    const result = await this.store.publishChat({ workspaceId, text, memberRevisions: Object.fromEntries(recipients.map((member, index) => [member.id, configs[index]!.source?.agentRevision ?? member.revision])), recipients: recipients.map(member => member.id), author: sender ? { type: 'member', memberId: sender.memberId, name: sender.name, runId: sender.runId } : { type: 'user' }, ...(sender ? { exchangeId: sender.exchangeId, finalMessageId: sender.finalMessageId } : {}) });
    if (sender) this.active.delete(sender.memberId);
    for (const [index, run] of result.runs.entries()) {
      this.active.set(run.agentId, { runId: run.runId, exchangeId: result.message.exchangeId, workspaceId });
      this.runtime().launch(run, configs[index]!);
      this.jobs.set(run.runId, workspaceId);
      void this.runtime().finished(run.agentId, run.runId).catch(() => undefined).finally(() => {
        // A successor run may already have started after atomic final publication.
        if (this.active.get(run.agentId)?.runId === run.runId) this.active.delete(run.agentId);
        this.jobs.delete(run.runId);
        this.changes.publish();
      });
    }
    this.changes.publish();
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
  idleWorkspace<T>(workspaceId: string, action: () => Promise<T>): Promise<T> {
    return this.workspaceOperation(workspaceId, async () => {
      if ([...this.jobs.values()].includes(workspaceId) || [...this.active.values()].some(run => run.workspaceId === workspaceId)) throw new AppError('workspace_busy', 'All workspace members must finish before activating configuration', 409);
      const result = await action(); this.changes.publish(); return result;
    });
  }

  async snapshot(workspaceId: string, after = 0, limit = 100) { return this.store.chatSnapshot(workspaceId, after, limit); }
  async timeline(workspaceId: string, after = 0, limit = 100) { return this.store.chatTimeline(workspaceId, after, limit); }

  async *followTimeline(workspaceId: string, after = 0, signal?: AbortSignal) {
    let first = true;
    let settings: number | undefined;
    while (!signal?.aborted && !this.closed) {
      const version = this.changes.version;
      const snapshot = await this.timeline(workspaceId, after, 500);
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

  async stop(workspaceId: string): Promise<void> {
    const runs = await this.store.stopChat(workspaceId);
    await Promise.all(runs.map(run => this.runtime().cancel(run.agentId, run.runId)));
    this.changes.publish();
  }

  async retire(workspaceId: string, memberId: string, revision: number) {
    const member = await this.team.retire(workspaceId, memberId, revision);
    const { run } = await this.runtime().getState(memberId);
    if (run?.status === 'running') await this.runtime().cancel(memberId, run.runId);
    this.changes.publish();
    return member;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.publications);
    this.changes.publish();
  }
}
