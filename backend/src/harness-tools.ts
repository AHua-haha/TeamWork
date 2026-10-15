import { Type, type Tool } from '@earendil-works/pi-ai';
import { createEditTool, createLsTool, createReadTool, createWriteTool } from '@earendil-works/pi-coding-agent';
import type { HarnessService } from './harness.js';
import type { RuntimeTool } from './runtime.js';
import { refusing, toolText, type ToolOutput } from './tool-result.js';

export const harnessSchema = Type.Object({
  designScope: Type.Object({ working: Type.Array(Type.String(), { maxItems: 50 }), dependencies: Type.Array(Type.String(), { maxItems: 50 }) }),
  allowedCommands: Type.Array(Type.Union([
    Type.Object({ kind: Type.Literal('exact'), argv: Type.Array(Type.String(), { minItems: 1, maxItems: 128 }) }),
    Type.Object({ kind: Type.Literal('executable'), executable: Type.String() }),
  ]), { maxItems: 50 }),
});


export function harnessFileTools(harness: HarnessService, writable: boolean): RuntimeTool[] {
  const wrap = (definition: Tool, build: (id: string) => Promise<{ execute(id: string, args: never, signal?: AbortSignal): Promise<{ content: ToolOutput['content'] }> }>): RuntimeTool => ({
    definition: { name: definition.name, description: definition.description, parameters: definition.parameters },
    async execute(args, scope, call) {
      try {
        const result = await harness.operation(scope.agentId, async () => {
          scope.signal.throwIfAborted();
          return (await build(scope.agentId)).execute(call.id, args as never, scope.signal);
        });
        return { content: result.content, isError: false };
      } catch (error) {
        scope.signal.throwIfAborted();
        return toolText(`Error: ${error instanceof Error ? error.message : 'File action failed'}`);
      }
    },
  });
  const result = [
    wrap(createLsTool('/'), async id => { const files = await harness.files(id); return createLsTool(files.root, { operations: files.ls }); }),
    wrap(createReadTool('/'), async id => { const files = await harness.files(id); return createReadTool(files.root, { operations: files.read }); }),
  ];
  if (writable) result.push(
    wrap(createWriteTool('/'), async id => { const files = await harness.files(id); return createWriteTool(files.root, { operations: files.write }); }),
    wrap(createEditTool('/'), async id => { const files = await harness.files(id); return createEditTool(files.root, { operations: files.edit }); }),
  );
  return result;
}
export function harnessCommandTool(harness: HarnessService): RuntimeTool {
  return {
    definition: { name: 'run_command', description: 'Run an allowed executable and arguments from your private worktree. Commands are matched against this harness; there is no implicit shell interpretation. Command effects are not confined by file-tool permissions in this prototype.', parameters: Type.Object({ argv: Type.Array(Type.String(), { minItems: 1, maxItems: 128, description: 'Executable followed by arguments, such as ["npm", "test"]' }) }) },
    execute: (args, scope) => refusing(async () => JSON.stringify(await harness.operation(scope.agentId, () => harness.command(scope.agentId, args.argv, scope.signal)), null, 2)),
  };
}

/** Reusable scoped operations. Actor and authority come from the harness, never tool arguments. */
export function harnessHistoryTools(harness: HarnessService): RuntimeTool[] {
  return [
    {
      definition: {
        name: 'commit_scope',
        description: 'Commit one harness part with a meaningful intent. Implementation permits agent commits. Design requires user approval and remains pending until the user accepts its exact revision. This does not merge project branches.',
        parameters: Type.Object({ part: Type.String(), message: Type.String({ minLength: 1, maxLength: 1000 }) }),
      },
      execute: (args, scope) => refusing(async () => {
        scope.signal.throwIfAborted();
        return JSON.stringify(await harness.commit(scope.agentId, String(args.part), String(args.message), { type: 'agent', memberId: scope.agentId, runId: scope.runId }), null, 2);
      }),
    },
    {
      definition: { name: 'scope_history', description: 'Read one part\'s immutable checkpoint history.', parameters: Type.Object({ part: Type.String() }) },
      execute: (args, scope) => refusing(async () => JSON.stringify(await harness.history(scope.agentId, String(args.part)), null, 2)),
    },
    {
      definition: { name: 'restore_scope', description: 'Restore one part from its history, preserving other parts and recording the restored state. This does not change the accepted revision.', parameters: Type.Object({ part: Type.String(), revision: Type.String() }) },
      execute: (args, scope) => refusing(async () => {
        scope.signal.throwIfAborted();
        return JSON.stringify(await harness.restore(scope.agentId, String(args.part), String(args.revision), { type: 'agent', memberId: scope.agentId, runId: scope.runId }), null, 2);
      }),
    },
  ];
}
