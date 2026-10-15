import { Type } from '@earendil-works/pi-ai';
import type { RuntimeTool } from './runtime.js';
import type { TeamRunner } from './team-runner.js';
import { type StoredMember, type TeamService } from './team.js';
import { AppError } from './types.js';
import { refusing } from './tool-result.js';

/** The tools that belong to the team: team management for the lead. */
export function teamTools(team: TeamService, runner: TeamRunner): { management: RuntimeTool[] } {
  const lead = async (agentId: string): Promise<StoredMember> => {
    const member = await team.find(agentId);
    if (!member?.value.lead || member.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead changes the team', 403);
    return member;
  };
  const target = async (leader: StoredMember, name: unknown): Promise<StoredMember> => {
    const member = await team.byName(leader.workspaceId, String(name));
    if (!member) throw new AppError('not_found', `No member named "${String(name)}"`, 404);
    if (member.value.lead) throw new AppError('lead_required', 'The lead cannot be changed or retired by itself; ask the user', 409);
    return member;
  };
  return {
    management: [
      {
        definition: {
          name: 'retire_member',
          description: 'Remove a member other than yourself from the team. Its run is cancelled and its status is visible in the group chat. What it wrote stays.',
          parameters: Type.Object({ name: Type.String({ description: 'Name of the member' }) }),
        },
        execute: (args, scope) => refusing(async () => {
          const member = await target(await lead(scope.agentId), args.name);
          await runner.retire(member.workspaceId, member.id, member.revision);
          return `Retired ${member.value.name}`;
        }),
      },
      {
        definition: { name: 'list_models', description: 'List this workspace’s configured model choices and default for member configuration.', parameters: Type.Object({}) },
        execute: (_args, scope) => refusing(async () => JSON.stringify(await team.models((await lead(scope.agentId)).workspaceId), null, 2)),
      },
    ],
  };
}
