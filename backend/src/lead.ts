import { DesignService } from './design.js';
import { harnessConfig } from './harness-config.js';
import { resolveHarness } from './harness.js';
import { maxMessageCharacters, type TeamRunner } from './team-runner.js';
import type { MemberView, StoredMember, TeamService } from './team.js';
import { AppError, identity } from './types.js';

/** The lead's design maintenance and assignments; member lifecycle and calls remain owned by the team. */
export class LeadService {
  constructor(private readonly team: TeamService, private readonly runner: TeamRunner, private readonly designs: DesignService) {}

  async readDesign(memberId: string, path: unknown) {
    const lead = await this.requireLead(memberId);
    return this.designs.inspect(lead.workspaceId, path);
  }

  async saveDesign(memberId: string, runId: string, input: { path: unknown; content: unknown; implementation: unknown; baseRevision: unknown; reason: unknown }) {
    const lead = await this.requireLead(memberId);
    if (input.baseRevision !== null) identity(input.baseRevision, 'baseRevision');
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) throw new AppError('invalid_input', 'A design change has a reason of 1–1,000 characters');
    return this.designs.save(lead.workspaceId, input.path, { content: input.content, implementation: input.implementation }, input.baseRevision, input.reason, { type: 'lead', memberId: lead.id, runId });
  }

  async configureHarness(memberId: string, to: unknown, value: unknown): Promise<MemberView> {
    const lead = await this.requireLead(memberId);
    if (typeof to !== 'string') throw new AppError('invalid_input', 'Name the member whose harness changes');
    const member = await this.team.byName(lead.workspaceId, to);
    if (!member) throw new AppError('not_found', `No member named "${to}"`, 404);
    const harness = harnessConfig(value);
    await resolveHarness(this.designs, member.workspaceId, harness);
    const { name, role, responsibility, settings } = member.value;
    return this.team.update(member.workspaceId, member.id, member.revision, { name, role, responsibility, settings, harness });
  }

  async assign(memberId: string, runId: string, signal: AbortSignal, input: { to: unknown; text: unknown }): Promise<string> {
    const lead = await this.requireLead(memberId);
    if (typeof input.to !== 'string' || typeof input.text !== 'string' || !input.text.trim()) throw new AppError('invalid_input', 'An assignment names a member and gives a non-empty objective');
    const recipient = await this.team.byName(lead.workspaceId, input.to);
    if (!recipient) throw new AppError('not_found', `No member named "${input.to}"`, 404);
    if (recipient.value.lead) throw new AppError('lead_required', 'Assign work to a worker; the lead works with the user', 409);
    const resolved = await resolveHarness(this.designs, lead.workspaceId, recipient.value.harness);
    if (!resolved.working.length && !resolved.dependencies.length) throw new AppError('invalid_config', 'Configure the member design scope before assigning work');
    const references = [
      ...resolved.working.map(part => `- Working: .context/${part.path} (revision ${part.revision}); implementation ${part.implementation.join(', ')}`),
      ...resolved.dependencies.map(part => `- Dependency: .context/${part.path} (revision ${part.revision}); implementation ${part.implementation.join(', ')} (read-only)`),
    ];
    const message = [
      'Assignment based on the user design:',
      input.text,
      'Design files to read before doing the work:',
      references.join('\n'),
      'Use the current design in these files. Work within your file boundary. If a design choice is unsettled, return the question and choices to the lead. End with what was done, which files changed, and what is still open.',
    ].join('\n\n');
    if (message.length > maxMessageCharacters) throw new AppError('invalid_input', `The objective and design references together must fit ${maxMessageCharacters} characters`);
    signal.throwIfAborted();
    return this.runner.call(lead.id, runId, signal, recipient.value.name, message);
  }

  private async requireLead(memberId: string): Promise<StoredMember> {
    const member = await this.team.find(memberId);
    if (!member?.value.lead || member.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead maintains the user design and assigns work', 403);
    return member;
  }
}
