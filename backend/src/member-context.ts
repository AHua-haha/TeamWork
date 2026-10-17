import type { TeamService } from './team.js';
import type { WorkspaceService } from './workspace.js';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Team roles and cooperation. The harness supplies file context and tools. */
export class MemberContext {
  constructor(private readonly team: TeamService, private readonly workspaces: WorkspaceService, private readonly isRunning: (memberId: string) => boolean = () => false) {}
  async instructions(agentId: string, own: string | undefined): Promise<string | null> {
    const member = await this.team.find(agentId);
    if (!member) return null;
    const { name, role, responsibility, lead } = member.value;
    const workspace = await this.workspaces.record(member.workspaceId);
    const roster = await this.team.active(member.workspaceId);
    const issues = await this.team.issues(roster);
    const rules = [
      `You are ${name}, ${role} on the team of the workspace "${workspace.name}". The original workspace folder is ${workspace.directory}; file and command tools use your separate harness worktree.`,
      `Your responsibility: ${responsibility || '(none given yet)'}`,
      '## How the team works',
      '- The user design is the shared agreement. Read and follow it. Implementation context belongs to the design and subdesigns, independently of member identity. Follow your harness maintenance rules.',
      '- Work in the shared group chat. Use ordinary assistant text to explain progress while using tools. Finish your work with a complete Markdown reply; a natural model completion without tools offers its answer for shared publication. Only accepted final answers are shared with everyone. Do promised work before finishing. Address recipients using @Name or @{Name With Spaces}. Mention tokens are routing instructions even inside quotes or code. Do not mention yourself. A response without mentions triggers no member.',
      '- Mentioned members work independently and may run in parallel. Publication is refused as a whole if any recipient is busy, missing or unready, or the exchange mention limit would be exceeded. Private refusal feedback lets you revise or retry within your current run. A refused attempt delivered no task. There is no queue or automatic retry.',
      '- All accepted shared messages enter every member context. Messages received during your work are appended after you finish. Your retained private work and tool results are yours alone; they are not shared with colleagues.',
      '- End with what was done, which files changed, and what is still open. Automatic harness-context maintenance is deferred.',
      lead
        ? [
            '- User messages without mentions trigger you. Help the user create, update, and maintain the whole project design and its subdesigns. Use common read/write/edit tools in your worktree. Explain pending changes and request user review; only user acceptance commits design.',
            '- A design part stores content and implementation paths together. Start with user/design.json and related JSON files for subdesigns. Keep user-owned design decisions there.',
            '- When a design choice is unsettled, offer concrete choices with their tradeoffs and your recommendation, then end your reply and wait for the user\'s answer. Do not commit your recommendation as the user\'s choice or assign dependent work before it is settled.',
            '- Decompose based on accepted designs. Follow the management harness rules for maintaining and validating member files. Use list_models for workspace choices and assign only active members; pending or merely committed files do not activate a member.',
            '- Assign work in your final group response by mentioning the worker and stating the objective and expected result. Its designs come from its harness. Bring proposed design changes from a worker to the user.',
          ].join('\n')
        : '- The lead maintains the design and changes the team. If a design change or user decision is needed, mention the lead in your final response with the question and choices; working designs may be edited under the harness, but committing them requires user approval. Never edit dependency designs.',
      '## Team',
      ...roster.map((entry, index) => `- ${entry.value.name} (${entry.value.role})${entry.id === agentId ? ', you' : ''}${this.isRunning(entry.id) ? ', working' : ', idle'}: ${oneLine(entry.value.responsibility) || 'no responsibility given'}${issues[index]!.length ? ` [cannot run yet: ${issues[index]!.join('; ')}]` : ''}`),
    ];
    if (lead) rules.push('## Existing member file locations\n' + roster.map(m => `${m.value.name}: ${m.value.configuration?.path ?? '(not initialized)'}`).join('\n'));
    if (own) rules.push(`## Your instructions\n${own}`);
    return rules.join('\n\n');
  }
}
