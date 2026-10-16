import { Type, type Tool } from '@earendil-works/pi-ai';
import { createEditTool, createLsTool, createReadTool, createWriteTool } from '@earendil-works/pi-coding-agent';
import type { HarnessService } from './harness.js';
import type { RuntimeTool } from './runtime.js';
import { refusing, toolText, type ToolOutput } from './tool-result.js';

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
/** The same Bash capability is reusable across all agents; harness supplies policy. */
export function harnessBashTool(harness: HarnessService): RuntimeTool {
  return {
    definition: { name: 'bash', description: 'Execute Bash in your harness environment. Scoped Git requires metadata.git.scope (design, member-config or implementation). Use ordinary git status/diff/add/log/show/restore/commit. General commands require execute-harness allowance. Protected management commits require user review. Member-file commits do not activate configuration.', parameters: Type.Object({ command: Type.String({ minLength: 1, maxLength: 20000 }), metadata: Type.Optional(Type.Object({ git: Type.Object({ scope: Type.String() }, { additionalProperties: false }) }, { additionalProperties: false })) }, { additionalProperties: false }) },
    execute: (args, scope) => refusing(async () => JSON.stringify(await harness.operation(scope.agentId, () => harness.bash(scope.agentId, args, scope.signal, scope.runId)), null, 2)),
  };
}
