import type { TeamService } from './data/members.js';
import type { WorkspaceService } from '../workspace/workspace.js';
import { readFileSync } from 'node:fs';
import { AppError } from '../agent/data/model.js';

const responseRules = readFileSync(new URL('../../../prompts/team/group-chat.md', import.meta.url), 'utf8').trim();
if (!responseRules) throw new AppError('invalid_config', 'Required team group-chat prompt is empty', 500);

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Team roles and cooperation. React Harnesses supply capabilities and instructions. */
export class MemberInstructions {
  constructor(private readonly team: TeamService, private readonly workspaces: WorkspaceService, private readonly isRunning: (memberId: string) => boolean = () => false) {}
  async build(agentId: string, own: string | undefined): Promise<string | null> {
    const member = await this.team.find(agentId);
    if (!member) return null;
    const { name, role, responsibility, lead } = member.value;
    const workspace = await this.workspaces.record(member.workspaceId);
    const roster = await this.team.active(member.workspaceId);
    const issues = await this.team.issues(roster);
    const rules = [
      `You are ${name}, ${role} on the team of the workspace "${workspace.name}". The shared workspace folder is ${workspace.directory}; all members use these same files without tool permission restrictions.`,
      `Your responsibility: ${responsibility || '(none given yet)'}`,
      '## How the team works',
      'React Harness tools execute without design-scope, path, command, sandbox or Git approval restrictions. Design assignments are work guidance. Member activation remains a separate user action.',
      '- The user design is the shared agreement. Read and follow it. Implementation context belongs to the design and subdesigns, independently of member identity. Follow your React Harness maintenance instructions.',
      responseRules,
      '- Only one member executes at a time in this workspace. Your final response can mention at most one distinct member. Publication is refused as a whole if any recipient is busy, missing or unready, or the exchange mention limit would be exceeded. Private refusal feedback lets you revise or retry within your current run. A refused attempt delivered no task. Busy mentions are not queued or retried automatically.',
      '- Team owns original shared group context. Your context continues chronologically across runs: shared messages have one plain-text <metadata> area naming the sender and mentions, and your private model/tool work remains yours. New group messages are appended before work or after it finishes, never in the middle of ongoing work. Only accepted final responses are shared. Team maintains the shared summary independently; your runtime manages private compaction using its configured policy.',
      '- Maintain user design in DESIGN.md and consumer context in an optional README.md with summary and project-root-relative include metadata. Included source files or directories can contain implementation details. Keep internal development notes separate. Context metadata is refreshed explicitly on activation; dependency consumer content may be loaded from README and its inclusions. No document commands execute automatically. End with what was done, which files changed, and what is still open. Both successful and unsuccessful runs retain recorded private context across restart; run completion does not clear or reconstruct it.',
      lead
        ? [
            '- User messages without mentions trigger you. Help the user create, update, and maintain the whole project design and its subdesigns. Use common read/write/edit tools in the shared workspace. Explain pending changes and request user review; use ordinary Git directly and keep the user aware of design changes.',
            '- Keep user-owned design decisions in the project design tree.',
            '- When a design choice is unsettled, offer concrete choices with their tradeoffs and your recommendation, then end your reply and wait for the user\'s answer. Do not commit your recommendation as the user\'s choice or assign dependent work before it is settled.',
            '- Decompose based on accepted designs. Follow the member-file maintenance instructions for maintaining and validating member files. Use list_models for workspace choices and assign only active members; pending or merely committed files do not activate a member.',
            '- Assign work in your final group response by listing the worker in its leading <mentions> header and stating the objective and expected result in the body. Its designs come from its assignment. Bring proposed design changes from a worker to the user.',
          ].join('\n')
        : '- The lead coordinates design and team changes. If a design change or user decision is needed, list the lead in the leading <mentions> header and put the question and choices in your final body. Tools execute directly; respect the user design and preserve unrelated work.',
      '## Team',
      ...roster.map((entry, index) => `- ${entry.value.name} (${entry.value.role})${entry.id === agentId ? ', you' : ''}${this.isRunning(entry.id) ? ', working' : ', idle'}: ${oneLine(entry.value.responsibility) || 'no responsibility given'}${issues[index]!.length ? ` [cannot run yet: ${issues[index]!.join('; ')}]` : ''}`),
    ];
    if (lead) rules.push('## Existing member file locations\n' + roster.map(m => `${m.value.name}: ${m.value.configuration?.path ?? '(not initialized)'}`).join('\n'));
    if (own) rules.push(`## Your instructions\n${own}`);
    return rules.join('\n\n');
  }
}
