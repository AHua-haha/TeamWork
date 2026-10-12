import { MemberFiles, memberAccess } from './member-files.js';
import type { ContextBase } from './context-base.js';
import type { TeamService } from './team.js';
import { AppError } from './types.js';
import type { WorkspaceService } from './workspace.js';

/** Each section of the context view is cut at this many bytes of file content. */
export const viewBudget = 64 * 1024;
const maxListedFiles = 200;

/** Files of one context-base folder or file, expanded. A missing path gives no files. */
async function expand(base: ContextBase, path: string): Promise<{ path: string; size: number }[]> {
  try {
    return (await base.tree(path, 16)).entries.flatMap(entry => entry.type === 'file' ? [{ path: entry.path, size: entry.size }] : []);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'not_found') return [];
    if (error.code === 'invalid_path') return [{ path, size: (await base.read({ path })).size }];
    throw error;
  }
}

/** The contents of as many files as fit the budget, and the paths of the rest. */
async function section(base: ContextBase, files: { path: string; size: number }[]): Promise<{ shown: string[]; omitted: string[] }> {
  const seen = new Set<string>();
  const shown: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const file of files) {
    if (seen.has(file.path.toLowerCase())) continue;
    seen.add(file.path.toLowerCase());
    if (used + file.size > viewBudget) { omitted.push(file.path); continue; }
    used += file.size;
    shown.push(`### .context/${file.path}\n${(await base.read({ path: file.path })).content}`);
  }
  return { shown, omitted };
}

function block(title: string, note: string, part: { shown: string[]; omitted: string[] }, empty: string): string {
  const lines = [`## ${title}`, note];
  if (!part.shown.length && !part.omitted.length) lines.push(empty);
  lines.push(...part.shown);
  if (part.omitted.length) lines.push(`Not shown (too large for this view; read them with your tools): ${part.omitted.map(path => `.context/${path}`).join(', ')}`);
  return lines.join('\n\n');
}

const oneLine = (text: string, max = 200) => { const line = text.replace(/\s+/g, ' ').trim(); return line.length > max ? `${line.slice(0, max - 1)}…` : line; };

/** Per-member access and instructions, from the team and the workspace's context base. */
export class MemberContext {
  constructor(private readonly team: TeamService, private readonly workspaces: WorkspaceService) {}

  /** The workspace files as this member may use them. */
  async files(memberId: string): Promise<MemberFiles> {
    const member = await this.team.find(memberId);
    if (!member || member.value.retiredAt !== null) throw new AppError('not_found', 'This agent is not an active team member', 404);
    return new MemberFiles((await this.workspaces.record(member.workspaceId)).directory, memberAccess(member));
  }

  /**
   * The system prompt for one model call of a team member, or null for any other agent.
   * `own` is the member's instructions from its settings.
   */
  async instructions(agentId: string, own: string | undefined): Promise<string | null> {
    const member = await this.team.find(agentId);
    if (!member) return null;
    const { name, role, responsibility, scope, lead } = member.value;
    const workspace = await this.workspaces.record(member.workspaceId);
    const roster = await this.team.active(member.workspaceId);
    const issues = await this.team.issues(roster);
    const base = await this.workspaces.context(member.workspaceId);

    const rules = [
      `You are ${name}, ${role} on the team of the workspace "${workspace.name}". The workspace folder is ${workspace.directory}.`,
      `Your responsibility: ${responsibility || '(none given yet)'}`,
      [
        '## How the team works',
        '- The files in the workspace folder are the team\'s memory; conversations are not. Write down what you or others will need later.',
        '- .context/user/ is the user\'s context: goals, spec, constraints, preferences. Read it and never change it.',
        `- .context/agent/ is the team's own context: design, plans, reports, knowledge. ${lead ? 'You may read and write all of it.' : 'You may read and write only the paths in your scope.'}`,
        '- Everything else in the folder is the project. Work in it with ls, read, edit, and write. There is no search tool yet: find things by listing and reading.',
        '- Use send_message to ask a teammate by name to do something. The teammate works in its own conversation while you wait, and only its final response comes back to you; you do not see its reasoning, tool calls, or files. Put what it must know into the message and into files.',
        '- Your final response is your report to whoever called you. End your run with what was done, which files changed, and what is still open. Write details into files, because the caller sees only your final response.',
        '- A teammate already in the chain of calls that reached you cannot be called, and the chain is short. Do not call the member who called you.',
        lead
          ? '- You are the only member the user talks to. Find out what the user wants and ask when only they can decide. Do not edit user context; tell the user what you suggest.\n- Form the team the project needs with create_member, update_member, and retire_member, giving each member a clear responsibility and a scope of agent context. Write the team\'s design (systems, owners, plans) into .context/agent/ so it survives. Give work to members with send_message, one at a time, and read what comes back before going on.'
          : '- The lead talks to the user and changes the team, and you cannot call the lead. If you are blocked or need a decision, end your run with the question as your final response.',
      ].join('\n'),
      ['## Team', ...roster.map((member, index) => `- ${member.value.name} (${member.value.role})${member.id === agentId ? ', you' : ''}: ${oneLine(member.value.responsibility) || 'no responsibility given'}${issues[index]!.length ? ` [cannot run yet: ${issues[index]!.join('; ')}]` : ''}`)].join('\n'),
      `## Your scope\n${scope.length ? scope.map(path => `.context/${path}`).join(', ') : 'none'}`,
    ];
    if (own) rules.push(`## Your instructions\n${own}`);

    const userFiles = await expand(base, 'user');
    const scoped = (await Promise.all(scope.map(path => expand(base, path)))).flat();
    const views = [
      block('User context', 'The user\'s files under .context/user/, shared by the whole team.', await section(base, userFiles), 'There are no user context files yet.'),
      block('Your scope', 'The files of your scope under .context/agent/.', await section(base, scoped), scope.length ? 'The paths in your scope hold no files yet.' : 'Your scope is empty.'),
    ];
    if (lead) {
      const all = (await expand(base, 'agent')).slice(0, maxListedFiles);
      views.push(`## Agent context files\n${all.length ? all.map(file => `.context/${file.path} (${file.size} bytes)`).join('\n') : 'There are no agent context files yet.'}`);
    }
    return [...rules, ...views].join('\n\n');
  }
}
