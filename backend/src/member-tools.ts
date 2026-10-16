import { Type } from '@earendil-works/pi-ai';
import type { RuntimeTool } from './runtime.js';
import type { TeamService } from './team.js';
import { AppError } from './types.js';
import { refusing } from './tool-result.js';

/** Member lifecycle mutations through agent tools are deferred; discovery is read-only. */
export function teamTools(team: TeamService): { management: RuntimeTool[] } {
  return { management: [{
    definition: { name: 'list_models', description: 'List this workspace’s configured model choices and default.', parameters: Type.Object({}) },
    execute: (_args, scope) => refusing(async () => {
      const member = await team.find(scope.agentId);
      if (!member?.value.lead || member.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead discovers team model choices', 403);
      return JSON.stringify(await team.models(member.workspaceId), null, 2);
    }),
  }] };
}
