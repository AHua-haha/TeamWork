import { dirname, join } from 'node:path';
import type { HarnessService } from './harness.js';
import type { MemberConfigSource } from './member-config-format.js';
import type { TeamService } from './team.js';
import { AppError } from './types.js';

/** Pending content and accepted source are independent; activation/change handling is deferred. */
export class MemberConfigService {
  constructor(private readonly team: TeamService, private readonly harness: HarnessService) {}
  async accepted(workspaceId: string, memberId: string): Promise<MemberConfigSource> {
    await this.team.get(workspaceId, memberId);
    const source = (await this.team.find(memberId))!.value.configuration;
    if (!source) throw new AppError('config_unavailable', 'Member source bundle has not been initialized', 409);
    return source;
  }
  async materialize(agentId: string): Promise<void> {
    const lead = await this.team.find(agentId);
    if (!lead?.value.lead || lead.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead reads member configuration', 403);
    await this.harness.operation(agentId, async () => {
      const files = await this.harness.files(agentId);
      for (const member of await this.team.active(lead.workspaceId)) {
        const source = member.value.configuration;
        if (!source) continue;
        for (const [path, content] of Object.entries(source.files)) {
          const absolute = join(files.root, dirname(source.path), path);
          if (await files.ls.exists(absolute)) continue;
          await files.write.mkdir(dirname(absolute));
          await files.write.writeFile(absolute, content);
        }
      }
    });
  }
}
