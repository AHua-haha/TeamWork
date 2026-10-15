import { Type } from '@earendil-works/pi-ai';
import type { LeadService } from './lead.js';
import { refusing } from './tool-result.js';
import { harnessSchema } from './harness-tools.js';
import type { RuntimeTool } from './runtime.js';

/** Existing harness assignment configuration; design edits use the common harness file tools. */
export function leadTools(lead: LeadService): RuntimeTool[] {
  return [
    {
      definition: {
        name: 'configure_harness',
        description: 'Configure a member\'s working and dependency designs and allowed commands. Working design and implementation are editable in the member worktree; design commits need user approval. Dependencies are read-only. You may configure your own harness without changing your model.',
        parameters: Type.Object({ to: Type.String(), harness: harnessSchema }),
      },
      execute: (args, scope) => refusing(async () => JSON.stringify(await lead.configureHarness(scope.agentId, args.to, args.harness), null, 2)),
    },
  ];
}
