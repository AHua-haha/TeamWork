import { backgroundStartTimeoutMs, commandTimeoutMs, commandOutputBytes, parseBashInput, type BashInput, type CommandResult } from './bash-model.js';
export { commandTimeoutMs, commandOutputBytes, parseBashInput, type BashInput, type CommandResult } from './bash-model.js';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { randomInt, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { OperationQueue } from '../../operation-queue.js';
import {AppError} from '../../errors.js';
import { hostShellEnvironment } from './shell-environment.js';

interface BashEnvironment { memberId: string; root: string; request: BashInput; signal: AbortSignal }
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const queues = new OperationQueue();
const sessions = new Map<string, Promise<MemberShell>>();
const restarted = new Set<string>();
const keyFor = (root: string, member: string) => `${root}\0${member}`;
const runFile = promisify(execFile);

/** Snapshot descendants before signalling; job-control creates additional process groups. */
async function descendants(root: number): Promise<{ pid: number; ppid: number; group: number }[]> {
  const { stdout } = await runFile('/bin/ps', ['-axo', 'pid=,ppid=,pgid='], { maxBuffer: 4 * 1024 * 1024 });
  const rows = stdout.trim().split('\n').map(line => {
    const [pid, ppid, group] = line.trim().split(/\s+/).map(Number);
    return { pid: pid!, ppid: ppid!, group: group! };
  });
  const found = new Set([root]);
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (found.has(row.ppid) && !found.has(row.pid)) { found.add(row.pid); changed = true; } }
  return rows.filter(row => found.has(row.pid));
}
function send(target: number, signal: NodeJS.Signals) { try { process.kill(target, signal); } catch { /* Already exited. */ } }

interface Pending {
  prefix: string; buffer: string; text: string; bytes: number; truncated: boolean; started: number;
  resolve: (result: CommandResult & { pid?: number; jobs?: number[] }) => void;
}
/** A pipe-fed Bash, with one output pipe and an invocation-specific completion frame. */
class MemberShell {
  private child!: ChildProcessWithoutNullStreams;
  private pending?: Pending;
  private decoder = new StringDecoder('utf8');
  private dead = false;
  private stopping?: Promise<void>;
  private timers = new Map<number, NodeJS.Timeout>();
  private jobPids = new Set<number>();
  // Use a high descriptor, leaving ordinary script descriptors (e.g. flock 9)
  // available, while supporting the system Bash 3.2 shipped with macOS.
  private control = randomInt(100, 240);
  constructor(readonly memberId: string, readonly root: string) {}
  get alive() { return !this.dead; }

