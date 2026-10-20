import { mkdir,writeFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { filesRevision } from './workspace-git.js';
import { finalAnswer, textPhase } from './final-answer.js';
import type { ChatStore } from './group-chat.js';
import { AppError } from './types.js';
import type { ConfigService } from './config.js';
import { MemberConfigService } from './member-config.js';
import { DesignService } from './design.js';
import { HarnessService } from './harness.js';
import { inspectHarnesses } from './harness-bases.js';
import { MemberInstructions } from './member-instructions.js';
import { ConversationContext, type MemberConversationStore } from './conversation-context.js';
import { teamTools } from './member-tools.js';
import type { RunConfigSource, RuntimePolicy, RuntimeTool } from './runtime.js';
import { webTools } from './web-tools.js';
import { TeamRunner, type RunHost } from './team-runner.js';
import { TeamService, teamRunConfig, type MemberView, type TeamStore, type TeamView } from './team.js';
import type { WorkspaceService } from './workspace.js';

/** A member as the team's callers see it: its record, and whether it has a run in progress. */
export interface MemberStatus extends MemberView { running: boolean }
export interface TeamStatus extends Omit<TeamView, 'members'> { members: MemberStatus[] }

/** The workspace teams: members, the run part, and what the runtime needs to run a member. */
export class TeamSystem {
  readonly service: TeamService;
  readonly runner: TeamRunner;
  readonly instructions: MemberInstructions;
  readonly conversation: ConversationContext;
  readonly configuration: MemberConfigService;
  readonly designs: DesignService;
  readonly harness: HarnessService;
  readonly runConfig: RunConfigSource;
  private runtime?: RunHost;

  constructor(store: TeamStore & ChatStore & MemberConversationStore, workspaces: WorkspaceService, private readonly config: ConfigService, web: RuntimeTool[] = webTools()) {
    this.designs = new DesignService(workspaces);
    this.service = new TeamService(store, workspaces, config, this.designs);
    this.harness = new HarnessService(workspaces, this.designs, id => this.service.find(id), web);
    this.conversation = new ConversationContext(store, this.harness);
    this.instructions = new MemberInstructions(this.service, workspaces, id => this.runner.isRunning(id));
    this.runner = new TeamRunner(this.service, store, () => {
      if (!this.runtime) throw new Error('The team is not attached to a runtime');
      return this.runtime;
    }, ids => this.harness.closeShells(ids));
    this.configuration = new MemberConfigService(this.service, this.harness);
    this.runConfig = teamRunConfig(this.service, config);
  }

  /** The runtime that runs the members. */
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

  modelSettings(workspaceId: string, memberId: string) { return this.service.modelSettings(workspaceId, memberId); }
  updateModelSettings(workspaceId: string, memberId: string, revision: number, value: unknown) {
    return this.runner.workspaceOperation(workspaceId, () => this.service.updateModelSettings(workspaceId, memberId, revision, value));
  }

  async member(workspaceId: string, memberId: string): Promise<MemberStatus> {
    return this.status(await this.service.get(workspaceId, memberId));
  }
  async inspect(workspaceId: string, memberId: string) {
    const { stored, member } = await this.service.inspect(workspaceId, memberId);
    return { member: this.status(member), configuration: stored.value.configuration ?? null, harnesses: inspectHarnesses(stored, member.harness.implementationScope) };
  }

  async create(workspaceId: string, input: unknown): Promise<MemberStatus> {
    const member=await this.service.create(workspaceId,input);
    const files=await this.harness.files(member.memberId);
    const source=(await this.service.find(member.memberId))!.value.configuration;
    if(source)for(const [path,content]of Object.entries(source.files)){const target=join(files.root,dirname(source.path),path);await mkdir(dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx'});}
    return this.status(member);
  }

  async update(workspaceId: string, memberId: string, revision: number, value: unknown): Promise<MemberStatus> {
    const current = await this.service.get(workspaceId, memberId);
    if (this.runner.isRunning(memberId) && JSON.stringify((value as { harness?: unknown })?.harness) !== JSON.stringify({ designScope: current.harness.designScope, allowedCommands: current.harness.allowedCommands })) throw new AppError('member_busy', 'Wait for the member before changing harness scope', 409);
    return this.harness.operation(memberId, async () => { const result = await this.service.update(workspaceId, memberId, revision, value); await this.harness.closeShells([memberId]); return this.status(result); });
  }

  async reviewConfiguration(workspaceId: string, origin: 'pending' | 'committed' = 'committed') {
    return this.runner.workspaceOperation(workspaceId, async () => {
      if (origin === 'committed') return this.configuration.review(workspaceId);
      const lead = (await this.service.active(workspaceId)).find(m => m.value.lead)!;
      return this.configuration.validate(lead.id, '.rsi/members');
    });
  }
  activateConfiguration(workspaceId: string, revision: string, digest: string) {
    return this.runner.idleWorkspace(workspaceId, () => this.configuration.activate(workspaceId, revision, digest));
  }
  currentConfiguration(workspaceId: string) {
    return this.runner.workspaceOperation(workspaceId, () => this.configuration.current(workspaceId));
  }
  changes(workspaceId: string) {
    return this.runner.workspaceOperation(workspaceId, async () => {
      const lead = (await this.service.active(workspaceId)).find(member => member.value.lead);
      if (!lead) throw new AppError('not_found', 'Workspace lead is unavailable', 404);
      const scopes = await this.harness.changes(lead.id), active = await this.service.activation(workspaceId);
      const committed = await this.harness.controlFiles(lead.id,'committed','.rsi/members');
      const activeFiles:Record<string,string>={};for(const member of await this.service.active(workspaceId))if(member.value.configuration)for(const [path,text]of Object.entries(member.value.configuration.files))activeFiles[`${member.value.configuration.path.slice(0,-'member.json'.length)}${path}`]=text;
      return { workspaceId, leadId: lead.id, ...scopes, activation: { revision: scopes.members.base, activeRevision: active?.revision ?? null, hasChanges: filesRevision(committed.files) !== filesRevision(activeFiles) } };
    });
  }
  private status(member: MemberView): MemberStatus {
    return { ...member, running: this.runner.isRunning(member.memberId) };
  }

  /**
   * Wraps a policy so that a team member's model calls get its instructions, assembled from the team and the context base
   * just before the call, and its tools. Every other agent is unchanged.
   */
  policy(base: RuntimePolicy): RuntimePolicy {
    const { management } = teamTools(this.service, this.configuration);
    return {
      ...base,
      beforeStep: async scope => {
        if (scope.step === 1) {
          const member = await this.service.find(scope.agentId);
          if (member) await this.conversation.prepare(member, scope);
        }
        await base.beforeStep?.(scope);
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
        const prepared = await this.harness.prepare(scope.agentId, member.value.lead ? management : []);
        const systemPrompt = [await this.instructions.build(scope.agentId, scope.config.systemPrompt), prepared.context].join('\n\n');
        return { ...request, tools: prepared.tools, context: { ...request.context, tools: prepared.tools.map(tool => tool.definition), systemPrompt } };
      },
    };
  }
}
