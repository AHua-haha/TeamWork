import type { TeamService } from './team.js';
import type { WorkspaceService } from '../workspace/workspace.js';
import { readFileSync } from 'node:fs';
import { AppError } from '../agent/types.js';

const responseRules = readFileSync(new URL('../../../prompts/team/group-chat.md', import.meta.url), 'utf8').trim();
if (!responseRules) throw new AppError('invalid_config', 'Required team group-chat prompt is empty', 500);

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Team roles and cooperation. The harness supplies file context and tools. */
export class MemberInstructions {
  constructor(private readonly team: TeamService, private readonly workspaces: WorkspaceService, private readonly isRunning: (memberId: string) => boolean = () => false, private readonly permissionsEnabled = true) {}
  async build(agentId: string, own: string | undefined): Promise<string | null> {
    const member = await this.team.find(agentId);
    if (!member) return null;
    const { name, role, responsibility, lead } = member.value;
    const workspace = await this.workspaces.record(member.workspaceId);
    const roster = await this.team.active(member.workspaceId);
    const issues = await this.team.issues(roster);
    const rules = [
      `You are ${name}, ${role} on the team of the workspace "${workspace.name}". The shared workspace folder is ${workspace.directory}; all members use these same files under their harness permissions.`,
      `Your responsibility: ${responsibility || '(none given yet)'}`,
      '## How the team works',
      this.permissionsEnabled ? 'Harness permissions are enforced; dependency implementation is read-only for file tools.' : 'Harness permission enforcement is disabled by the operator. Design assignments are work guidance, not access restrictions. The configured tools can edit any OS-accessible path and commit without a harness approval. Member activation is still a separate user action.',
      '- The user design is the shared agreement. Read and follow it. Implementation context belongs to the design and subdesigns, independently of member identity. Follow your harness maintenance rules.',
      responseRules,
      '- Only one member executes at a time in this workspace. Your final response can mention at most one distinct member. Publication is refused as a whole if any recipient is busy, missing or unready, or the exchange mention limit would be exceeded. Private refusal feedback lets you revise or retry within your current run. A refused attempt delivered no task. Busy mentions are not queued or retried automatically.',
      '- Group context is shared and maintained centrally. Each activation constructs working context from earlier group messages, your implementation README summary/lookup, retained failed work, new group messages and automatic retrieval results. New messages do not enter the middle of ongoing work. Only final published responses are shared; private tool/work history remains yours.',
      '- Maintain your assigned implementation-context impl/README.md with current results, file lookup and Bash retrieval configuration before a successful final response. End with what was done, which files changed, and what is still open. A successful run clears retained working messages from future context; failures preserve recorded private work across restart.',
      lead
        ? [
            '- User messages without mentions trigger you. Help the user create, update, and maintain the whole project design and its subdesigns. Use common read/write/edit tools in the shared workspace. Explain pending changes and request user review; follow the configured harness commit permission mode.',
            '- Keep user-owned design decisions in the system tree described by your harness.',
            '- When a design choice is unsettled, offer concrete choices with their tradeoffs and your recommendation, then end your reply and wait for the user\'s answer. Do not commit your recommendation as the user\'s choice or assign dependent work before it is settled.',
            '- Decompose based on accepted designs. Follow the management harness rules for maintaining and validating member files. Use list_models for workspace choices and assign only active members; pending or merely committed files do not activate a member.',
            '- Assign work in your final group response by listing the worker in its leading <mentions> header and stating the objective and expected result in the body. Its designs come from its harness. Bring proposed design changes from a worker to the user.',
          ].join('\n')
        : '- The lead coordinates design and team changes. If a design change or user decision is needed, list the lead in the leading <mentions> header and put the question and choices in your final body. Follow the configured harness permission mode.',
      '## Team',
      ...roster.map((entry, index) => `- ${entry.value.name} (${entry.value.role})${entry.id === agentId ? ', you' : ''}${this.isRunning(entry.id) ? ', working' : ', idle'}: ${oneLine(entry.value.responsibility) || 'no responsibility given'}${issues[index]!.length ? ` [cannot run yet: ${issues[index]!.join('; ')}]` : ''}`),
    ];
    if (lead) rules.push('## Existing member file locations\n' + roster.map(m => `${m.value.name}: ${m.value.configuration?.path ?? '(not initialized)'}`).join('\n'));
    if (own) rules.push(`## Your instructions\n${own}`);
    return rules.join('\n\n');
  }
}
