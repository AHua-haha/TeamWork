import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import { HarnessQueue } from './harness-history.js';
import { AppError } from './types.js';

export const commandTimeoutMs = 60_000;
export const commandOutputBytes = 64 * 1024;
export interface CommandResult { exitCode: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }
export interface BashInput { command: string; metadata?: { git: { scope: string } } }
export function parseBashInput(value: unknown): BashInput {
  const data = value as BashInput;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['command', 'metadata'].includes(k)) || typeof data.command !== 'string' || !data.command.trim() || data.command.length > 20000 || data.command.includes('\0')) throw new AppError('invalid_input', 'Bash takes command and optional metadata.git.scope');
  if (data.metadata !== undefined) {
    const metadata = data.metadata, git = metadata?.git;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).some(k => k !== 'git') || !git || typeof git !== 'object' || Array.isArray(git) || Object.keys(git).some(k => k !== 'scope') || typeof git.scope !== 'string' || !git.scope) throw new AppError('invalid_input', 'Git metadata selects a scope only; authority is backend-owned');
  }
  return data;
}

/** Process lifecycle only. Harness Bash always invokes this with an OS-sandboxed command. */
export function executeCommand(directory: string, argv: string[], signal: AbortSignal, timeoutMs = commandTimeoutMs, env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(argv[0]!, argv.slice(1), { cwd: directory, env, shell: false, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    let used = 0, truncated = false, timedOut = false, finished = false;
    let stopping: Promise<void> | undefined;
    const kill = (name: NodeJS.Signals) => { try { if (grouped && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch { /* Process group already ended. */ } };
    const stop = () => { kill('SIGTERM'); stopping ??= new Promise<void>(done => setTimeout(() => { kill('SIGKILL'); done(); }, 100)); };
    const abort = () => stop();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);timer.unref();
    const cleanup = () => { clearTimeout(timer);signal.removeEventListener('abort', abort);finished = true; };
    for (const name of ['stdout', 'stderr'] as const) child[name].on('data', (chunk: Buffer) => {
      const keep = Math.max(0, Math.min(chunk.length, commandOutputBytes - used));
      if (keep) output[name].push(Buffer.from(chunk.subarray(0, keep)));
      used += keep;if (keep < chunk.length) truncated = true;
    });
    child.once('error', error => { if (!finished) { cleanup();reject(new AppError('command_failed', error.message)); } });
    child.once('close', async (exitCode, exitSignal) => {
      if (finished) return;
      cleanup();stop();await stopping; // Descendants cannot outlive a completed Bash action.
      if (signal.aborted) { reject(signal.reason);return; }
      resolve({ exitCode, signal: exitSignal, stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8'), timedOut, truncated });
    });
  });
}

interface BashEnvironment {
  root: string; command: string; readable: string[]; writable: string[]; readonly: string[]; signal: AbortSignal;
  git?: (args: string[], cwd: string) => Promise<string>;
}
const wrapping = new HarnessQueue();
const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** Real Bash, OS filesystem/network isolation, and an invocation-bound Git bridge. */
export async function executeBash(environment: BashEnvironment): Promise<CommandResult> {
  const { root, signal } = environment;
  if (!['darwin', 'linux'].includes(process.platform)) throw new AppError('sandbox_unavailable', 'Harness Bash requires macOS sandbox-exec or Linux bubblewrap', 503);
  if (process.platform === 'linux') {
    const deps = await SandboxManager.checkDependenciesAsync();
    if (deps.errors.length) throw new AppError('sandbox_unavailable', deps.errors.join('; '), 503);
  }
  const area = await realpath(await mkdtemp(join(tmpdir(), 'rsi-bash-'))), scratch = join(area, 'tmp'), socketPath = join(area, 'git.sock');
  await mkdir(scratch);
  const pending = new Set<Promise<void>>(), clients = new Set<import('node:net').Socket>();
  let closing = false;
  const server = createServer(socket => {
    clients.add(socket);socket.once('close', () => clients.delete(socket));socket.on('error', () => socket.destroy());
    let bytes = '', handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      bytes += chunk.toString();
      if (Buffer.byteLength(bytes) > 65536) { handled = true;socket.destroy();return; }
      const newline = bytes.indexOf('\n');if (newline < 0) return;handled = true;
      const operation = (async () => {
        try {
          signal.throwIfAborted();
          if (closing || !environment.git) throw new AppError('command_denied', 'Git requires metadata.git.scope', 403);
          const request = JSON.parse(bytes.slice(0, newline));
          if (!Array.isArray(request.argv) || request.argv.length > 128 || request.argv.some((v: unknown) => typeof v !== 'string') || typeof request.cwd !== 'string') throw new AppError('invalid_input', 'Invalid Git invocation');
          const cwd = await realpath(request.cwd), path = relative(root, cwd);
          if (isAbsolute(path) || path === '..' || path.startsWith('../')) throw new AppError('access_denied', 'Git working directory must stay in this member worktree', 403);
          const stdout = await environment.git(request.argv, cwd);
          socket.end(JSON.stringify({ stdout, stderr: '', code: 0 }) + '\n');
        } catch (error) {
          socket.end(JSON.stringify({ stdout: '', stderr: `${error instanceof AppError ? error.code : 'git_error'}: ${error instanceof Error ? error.message : 'Git failed'}\n`, code: 1 }) + '\n');
        }
      })();
      pending.add(operation);void operation.finally(() => pending.delete(operation));
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject);server.listen(socketPath, resolve); });
    const proxy = `#!${process.execPath}\nimport {connect} from 'node:net';\nconst client=connect(${JSON.stringify(socketPath)});let raw='';client.on('connect',()=>client.write(JSON.stringify({argv:process.argv.slice(2),cwd:process.env.PWD})+'\\n'));client.on('data',data=>{raw+=data;const end=raw.indexOf('\\n');if(end<0)return;const result=JSON.parse(raw.slice(0,end));process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.code;client.end();});client.on('error',()=>{process.stderr.write('Git context is unavailable\\n');process.exitCode=1;});\n`;
    // The script is an .mjs target because Node's module mode cannot depend on the worktree package.json.
    await writeFile(join(area, 'git.mjs'), proxy.split('\n').slice(1).join('\n'), { mode: 0o400 });
    await writeFile(join(area, 'git'), `#!/bin/bash\nexec ${quote(process.execPath)} ${quote(join(area, 'git.mjs'))} "$@"\n`, { mode: 0o500 });
    const atRoot = (path: string) => path === '.' ? root : join(root, path);
    const protectedPaths = ['.git', '.rsi', ...environment.readonly].map(atRoot);
    const config: SandboxRuntimeConfig = {
      network: { allowedDomains: [], deniedDomains: [], allowUnixSockets: [socketPath], allowAllUnixSockets: process.platform === 'linux' },
      filesystem: {
        denyRead: ['/', ...['.git', '.rsi'].map(atRoot)],
        allowRead: ['/bin', '/usr', '/sbin', '/System', '/Library', '/private/etc', '/etc', '/dev', dirname(dirname(process.execPath)), area, ...environment.readable.map(atRoot)],
        allowWrite: [scratch, ...environment.writable.map(atRoot)],
        denyWrite: protectedPaths,
      },
    };
    const wrapped = await wrapping.run('profile', async () => {
      SandboxManager.updateConfig(config);
      return SandboxManager.wrapWithSandbox(environment.command, '/bin/bash', config, signal);
    });
    return await executeCommand(root, ['/bin/bash', '--noprofile', '--norc', '-c', wrapped], signal, commandTimeoutMs,
      { PATH: `${area}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, LANG: 'en_US.UTF-8', TMPDIR: scratch });
  } finally {
    closing = true;
    await Promise.allSettled([...pending]);
    for (const client of clients) client.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(area, { recursive: true, force: true });
  }
}
