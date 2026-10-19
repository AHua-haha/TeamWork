import { Type } from '@earendil-works/pi-ai';
import { createEditTool, createFindTool, createGrepTool, createLsTool, createReadTool, createWriteTool } from '@earendil-works/pi-coding-agent';
import type { HarnessService } from './harness.js';
import type { RuntimeTool } from './runtime.js';

/** Pi owns schemas, operations and results. Harness checks invocation inputs only. */
export function harnessFileTools(harness: HarnessService, writable: boolean): RuntimeTool[] {
  const factories = [createLsTool, createReadTool, createGrepTool, createFindTool, ...(writable ? [createWriteTool, createEditTool] : [])];
  return factories.map(factory => {
    const tool = factory('/');
    return {
      definition: { name: tool.name, description: tool.description, parameters: tool.parameters },
      execute: (args, scope, call) => harness.operation(scope.agentId, async () => {
        scope.signal.throwIfAborted();
        const { root, path } = await harness.fileInvocation(scope.agentId, tool.name, typeof args.path === 'string' ? args.path : '.');
        const result = await factory(root).execute(call.id, { ...args, path } as never, scope.signal);
        return { ...result, isError: false };
      }),
    };
  });
}
export function harnessBashTool(harness: HarnessService): RuntimeTool {
  return {
    definition: {
      name: 'bash',
      description: 'Run Bash in this member’s persistent shell. cwd is optional; cd, variables and functions persist. Foreground output combines stdout/stderr. timeout is seconds (foreground default 60; background default unlimited). background starts a native job and returns job_id; manage it using jobs, wait %N and kill %N in later calls. Background output defaults to /dev/null; redirect in command to retain it. Sandbox permits system reads, entire workspace/workspace-temp writes and networking; Bash does not enforce design assignments. metadata.git.scope optionally routes ordinary git through the listed controlled scope; without it Git is native project Git. Scoped design/member commits still require user acceptance. No command is retried automatically. Foreground timeout/cancellation resets the shell and jobs; an explicit background timeout stops only that job. Noninteractive stdin is /dev/null.',
      parameters: Type.Object({
        command: Type.String({ minLength: 1, maxLength: 20000 }), cwd: Type.Optional(Type.String({ minLength: 1 })),
        timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 2_147_483 })), background: Type.Optional(Type.Boolean({ default: false })),
        metadata: Type.Optional(Type.Object({ git: Type.Optional(Type.Object({ scope: Type.String({ minLength: 1 }) }, { additionalProperties: false })) }, { additionalProperties: false })),
      }, { additionalProperties: false }),
    },
    execute: async (args, scope) => {
      const result = await harness.operation(scope.agentId, () => harness.bash(scope.agentId, args, scope.signal, scope.runId));
      const { output, exitCode, durationMs, truncated, timedOut, jobId, shellRestarted, error } = result;
      const failed = !!error || exitCode !== 0;
      const metadata = { status: failed ? 'error' : jobId ? 'started' : 'success', ...(jobId ? { job_id: jobId } : { exit_code: exitCode, duration_ms: durationMs, truncated }), ...(timedOut ? { timed_out: true } : {}), ...(shellRestarted ? { shell_restarted: true } : {}) };
      const notice = truncated ? '\n\n[Output truncated: showing the last 50 KiB. Redirect to a workspace file and read selected ranges to retain more output.]' : '';
      const text = [shellRestarted ? 'Member shell restarted; previous shell state and job handles are no longer available.' : '', jobId ? 'Started background command.' : output || '(no output)', error ?? ''].filter(Boolean).join('\n');
      return { content: [{ type: 'text', text: `${text}${notice}\n\n<metadata>\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n</metadata>` }], details: metadata, isError: failed };
    },
  };
}
