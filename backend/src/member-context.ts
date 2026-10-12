import type { TeamService } from './team.js';
import type { WorkspaceService } from './workspace.js';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Team roles and cooperation. The harness supplies file context and tools. */
export class MemberContext {
  constructor(private readonly team: TeamService, private readonly workspaces: WorkspaceService) {}
  async instructions(agentId: string, own: string | undefined): Promise<string | null> {
    const member = await this.team.find(agentId);
    if (!member) return null;
    const { name, role, responsibility, lead } = member.value;
    const workspace = await this.workspaces.record(member.workspaceId);
    const roster = await this.team.active(member.workspaceId);
    const issues = await this.team.issues(roster);
    const rules = [
      `You are ${name}, ${role} on the team of the workspace "${workspace.name}". The workspace folder is ${workspace.directory}.`,
      `Your responsibility: ${responsibility || '(none given yet)'}`,
      '## How the team works',
      '- The user design is the shared agreement. Read and follow it. Context and knowledge belong to the design and subdesigns, independently of member identity.',
      '- Use send_message to ask a teammate by name. The recipient runs while you wait and only its final response returns. Calls run one at a time, and a teammate already in the chain cannot be called.',
      '- End with what was done, which files changed, and what is still open. Automatic harness-context maintenance is deferred.',
      lead
        ? [
            '- You are the only member the user talks to. Help the user create, update, and maintain the whole project design and its subdesigns. Use read_design for the stored revision and save_design for a discussed change; explain every applied change in your reply.',
            '- A design part stores content and implementation paths together. Start with user/design.json and related JSON files for subdesigns. Keep user-owned design decisions there.',
            '- When a design choice is unsettled, offer concrete choices with their tradeoffs and your recommendation, then end your reply and wait for the user\'s answer. Do not save your recommendation as the user\'s choice or assign dependent work before it is settled.',
            '- Decompose based on the design. Use create_member, update_member, and retire_member to manage the team. Use configure_harness to choose working designs, dependency designs, and allowed commands for a member; you may configure your own harness without changing your model.',
            '- Give work with assign_member, stating the objective and expected result. Its designs come from its harness. Bring proposed design changes from a worker to the user.',
          ].join('\n')
        : '- The lead talks to the user and changes the team. You cannot call the lead while it waits for you. If a design change or user decision is needed, end with the question and choices for the lead; never edit a working or dependency design.',
      '## Team',
      ...roster.map((entry, index) => `- ${entry.value.name} (${entry.value.role})${entry.id === agentId ? ', you' : ''}: ${oneLine(entry.value.responsibility) || 'no responsibility given'}${issues[index]!.length ? ` [cannot run yet: ${issues[index]!.join('; ')}]` : ''}`),
    ];
    if (own) rules.push(`## Your instructions\n${own}`);
    return rules.join('\n\n');
  }
}
