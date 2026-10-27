import { createEditTool, createFindTool, createGrepTool, createLsTool, createReadTool, createWriteTool } from '@earendil-works/pi-coding-agent';
import { Type, type JsonObject } from '@earendil-works/pi-ai';
import { maxGroupSummaryCharacters, type GroupSummary } from '../team/data/group-summary.js';
import type { HarnessService } from './harness.js';
import type { RuntimeTool } from '../agent/contracts.js';
import { backgroundStartTimeoutMs, commandTimeoutMs } from './data/bash.js';
import { harnessPrompt } from './harness-prompts.js';
export function groupSummaryTool(submit: (text: string) => Promise<GroupSummary>): RuntimeTool {
  return {
    definition: { name: 'submit_group_summary', description: 'Submit the updated shared summary of the supplied older group context. Keep the latest 30 original messages outside the summary. If rejected, correct the summary using the tool feedback and submit again.',
      parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: maxGroupSummaryCharacters, description: 'Concise plain-text or Markdown summary of the supplied previous summary and older messages only.' }) }, { additionalProperties: false }) },
    execute: async (args: JsonObject) => {
      const result = await submit(args.summary as string);
      return { content: [{ type: 'text', text: `Group summary accepted for positions ${result.from}-${result.through}. The latest 30 original messages remain unchanged.` }],
        details: { revision: result.revision, from: result.from, through: result.through, analyzedThrough: result.analyzedThrough, retainedMessages: 30 }, isError: false };
    },
  };
}

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
      description: 'Run Bash in this member’s persistent shell. cwd is optional; cd, variables and functions persist. Foreground output combines stdout/stderr. timeout is seconds (foreground default 60; background default unlimited). background starts a native job and returns job_id; manage it using jobs, wait %N and kill %N in later calls. Background output defaults to /dev/null; redirect in command to retain it. No command is retried automatically. Tool-enforced timeouts are identified in result metadata with recovery guidance. Use background execution with explicit log redirection for long-running operations. Foreground timeout/cancellation resets the shell and jobs; an explicit background timeout stops only that job. Noninteractive stdin is /dev/null. ' + (harness.permissionsEnabled
        ? 'Sandbox permits system reads, entire workspace/workspace-temp writes and networking; Bash does not enforce design assignments. Explicit git commit checks actual contents: implementation-only runs, mixed design/member and implementation refuses, design/member-only waits for user approval. Stage intended files and use git commit [-a] -m <message>. Other Git operations are native. No checkpoints or Git scopes are managed.'
        : 'Harness permissions are disabled. Bash runs as the backend OS account, without sandbox restrictions or Git commit approval. Host HOME and installed toolchains are available. Backend secrets are not inherited. Native Git commits (including mixed and background commits) run directly. No checkpoints or Git scopes are managed.'),
      parameters: Type.Object({
        command: Type.String({ minLength: 1, maxLength: 20000 }), cwd: Type.Optional(Type.String({ minLength: 1 })),
        timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 2_147_483 })), background: Type.Optional(Type.Boolean({ default: false })),
        metadata: Type.Optional(Type.Object({}, { additionalProperties: false })),
      }, { additionalProperties: false }),
    },
    execute: async (args, scope) => {
      const result = await harness.operation(scope.agentId, () => harness.bash(scope.agentId, args, scope.signal, scope.runId));
      const { output, exitCode, durationMs, truncated, timedOut, jobId, shellRestarted, error } = result;
      const failed = !!error || exitCode !== 0;
      const background = args.background === true;
      const timeoutSeconds = background ? backgroundStartTimeoutMs / 1000 : typeof args.timeout === 'number' ? args.timeout : commandTimeoutMs / 1000;
      const hints = [
        ...(timedOut ? [harnessPrompt(background ? 'bash-background-timeout' : 'bash-timeout', { timeout_seconds: String(timeoutSeconds) })] : []),
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
