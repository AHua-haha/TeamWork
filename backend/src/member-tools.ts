import type { MemberConfigService } from './member-config.js';
import { Type } from '@earendil-works/pi-ai';
import type { RuntimeTool } from './runtime.js';
import type { TeamService } from './team.js';
import { AppError } from './types.js';
import { refusing } from './tool-result.js';

/** Reusable discovery and file-validation capabilities; activation is user-only. */
export function teamTools(team: TeamService, configuration: MemberConfigService): { management: RuntimeTool[] } {
  return { management: [{
    definition: { name: 'list_models', description: 'List this workspace’s configured model choices and default.', parameters: Type.Object({}) },
    execute: (_args, scope) => refusing(async () => {
      const member = await team.find(scope.agentId);
      if (!member?.value.lead || member.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead discovers team model choices', 403);
      return JSON.stringify(await team.models(member.workspaceId), null, 2);
    }),
  }, {
    definition: { name: 'validate_member_config', description: 'Validate the complete pending .team/members file change set. Reports create/update/delete and issues; does not commit or activate anything.', parameters: Type.Object({ path: Type.String() }, { additionalProperties: false }) },
    execute: (args, scope) => refusing(async () => JSON.stringify(await configuration.validate(scope.agentId, args.path), null, 2)),
  }] };
}
