import { DesignService } from './design.js';
import { harnessConfig } from './harness-config.js';
import { resolveHarness } from './harness.js';
import type { MemberView, StoredMember, TeamService } from './team.js';
import { AppError } from './types.js';

/** The lead's design maintenance and assignments; member lifecycle and chat cooperation remain owned by the team. */
export class LeadService {
  constructor(private readonly team: TeamService, private readonly designs: DesignService) {}

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
    if (!member?.value.lead || member.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead configures member harness assignments', 403);
    return member;
  }
}