  async open(signal: AbortSignal) {
    const env = hostShellEnvironment();
    signal.throwIfAborted();
    this.child = spawn('/bin/bash', ['--noprofile', '--norc'], { cwd: this.root, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => { /* exit event settles an in-flight invocation */ });
    this.child.stdout.on('data', b => this.consume(this.decoder.write(b)));
    this.child.stderr.on('data', b => this.consume(b.toString()));
    this.child.once('error', error => this.exited(error.message));
    this.child.once('exit', (code, sig) => this.exited(`Shell exited (${sig ?? code}); its jobs and shell state have been reset`));
    const setup = `exec ${this.control}>&1 2>&1\nset -m`;
    const result = await this.invoke(setup, false, undefined, signal, 10_000);
    if (result.exitCode !== 0) throw new AppError('shell_unavailable', result.output || result.error || 'Could not start member shell', 503);
  }
  private append(text: string) {
    const p = this.pending; if (!p || !text) return;
    const size = Buffer.byteLength(text); p.bytes += size;
    const buffer = Buffer.from(p.text + text);
    if (buffer.length > commandOutputBytes) { p.truncated = true; p.text = buffer.subarray(buffer.length - commandOutputBytes).toString('utf8').replace(/^\uFFFD/, ''); }
    else p.text += text;
  }
  private consume(text: string) {
    const p = this.pending; if (!p) return;
    p.buffer += text;
    const start = p.buffer.indexOf(p.prefix);
    if (start < 0) {
      const keep = p.prefix.length;
      if (p.buffer.length > keep) { this.append(p.buffer.slice(0, -keep)); p.buffer = p.buffer.slice(-keep); }
      return;
    }
    this.append(p.buffer.slice(0, start)); p.buffer = p.buffer.slice(start);
    const end = p.buffer.indexOf('\x1f', p.prefix.length);
    if (end < 0) return;
    const [exit, job, pid, jobs] = p.buffer.slice(p.prefix.length, end).split(':');
    this.pending = undefined;
    p.resolve({ output: p.text, exitCode: Number(exit), durationMs: Date.now() - p.started, truncated: p.truncated, timedOut: false,
      ...(Number(job) > 0 ? { jobId: Number(job) } : {}), ...(Number(pid) > 0 ? { pid: Number(pid) } : {}), jobs: (jobs ?? '').trim().split(/\s+/).filter(Boolean).map(Number) });
  }
  private exited(error: string) {
    this.dead = true;
    const p = this.pending;
    if (p) { this.append(p.buffer); this.pending = undefined; p.resolve({ output: p.text, exitCode: null, error, durationMs: Date.now() - p.started, truncated: p.truncated, timedOut: false }); }
    queueMicrotask(() => { void this.stop(); });
  }
  private async invoke(command: string, background: boolean, cwd: string | undefined, signal: AbortSignal, timeout: number): Promise<CommandResult & { pid?: number; jobs?: number[] }> {
    signal.throwIfAborted();
    const id = randomUUID().replaceAll('-', ''), variable = `__rsi_${id}`;
    const prefix = `\x1eRSI_${id}:`;
    const commandBody = background
      ? `builtin eval -- ${quote(command)} </dev/null >/dev/null 2>&1 &\n${variable}_pid=$!\n${variable}_job=$(builtin jobs -l %+)\n${variable}_job=\${${variable}_job%%]*}\n${variable}_job=\${${variable}_job#\\[}\n${variable}_exit=0`
      : `builtin eval -- ${quote(command)} </dev/null\n${variable}_exit=$?\n${variable}_job=0\n${variable}_pid=0`;
    const body = `${cwd === undefined ? commandBody : `if builtin cd -- ${quote(cwd)}; then\n${commandBody}\nelse\n${variable}_exit=$?\n${variable}_job=0\n${variable}_pid=0\nfi`}\n${variable}_jobs=$(builtin jobs -p)\nbuiltin printf '\\036RSI_${id}:%s:%s:%s:%s\\037' "$${variable}_exit" "$${variable}_job" "$${variable}_pid" "$${variable}_jobs" >&${this.control}\nunset ${variable}_exit ${variable}_job ${variable}_pid ${variable}_jobs\n`;
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const arm = () => {timer=setTimeout(()=>{timedOut=true;void this.stop();},timeout);timer.unref();};
    const abort = () => { void this.stop(); };
    signal.addEventListener('abort', abort, { once: true });
    const result = new Promise<CommandResult & { pid?: number; jobs?: number[] }>(resolve => {
      this.pending = { prefix, buffer: '', text: '', bytes: 0, truncated: false, started: Date.now(), resolve };
      arm();
      this.child.stdin.write(body);
      if (signal.aborted) abort();
    });
    try {
      const value = await result;
      if (timedOut || signal.aborted) await this.stop();
      signal.throwIfAborted();
      return timedOut ? { ...value, timedOut: true, exitCode: null, error: 'Command timed out; the member shell and its jobs were stopped' } : value;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  async run(request: BashInput, signal: AbortSignal): Promise<CommandResult> {
    const result = await this.invoke(request.command, request.background ?? false, request.cwd, signal, request.background ? backgroundStartTimeoutMs : (request.timeout === undefined ? commandTimeoutMs : request.timeout * 1000));
    if (!this.alive) await this.stop();
    for (const [pid, timer] of this.timers) if (!result.jobs?.includes(pid)) { clearTimeout(timer); this.timers.delete(pid); }
    for (const pid of this.jobPids) if (!result.jobs?.includes(pid)) this.jobPids.delete(pid);
    if (result.jobId && result.pid) {
      this.jobPids.add(result.pid);
      if (request.timeout !== undefined) {
        const pid = result.pid;
        const timer = setTimeout(() => { void this.stopJob(pid).catch(() => this.stop()); this.timers.delete(pid); }, request.timeout * 1000); timer.unref(); this.timers.set(pid, timer);
      }
    }
    const { pid: _pid, jobs: _jobs, ...visible } = result;
    return visible;
  }
  private async stopJob(pid: number) {
    if (!this.child?.pid || this.dead) return;
    const rows = await descendants(this.child.pid);
    // Do not signal an unrelated process if an old job PID has been reused.
    if (rows.some(row => row.pid === pid && row.group === pid)) { send(-pid, 'SIGTERM'); await new Promise(resolve => setTimeout(resolve, 100)); send(-pid, 'SIGKILL'); }
  }
  stop(): Promise<void> {
    return this.stopping ??= this.shutdown();
  }
  private async shutdown() {
    this.dead = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.child?.pid) {
      const rows = await descendants(this.child.pid).catch(() => []);
      const groups = new Set([this.child.pid, ...rows.map(row => row.group), ...this.jobPids]);
      for (const group of groups) send(-group, 'SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 100));
      for (const group of groups) send(-group, 'SIGKILL');
      send(this.child.pid, 'SIGKILL');
      if (this.child.exitCode === null && this.child.signalCode === null) await new Promise<void>(resolve => this.child.once('exit', () => resolve()));
    }
    this.exited('Member shell was stopped; shell state and jobs have been reset');
    this.jobPids.clear();

  }
}

export async function executeBash(environment: BashEnvironment): Promise<CommandResult> {
  const { memberId, request, signal } = environment;
  const root = await realpath(environment.root), key = keyFor(root, memberId);
  return queues.run(key, async () => {
    signal.throwIfAborted();
    let opening = sessions.get(key), shell = opening ? await opening : undefined;
    if (shell && !shell.alive) { await shell.stop(); sessions.delete(key); restarted.add(key); shell = undefined; opening = undefined; }
    if (!shell) {
      const fresh = new MemberShell(memberId, root);
      opening = fresh.open(signal).then(() => fresh).catch(async error => { await fresh.stop(); sessions.delete(key); throw error; });
      sessions.set(key, opening); shell = await opening;
    }
    const reset = restarted.delete(key);
    const result = await shell.run(request, signal);
    return reset ? { ...result, shellRestarted: true } : result;
  });
}
export async function resetMemberShell(memberId: string, root?: string) {
  if (root) root = await realpath(root).catch(() => root!);
  for (const [key, opening] of sessions) if (key.endsWith(`\0${memberId}`) && (!root || key === keyFor(root, memberId))) {
    const shell = await opening.catch(() => undefined);
    if (shell) await shell.stop();
    if (sessions.get(key) === opening) sessions.delete(key);
    restarted.add(key);
  }
}
export async function closeBashRuntime() {
  await Promise.allSettled([...sessions.values()].map(async opening => (await opening).stop()));
  sessions.clear(); restarted.clear();
}
