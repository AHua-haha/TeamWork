import { Type } from '@earendil-works/pi-ai';
import type { LeadService } from './lead.js';
import { refusing } from './tool-result.js';
import { harnessSchema } from './harness-tools.js';
import type { RuntimeTool } from './runtime.js';

/** User-visible design changes and assignments, available only to the lead. */
export function leadTools(lead: LeadService): RuntimeTool[] {
  return [
    {
      definition: {
        name: 'read_design',
        description: 'Read a current user design file, including its stored revision. Use that revision with save_design to update it without overwriting another edit.',
        parameters: Type.Object({ path: Type.String({ description: 'User-context design file path, such as user/design.json' }) }),
      },
      execute: (args, scope) => refusing(async () => {
        scope.signal.throwIfAborted();
        return JSON.stringify(await lead.readDesign(scope.agentId, args.path), null, 2);
      }),
    },
    {
      definition: {
        name: 'save_design',
        description: 'Create or update a user design file after discussing the change with the user. Use read_design for existing content and its revision first. The user sees the exact change; explain it in your reply. Ask about unsettled choices before saving.',
        parameters: Type.Object({
          path: Type.String({ description: 'User-context design path, such as user/design.json or .context/user/design/backend.json' }),
          content: Type.String({ description: 'Complete resulting design content' }),
          implementation: Type.Array(Type.String(), { maxItems: 50, description: 'Corresponding project files or directories; "." names the project root.' }),
          baseRevision: Type.Union([Type.String(), Type.Null()], { description: 'Revision read from the context base; null only to create a new file' }),
          reason: Type.String({ minLength: 1, maxLength: 1000, description: 'What the user requested or chose and why this design changes' }),
        }),
      },
      execute: (args, scope) => refusing(async () => {
        scope.signal.throwIfAborted();
        const saved = await lead.saveDesign(scope.agentId, scope.runId, {
          path: args.path, content: args.content, implementation: args.implementation, baseRevision: args.baseRevision, reason: args.reason,
        });
        return JSON.stringify({ status: saved.seq === null ? 'unchanged' : saved.created ? 'created' : 'updated', ...saved }, null, 2);
      }),
    },
    {
      definition: {
        name: 'configure_harness',
        description: 'Configure a member\'s working and dependency designs and allowed commands. Working design is read-only and its implementation is editable; dependencies are read-only. You may configure your own harness without changing your model.',
        parameters: Type.Object({ to: Type.String(), harness: harnessSchema }),
      },
      execute: (args, scope) => refusing(async () => JSON.stringify(await lead.configureHarness(scope.agentId, args.to, args.harness), null, 2)),
    },
    {
      definition: {
        name: 'assign_member',
        description: 'Assign work under the worker\'s configured working and dependency designs. Configure the member and its harness first. The worker runs while you wait and returns its final report.',
        parameters: Type.Object({
          to: Type.String({ description: 'Name of the worker' }),
          text: Type.String({ minLength: 1, description: 'Objective, expected result, and work to do under the design' }),
        }),
      },
      execute: (args, scope) => refusing(() => lead.assign(scope.agentId, scope.runId, scope.signal, {
        to: args.to, text: args.text,
      })),
    },
  ];
}
