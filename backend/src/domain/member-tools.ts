import type { MemberConfigService } from './member-config.js';
import { Type, type JsonValue } from '@earendil-works/pi-ai';
import type { RuntimeTool } from './runtime.js';
import type { TeamService } from './team.js';
import { AppError } from '../foundation/types.js';

/** Reusable services; harness assembly grants management capability to the lead. */
export function teamTools(team: TeamService, configuration: MemberConfigService): { management: RuntimeTool[] } {
  return { management: [{
    definition: { name: 'list_models', description: 'List this workspace’s configured model choices, options and default.', parameters: Type.Object({}) },
    execute: async (_args, scope) => {
      const member = await team.find(scope.agentId);
      if (!member?.value.lead || member.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead discovers team model choices', 403);
      const result = await team.models(member.workspaceId);
      const lines = result.value.models.map((model, index) => {
        const isDefault = model.connectionId === result.value.defaultModel?.connectionId && model.modelId === result.value.defaultModel.modelId;
        const options = Object.entries(model).filter(([key]) => !['connectionId', 'modelId'].includes(key)).map(([key, value]) => `  ${key}: ${value}`).join('\n');
        return `${index + 1}. ${model.connectionId} / ${model.modelId}${isDefault ? ' (default)' : ''}${options ? '\n' + options : ''}`;
      });
      const text = ['## Workspace models', lines.join('\n\n') || 'No models configured.', ...(result.issues.length ? ['## Configuration issues', ...result.issues.map(issue => `- ${issue}`)] : []), `<metadata>\nstatus: "success"\nrevision: ${result.revision}\ntruncated: false\n</metadata>`].join('\n\n');
      return { content: [{ type: 'text', text }], details: result as unknown as JsonValue, isError: false };
    },
  }, {
    definition: { name: 'validate_member_config', description: 'Validate the complete pending .rsi/members file change set. Reports create/update/delete and issues; does not commit or activate anything.', parameters: Type.Object({ path: Type.String() }, { additionalProperties: false }) },
    execute: async (args, scope) => {
      const result = await configuration.validate(scope.agentId, args.path);
      const lines = result.changes.map(change => `- ${change.type}: ${change.name} (${change.path})`);
      const issues = result.issues.map(issue => `- ${issue.path}: ${issue.code}: ${issue.message}`);
      const body = ['## Member configuration validation', result.valid ? 'Validation passed.' : 'Validation failed.', '### Changes', lines.join('\n') || 'No changes.', ...(issues.length ? ['### Issues', issues.join('\n')] : []), 'Files remain pending. Validation does not commit or activate configuration.'].join('\n\n');
      const bytes = Buffer.from(body), limit = 50 * 1024, truncated = bytes.length > limit;
      const core = truncated ? new TextDecoder().decode(bytes.subarray(0, limit), { stream: true }) + '\n\n[Report truncated. Fix listed issues and validate again; inspect the member files for full configuration.]' : body;
      return { content: [{ type: 'text', text: `${core}\n\n<metadata>\nstatus: ${JSON.stringify(result.valid ? 'success' : 'error')}\norigin: ${JSON.stringify(result.origin)}\nrevision: ${JSON.stringify(result.revision)}\ndigest: ${JSON.stringify(result.digest)}\nchange_count: ${result.changes.length}\nissue_count: ${result.issues.length}\ntruncated: ${truncated}\n</metadata>` }], details: result as unknown as JsonValue, isError: !result.valid };
    },
  }] };
}
