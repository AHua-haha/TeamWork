import { Type } from '@earendil-works/pi-ai';
import type { MemberConfigService } from './member-config.js';
import { refusing } from './tool-result.js';
import type { RuntimeTool } from './runtime.js';

export function leadTools(configuration: MemberConfigService): RuntimeTool[] {
  return [{
    definition: {
      name: 'submit_member_config',
      description: 'Validate and submit a member JSON manifest and its referenced Markdown prompts from your worktree. Use common file tools to edit .team/members/<bundle>/member.json first. Creation uses null memberId/revision; updates require the current member revision and an idle target. Only scope assignments are configurable within fixed harness bases. Existing command permissions are preserved. Returns the member ID and revision for your next edit; no draft or checkpoint activates configuration.',
      parameters: Type.Object({ path: Type.String({ description: '.team/members/<bundle>/member.json' }) }, { additionalProperties: false }),
    },
    execute: (args, scope) => refusing(async () => {
      scope.signal.throwIfAborted();
      return JSON.stringify(await configuration.submit(scope.agentId, args.path), null, 2);
    }),
  }];
}
