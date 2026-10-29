import {createLsTool, createFindTool, createGrepTool} from '@earendil-works/pi-coding-agent';
import {Type} from '@earendil-works/pi-ai';
import type {RuntimeTool} from '../../agent/data/index.js';
import {executeBash, parseBashInput} from './bash.js';
import {backgroundStartTimeoutMs, commandTimeoutMs} from './bash-model.js';
import {defaultPrompt} from './prompts.js';

/** Native Pi operations, unchanged. File read/write/edit belong exclusively to FileReactHarness. */
export function defaultTools(root: string, extras: RuntimeTool[] = []): RuntimeTool[] {
  const native = [createLsTool, createFindTool, createGrepTool].map(factory => {
    const tool = factory(root);
    return {definition: {name: tool.name, description: tool.description, parameters: tool.parameters},
      execute: async (args, scope, call) => ({...await tool.execute(call.id, args as never, scope.signal), isError: false})} satisfies RuntimeTool;
  });
  return [...native, bashTool(root), ...extras];
}

export function bashTool(root: string): RuntimeTool {
  return {
    definition: {
      name: 'bash',
      description: 'Run Bash in this member’s persistent host shell. cwd is optional; cd, variables and functions persist. Foreground output combines stdout/stderr. timeout is seconds (foreground default 60; background default unlimited). background starts a native job and returns job_id; manage it using jobs, wait %N and kill %N in later calls. Background output defaults to /dev/null; redirect in command to retain it. No command is retried automatically. Tool-enforced timeouts are identified in result metadata with recovery guidance. Use background execution with explicit log redirection for long-running operations. Foreground timeout/cancellation resets the shell and jobs; an explicit background timeout stops only that job. Noninteractive stdin is /dev/null. Commands run directly as the backend OS account without sandbox, design-scope restrictions or Git approval. Host HOME and installed toolchains are available. Backend secrets are not inherited. Native Git operations, including mixed and background commits, run directly.',
      parameters: Type.Object({
        command: Type.String({ minLength: 1, maxLength: 20000 }), cwd: Type.Optional(Type.String({ minLength: 1 })),
        timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 2_147_483 })), background: Type.Optional(Type.Boolean({ default: false })),
        metadata: Type.Optional(Type.Object({}, { additionalProperties: false })),
      }, { additionalProperties: false }),
    },
    execute: async (args, scope) => {
      const result = await executeBash({root, memberId: scope.agentId, request: parseBashInput(args), signal: scope.signal});
      const { output, exitCode, durationMs, truncated, timedOut, jobId, shellRestarted, error } = result;
      const failed = !!error || exitCode !== 0;
      const background = args.background === true;
      const timeoutSeconds = background ? backgroundStartTimeoutMs / 1000 : typeof args.timeout === 'number' ? args.timeout : commandTimeoutMs / 1000;
      const hints = [
        ...(timedOut ? [defaultPrompt(background ? 'bash-background-timeout' : 'bash-timeout', { timeout_seconds: String(timeoutSeconds) })] : []),
        ...(shellRestarted ? ['Member shell restarted; previous shell state and job handles are no longer available.'] : []),
        ...(truncated ? ['Output truncated: showing the last 50 KiB. Redirect to a workspace file and read selected ranges to retain more output.'] : []),
      ];
      const metadata = {
        tool: 'bash', status: failed ? 'error' : jobId ? 'started' : 'success',
        ...(jobId ? { job_id: jobId } : { exit_code: exitCode, duration_ms: durationMs, truncated }),
        ...(timedOut ? { timed_out: true, error_code: 'tool_timeout', timeout_seconds: timeoutSeconds, background, timeout_phase: background ? 'background_start' : 'foreground' } : {}),
        ...(shellRestarted ? { shell_restarted: true } : {}),
        ...(error ? { error } : {}),
      };
      const hint = hints.join('\n\n');
      const footer = `<metadata>\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}${hint ? `\n\nhint:\n${hint}` : ''}\n</metadata>`;
      return { content: [{ type: 'text', text: output ? `${output}\n\n${footer}` : footer }], details: { ...metadata, ...(hint ? { hint } : {}) }, isError: failed };
    },
  };
}
