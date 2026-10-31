import type { ContextPageInput } from '../context-page.js';
import type { RunConfigSource } from './data/config.js';
import { mkdir,writeFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { finalAnswer, textPhase } from '../agent/final-answer.js';
import {defaultReactHarnessFactory} from '../react-harness/index.js';
import {resetMemberShell, closeBashRuntime} from '../react-harness/index.js';
import {groupSummaryTool} from './group-summary-tool.js';
import { fileReactHarnessFactory } from '../react-harness/index.js';
import type { ChatStore } from './data/group-chat.js';
import { AppError } from '../agent/data/model.js';
import type { ConfigService } from './data/config.js';
import { MemberConfigService } from './member-config.js';
import { DesignService } from '../workspace/design.js';
import { MemberWorkspace } from './member-workspace.js';
import { MemberInstructions } from './member-instructions.js';
import { teamTools } from './member-tools.js';
import type { RuntimePolicy, RuntimeTool } from '../agent/contracts.js';
import { groupSummaryEntry, groupSummaryTokenThreshold, retainedGroupMessages } from './data/group-summary.js';
import { readFileSync } from 'node:fs';

import { webTools } from '../react-harness/index.js';
import type { ContextEntry } from '../agent/data/model.js';
import { TeamRunner, type RunHost } from './team-runner.js';
import { TeamService, teamRunConfig, type MemberView, type TeamStore, type TeamView } from './data/members.js';
import type { WorkspaceService } from '../workspace/workspace.js';

const summaryInstructions = readFileSync(new URL('../../../prompts/team/group-summary.md', import.meta.url), 'utf8').trim();
if (!summaryInstructions) throw new Error('Group summary instructions must not be empty');


/** A member as the team's callers see it: its record, and whether it has a run in progress. */
export interface MemberStatus extends MemberView { running: boolean }
export interface TeamStatus extends Omit<TeamView, 'members'> { members: MemberStatus[] }

/** The workspace teams: members, the run part, and what the runtime needs to run a member. */
export class TeamSystem {
  readonly service: TeamService;
  readonly runner: TeamRunner;
  readonly instructions: MemberInstructions;
  readonly configuration: MemberConfigService;
  readonly designs: DesignService;
  readonly memberWorkspace: MemberWorkspace;
  private readonly web: RuntimeTool[];
  readonly runConfig: RunConfigSource;
  private runtime?: RunHost;
  private readonly summaryJobs = new Map<string, Promise<void>>();
  private readonly summaryController = new AbortController();
  private summaryStartup?: Promise<void>;

  constructor(private readonly store: TeamStore & ChatStore, private readonly workspaces: WorkspaceService, private readonly config: ConfigService, web: RuntimeTool[] = webTools()) {
    this.designs = new DesignService(workspaces);
    this.service = new TeamService(store, workspaces, config, this.designs);
    this.memberWorkspace = new MemberWorkspace(workspaces, this.designs, id => this.service.find(id));
    this.web = web;
    this.instructions = new MemberInstructions();
    this.runner = new TeamRunner(this.service, store, () => {
      if (!this.runtime) throw new Error('The team is not attached to a runtime');
      return this.runtime;
    }, ids => this.closeShells(ids), workspaceId => { void this.scheduleSummary(workspaceId); }, workspaceId=>this.designs.refresh(workspaceId));
    this.configuration = new MemberConfigService(this.service, this.memberWorkspace);
    this.runConfig = teamRunConfig(this.service, config);
  }

  private async scheduleSummary(workspaceId: string): Promise<void> {
    if (this.summaryController.signal.aborted) return;
    const existing = this.summaryJobs.get(workspaceId);
    if (existing) return existing;
    const runtime = this.runtime;
    const summaryInput = this.store.summaryInput;
    const submitGroupSummary = this.store.submitGroupSummary;
    if (!runtime || !summaryInput || !submitGroupSummary) return;
    const job = this.generateSummary(workspaceId, runtime, summaryInput, submitGroupSummary).catch(error => {
      if (!this.summaryController.signal.aborted) this.reportSummaryFailure(workspaceId, error);
    }).finally(() => { if (this.summaryJobs.get(workspaceId) === job) this.summaryJobs.delete(workspaceId); });
    this.summaryJobs.set(workspaceId, job);
    await job;
  }

  private reportSummaryFailure(workspaceId: string, error: unknown): void {
    console.error('Group summary generation failed', { workspaceId, message: error instanceof Error ? error.message : String(error) });
  }

  /** Called only after AgentRuntime.open. The host need not await background analysis. */
  startMaintenance(): Promise<void> {
    return this.summaryStartup ??= (async () => {
      for (const workspace of await this.workspaces.list()) {
        if (this.summaryController.signal.aborted) break;
        await this.scheduleSummary(workspace.workspaceId);
      }
    })().catch(error => {
      if (!this.summaryController.signal.aborted) this.reportSummaryFailure('startup', error);
    });
  }

  async closeMaintenance(): Promise<void> {
    this.summaryController.abort();
    await this.summaryStartup;
    await Promise.allSettled(this.summaryJobs.values());
  }

  private async generateSummary(workspaceId: string, runtime: RunHost, summaryInput: NonNullable<ChatStore['summaryInput']>, submitGroupSummary: NonNullable<ChatStore['submitGroupSummary']>): Promise<void> {
    const input = await summaryInput.call(this.store, workspaceId);
    if (input.uncoveredTokens < groupSummaryTokenThreshold || !input.messages.length) return;
    const lead = (await this.service.active(workspaceId)).find(member => member.value.lead);
    if (!lead || !runtime.runMaintenance) return;
    const resolved = await this.runConfig.resolveForRun(lead.id);
    const { baseRevision, from, through, analyzedThrough, sourceDigest } = input;
    const pinned = { baseRevision, from, through, analyzedThrough, sourceDigest };
    const prompt = summaryInstructions.replaceAll('{{from}}', String(from)).replaceAll('{{through}}', String(through));
    const stale = new AbortController();
    const signal = AbortSignal.any([this.summaryController.signal, stale.signal]);
    let submitted = false;
    const tool = groupSummaryTool(async text => {
      try {
        const result = await submitGroupSummary.call(this.store, workspaceId, { ...pinned, text });
        submitted = true;
        console.info('Group summary accepted', { workspaceId, through, analyzedThrough });
        return result;
      } catch (error) {
        // A reset/competing replacement requires a new snapshot, not more text retries.
        if (error instanceof AppError && error.code === 'context_conflict') stale.abort(error);
        throw error;
      }
    });
    const entries: ContextEntry[] = [
      ...(input.previous ? [groupSummaryEntry(workspaceId, input.previous)] : []),
      ...input.messages.map(message => structuredClone(message.entry)),
    ];
    signal.throwIfAborted();
    console.info('Group summary generation started', { workspaceId, messages: input.messages.length, previousSummary: !!input.previous, through, analyzedThrough, provider: resolved.model.provider, model: resolved.model.id });
    const result = await runtime.runMaintenance({ ...resolved, tools: [tool], systemPrompt: prompt, compaction: undefined }, entries, signal, {
      message: async record => {
        if (record.message.role === 'toolResult' && record.message.isError) {
          const feedback = record.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
          const message = feedback.split('\n\nReceived arguments:')[0]!.slice(0,2000);
          console.warn('Group summary tool rejected', { workspaceId, runId: record.runId, tool: record.message.toolName, message });
        }
        return record;
      },
    });
    if (stale.signal.aborted) throw stale.signal.reason;
    if (!submitted) throw new AppError('group_summary_failed', result.error?.message ?? 'Maintenance ended without an accepted group summary', 500);
  }
  /** The runtime that runs the members and maintenance jobs. */
  attach(runtime: RunHost): void {
    this.runtime = runtime;
  }


  /** Gives workspaces that have no lead one; the backend calls this once at startup. */
  async initialize(): Promise<void> {
    await this.service.initialize();
    await this.service.initializeWorkspaceModels();
  }

  async team(workspaceId: string): Promise<TeamStatus> {
    const team = await this.service.team(workspaceId);
    return { ...team, members: team.members.map(member => this.status(member)) };
  }

  async roster(workspaceId: string) {
    const roster = await this.service.roster(workspaceId);
    return { ...roster, members: roster.members.map(member => ({ ...member, running: this.runner.isRunning(member.memberId) })) };
  }

  modelSettings(workspaceId: string, memberId: string) { return this.service.modelSettings(workspaceId, memberId); }
  async memberMetadata(workspaceId: string, memberId: string) {
    const roster = await this.roster(workspaceId);
    const member = roster.members.find(item => item.memberId === memberId);
    if (!member) throw new AppError('not_found', 'Member not found in this workspace', 404);
    return member;
  }

  updateModelSettings(workspaceId: string, memberId: string, revision: number, value: unknown) {
    return this.runner.workspaceOperation(workspaceId, () => this.service.updateModelSettings(workspaceId, memberId, revision, value));
  }

  async member(workspaceId: string, memberId: string): Promise<MemberStatus> {
    return this.status(await this.service.get(workspaceId, memberId));
  }
  async requireContextMember(workspaceId: string, memberId: string): Promise<void> {
    await this.service.requireWorkspace(workspaceId);
    const member = await this.service.find(memberId);
    if (!member || member.workspaceId !== workspaceId || member.value.retiredAt !== null)
      throw new AppError('not_found', 'Member not found in this workspace', 404);
  }
  inspectGroupContext(workspaceId: string, input: ContextPageInput = {}) { return this.store.inspectGroupContext(workspaceId, input); }
  async inspectGroupSummary(workspaceId: string) {
    await this.service.requireWorkspace(workspaceId);
    return { summary: await this.store.readGroupSummary?.(workspaceId) ?? null, retainedMessages: retainedGroupMessages };
  }

  async create(workspaceId: string, input: unknown): Promise<MemberStatus> {
    const member=await this.service.create(workspaceId,input);
    const files=await this.memberWorkspace.files(member.memberId);
    const source=(await this.service.find(member.memberId))!.value.configuration;
    if(source)for(const [path,content]of Object.entries(source.files)){const target=join(files.root,dirname(source.path),path);await mkdir(dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx'});}
    return this.status(member);
  }

  async update(workspaceId: string, memberId: string, revision: number, value: unknown): Promise<MemberStatus> {
    const current = await this.service.get(workspaceId, memberId);
    if (this.runner.isRunning(memberId) && JSON.stringify((value as {designScope?: unknown})?.designScope) !== JSON.stringify(current.designScope)) throw new AppError('member_busy', 'Wait for the member before changing design assignment', 409);
    return this.memberWorkspace.operation(memberId, async () => { const result = await this.service.update(workspaceId, memberId, revision, value); await this.closeShells([memberId]); return this.status(result); });
  }

  activateConfiguration(workspaceId: string) {
    return this.runner.idleWorkspace(workspaceId, () => this.configuration.activate(workspaceId));
  }
  async closeShells(ids?: string[]): Promise<void> {
    if (!ids) return closeBashRuntime();
    await Promise.all(ids.map(id => resetMemberShell(id)));
  }
  private status(member: MemberView): MemberStatus {
    return { ...member, running: this.runner.isRunning(member.memberId) };
  }

  /**
   * Wraps a policy so member model calls get fixed Team rules and activated agent.md instructions
   * just before the call, and its tools. Every other agent is unchanged.
   */
  policy(base: RuntimePolicy): RuntimePolicy {
    const { management } = teamTools(this.service, this.configuration);
    return {
      ...base,
      createReactHarnessFactories: async agentId => {
        const factories = await base.createReactHarnessFactories?.(agentId) ?? [];
        const member = await this.service.find(agentId);
        if (!member) return factories;
        const workspace = await this.workspaces.record(member.workspaceId);
        return [...factories, fileReactHarnessFactory(workspace.directory,async refresh=>{
          const manager=await this.workspaces.contextManager(member.workspaceId);
          const snapshot=refresh||!manager.snapshot()?await manager.refresh():manager.snapshot()!;
          const current=await this.service.find(agentId);
          if(!current)throw new AppError('not_found','Member is unavailable',404);
          const workingDesigns=await this.designs.workingPaths(member.workspaceId,current.value.designScope.working);
          return {snapshot,workingDesigns,readme:path=>manager.loadUsageReadme(path,snapshot)};
        }), defaultReactHarnessFactory(workspace.directory, [...this.web, ...management])];
      },
      groupContext: async agentId => {
        const member = await this.service.find(agentId);
        if (!member) return base.groupContext?.(agentId);
        return { id: member.workspaceId, read: (after, through) => this.store.readGroupContext(member.workspaceId, after, through) };
      },
      acquireRun: async (run, signal) => {
        const release = await this.runner.acquireExecution(run.agentId, signal);
        try {
          const releaseBase = await base.acquireRun?.(run, signal);
          return () => { try { releaseBase?.(); } finally { release(); } };
        } catch (error) { release(); throw error; }
      },
      shouldContinue: async (scope, response, results, record) => {
        const member = await this.service.find(scope.agentId);
        if (!member) return base.shouldContinue ? base.shouldContinue(scope, response, results, record) : response.content.some(part => part.type === 'toolCall');
        if (response.stopReason === 'length') throw new AppError('incomplete_response', 'The model response reached its token limit; no final answer was published');
        if (response.content.some(part => part.type === 'toolCall')) return true;
        if (response.stopReason !== 'stop') throw new AppError('invalid_response', 'Model response ended without a natural completion or executable tools');
        const answer = finalAnswer(response);
        if (!answer) {
          if (response.content.some(part => part.type === 'text' && textPhase(part) === 'commentary')) return true;
          throw new AppError('empty_response', 'The model finished without final answer text');
        }
        scope.signal.throwIfAborted();
        try {
          scope.signal.throwIfAborted();
          await this.runner.publishFinal(scope.agentId, scope.runId, answer.text, record.messageId);
          return false;
        } catch (error) {
          if (!(error instanceof AppError) || error.status >= 500 || error.code === 'exchange_stopped') throw error;
          scope.signal.throwIfAborted();
          await this.runtime!.feedback(scope.agentId, scope.runId, `Group publication refused (${error.code}): ${error.message}. This attempt was not shared and triggered no one. Revise your final response or retry when the recipient is free. Do not assume a task was delivered.`);
          return true;
        }
      },
      buildRequest: async (scope, history) => {
        const request = await base.buildRequest(scope, history);
        const member = await this.service.find(scope.agentId);
        if (!member) return request;
        if (request.context.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image')) && !request.model.input.includes('image')) {
          throw new AppError('image_not_supported', 'This context contains pictures; select a model with image input', 409);
        }
        const systemPrompt = this.instructions.build(scope.config.systemPrompt);
        return {...request, context: {...request.context, systemPrompt: systemPrompt ?? ''}};
      },
    };
  }
}
