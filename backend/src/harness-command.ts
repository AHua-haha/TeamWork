import { spawn } from 'node:child_process';
import { AppError } from './types.js';

export const commandTimeoutMs = 60_000;
export const commandOutputBytes = 64 * 1024;
export interface CommandResult { exitCode: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }

/** Executable and arguments are passed directly. File-scope isolation of command effects is deferred. */
export function executeCommand(directory: string, argv: string[], signal: AbortSignal, timeoutMs = commandTimeoutMs): Promise<CommandResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(argv[0]!, argv.slice(1), { cwd: directory, shell: false, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    let used = 0, truncated = false, timedOut = false, finished = false;
    let stopping: Promise<void> | undefined;
    const kill = (name: NodeJS.Signals) => {
      try { if (grouped && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch { /* Already stopped. */ }
    };
    const stop = () => {
      kill('SIGTERM');
      stopping ??= new Promise<void>(resolve => { setTimeout(() => { kill('SIGKILL'); resolve(); }, 250); });
    };
    const abort = () => stop();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    timer.unref();
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); finished = true; };
    for (const name of ['stdout', 'stderr'] as const) child[name].on('data', (chunk: Buffer) => {
      const keep = Math.max(0, Math.min(chunk.length, commandOutputBytes - used));
      if (keep) output[name].push(Buffer.from(chunk.subarray(0, keep)));
      used += keep;
      if (keep < chunk.length) truncated = true;
    });
    child.once('error', error => { if (!finished) { cleanup(); reject(new AppError('command_failed', error.message)); } });
    child.once('close', async (exitCode, exitSignal) => {
      if (finished) return;
      cleanup();
      // The parent may close before its descendants. Finish group termination before checkpointing.
      await stopping;
      if (signal.aborted) { reject(signal.reason); return; }
      resolve({ exitCode, signal: exitSignal, stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8'), timedOut, truncated });
    });
  });
}
