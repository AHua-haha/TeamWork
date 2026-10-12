import type { ConfigService } from './config.js';
import { LeadService } from './lead.js';
import { leadTools } from './lead-tools.js';
import { DesignService } from './design.js';
import { HarnessService } from './harness.js';
import { MemberContext } from './member-context.js';
import { teamTools } from './member-tools.js';
import type { RunConfigSource, RuntimePolicy } from './runtime.js';
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
  readonly context: MemberContext;
  readonly lead: LeadService;
  readonly designs: DesignService;
  readonly harness: HarnessService;
  readonly runConfig: RunConfigSource;
  private runtime?: RunHost;

  constructor(store: TeamStore, workspaces: WorkspaceService, private readonly config: ConfigService) {
    this.designs = new DesignService(workspaces);
    this.service = new TeamService(store, workspaces, config, this.designs);
    this.harness = new HarnessService(workspaces, this.designs, id => this.service.find(id));
    this.context = new MemberContext(this.service, workspaces);
    this.runner = new TeamRunner(this.service, () => {
      if (!this.runtime) throw new Error('The team is not attached to a runtime');
      return this.runtime;
    });
    this.lead = new LeadService(this.service, this.runner, this.designs);
    this.runConfig = teamRunConfig(this.service, config);
  }

  /** The runtime that runs the members. */
  attach(runtime: RunHost): void {
    this.runtime = runtime;
  }

  /** Gives workspaces that have no lead one; the backend calls this once at startup. */
  initialize(): Promise<void> {
    return this.service.initialize();
  }

  async team(workspaceId: string): Promise<TeamStatus> {
    const team = await this.service.team(workspaceId);
    return { ...team, members: team.members.map(member => this.status(member)) };
  }

  async member(workspaceId: string, memberId: string): Promise<MemberStatus> {
    return this.status(await this.service.get(workspaceId, memberId));
  }

  async create(workspaceId: string, input: unknown): Promise<MemberStatus> {
    return this.status(await this.service.create(workspaceId, input));
  }

  async update(workspaceId: string, memberId: string, revision: number, value: unknown): Promise<MemberStatus> {
    return this.status(await this.service.update(workspaceId, memberId, revision, value));
  }

  private status(member: MemberView): MemberStatus {
    return { ...member, running: this.runner.isRunning(member.memberId) };
  }

  /**
   * Wraps a policy so that a team member's model calls get its instructions, assembled from the team and the context base
   * just before the call, and its tools. Every other agent is unchanged.
   */
  policy(base: RuntimePolicy): RuntimePolicy {
    const { messaging, management } = teamTools(this.service, this.runner, this.config);
    const lead = leadTools(this.lead);
    return {
      ...base,
      buildRequest: async (scope, history) => {
        const request = await base.buildRequest(scope, history);
        const member = await this.service.find(scope.agentId);
        if (!member) return request;
        const prepared = await this.harness.prepare(scope.agentId, [...messaging, ...(member.value.lead ? [...management, ...lead] : [])]);
        const systemPrompt = [await this.context.instructions(scope.agentId, scope.config.systemPrompt), prepared.context].join('\n\n');
        return { ...request, tools: prepared.tools, context: { ...request.context, tools: prepared.tools.map(tool => tool.definition), systemPrompt } };
      },
    };
  }
}
