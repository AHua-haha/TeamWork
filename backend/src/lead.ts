import { DesignService } from './design.js';
import { harnessConfig } from './harness-config.js';
import { resolveHarness } from './harness.js';
import type { MemberView, StoredMember, TeamService } from './team.js';
import { AppError, identity } from './types.js';

/** The lead's design maintenance and assignments; member lifecycle and chat cooperation remain owned by the team. */
export class LeadService {
  constructor(private readonly team: TeamService, private readonly designs: DesignService) {}

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

  private async requireLead(memberId: string): Promise<StoredMember> {
    const member = await this.team.find(memberId);
    if (!member?.value.lead || member.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead maintains the user design', 403);
    return member;
  }
}
