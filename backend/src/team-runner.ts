import type { AgentRuntime } from './runtime.js';
import type { StoredMember, TeamService } from './team.js';
import { AppError, type RunState } from './types.js';

/** A chain of calls has at most this many members, the lead included. */
export const maxChainMembers = 5;
export const maxMessageCharacters = 20_000;
export const maxResponseCharacters = 20_000;

/** The part of the runtime that the run part of the team uses. */
export type RunHost = Pick<AgentRuntime, 'start' | 'cancel' | 'finished' | 'finalText' | 'getState'>;

/**
 * The run part of the team. A call from one member to another is a blocking tool call: the recipient runs in its own
 * conversation, the caller waits, and only the recipient's final response comes back. Calls form one chain per run
 * the user started; no member is in a chain twice, and the lead starts every chain, so calls cannot loop.
 */
export class TeamRunner {
  /** The members in each active run's chain, by run ID. */
  private readonly chains = new Map<string, string[]>();
  private readonly running = new Set<string>();

  constructor(private readonly team: TeamService, private readonly runtime: () => RunHost) {}

  /** Whether the member has a run in progress. */
  isRunning(memberId: string): boolean {
    return this.running.has(memberId);
  }

  /** Input from the user to a conversation. Only the lead of a team takes it; any other agent is not the team's concern. */
  async startUser(agentId: string, input: Parameters<AgentRuntime['start']>[1]): Promise<RunState> {
    const member = await this.team.find(agentId);
    if (!member) return this.runtime().start(agentId, input);
    if (!member.value.lead || member.value.retiredAt !== null) throw new AppError('member_conversation', 'The user talks to the lead; the lead gets work done through the other members', 409);
    return this.launch(member, input, [member.id]);
  }

  /** One member asks another and gets its final response. A call that cannot happen is refused with a reason the caller can act on. */
  async call(callerId: string, runId: string, signal: AbortSignal, toName: string, text: string): Promise<string> {
    const caller = await this.team.find(callerId);
    if (!caller || caller.value.retiredAt !== null) throw new AppError('not_found', 'Only active team members call others', 404);
    if (typeof text !== 'string' || !text.trim() || text.length > maxMessageCharacters) throw new AppError('invalid_input', `A message has 1–${maxMessageCharacters} characters`);
    const recipient = await this.team.byName(caller.workspaceId, toName);
    if (!recipient) {
      const names = (await this.team.active(caller.workspaceId)).map(member => member.value.name).join(', ');
      throw new AppError('not_found', `No member named "${toName}". The team: ${names}`, 404);
    }
    const name = recipient.value.name;
    const chain = this.chains.get(runId) ?? [callerId];
    if (chain.includes(recipient.id)) {
      throw new AppError('member_in_chain', `${name} is already part of this chain of calls (${await this.names(chain)}) and cannot be called. End your run with your question or result as your final response.`, 409);
    }
    if (chain.length >= maxChainMembers) throw new AppError('chain_full', `A chain of calls has at most ${maxChainMembers} members. Do the work yourself, or end your run with what is left.`, 409);
    const [issues] = await this.team.issues([recipient]);
    if (issues!.length) throw new AppError('member_unavailable', `${name} cannot run yet: ${issues!.join('; ')}`, 409);

    let run: RunState;
    try { run = await this.launch(recipient, `Message from ${caller.value.name}:\n\n${text}`, [...chain, recipient.id]); }
    catch (error) {
      if (error instanceof AppError && error.code === 'agent_busy') throw new AppError('member_busy', `${name} is already working`, 409);
      throw error;
    }
    // Stopping the caller stops the recipient, and so on down the chain, because each recipient's own calls are wired the same way.
    const cancel = () => { void this.runtime().cancel(recipient.id, run.runId).catch(() => undefined); };
    if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
    try { return await this.response(recipient, await this.runtime().finished(recipient.id, run.runId)); }
    finally { signal.removeEventListener('abort', cancel); }
  }

  /** Retires a member and cancels its active run, which ends any call waiting for it. What it wrote stays. */
  async retire(workspaceId: string, memberId: string, revision: number): Promise<StoredMember> {
    const member = await this.team.retire(workspaceId, memberId, revision);
    const { run } = await this.runtime().getState(memberId);
    if (run?.status === 'running') await this.runtime().cancel(memberId, run.runId);
    return member;
  }

  close(): void {
    this.chains.clear();
    this.running.clear();
  }

  private async launch(member: StoredMember, input: Parameters<AgentRuntime['start']>[1], chain: string[]): Promise<RunState> {
    const run = await this.runtime().start(member.id, input);
    this.chains.set(run.runId, chain);
    this.running.add(member.id);
    void this.runtime().finished(member.id, run.runId).catch(() => undefined).finally(() => {
      this.chains.delete(run.runId);
      this.running.delete(member.id);
    });
    return run;
  }

  private async names(chain: string[]): Promise<string> {
    const members = await Promise.all(chain.map(id => this.team.find(id)));
    return members.map(member => member?.value.name ?? 'unknown').join(' → ');
  }

  /** What the caller gets back: the final response, or a sentence saying how the run ended. */
  private async response(recipient: StoredMember, run: RunState): Promise<string> {
    const name = recipient.value.name;
    if (run.status === 'cancelled') return `${name} was cancelled.`;
    if (run.status === 'interrupted') return `${name} was interrupted.`;
    if (run.status !== 'completed') return `${name} failed: ${run.error?.message ?? 'unknown error'}`;
    const text = await this.runtime().finalText(recipient.id, run.runId);
    if (!text) return `${name} finished without a response.`;
    return text.length > maxResponseCharacters ? `${text.slice(0, maxResponseCharacters)}\n\n[The response was cut at ${maxResponseCharacters} characters.]` : text;
  }
}
