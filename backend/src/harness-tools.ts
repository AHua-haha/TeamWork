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
        const result = await (await build(scope.agentId)).execute(call.id, args as never, scope.signal);
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
    definition: { name: 'run_command', description: 'Run an allowed executable and arguments from the workspace directory. Commands are matched against this harness; there is no implicit shell interpretation. Command effects are not confined by file-tool permissions in this prototype.', parameters: Type.Object({ argv: Type.Array(Type.String(), { minItems: 1, maxItems: 128, description: 'Executable followed by arguments, such as ["npm", "test"]' }) }) },
    execute: (args, scope) => refusing(async () => JSON.stringify(await harness.command(scope.agentId, args.argv, scope.signal), null, 2)),
  };
}
