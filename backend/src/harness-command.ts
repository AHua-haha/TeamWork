import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { randomInt, randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { SandboxManager, getDefaultWritePaths, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import { OperationQueue } from './workspace-git.js';
import { AppError } from './types.js';
import { closeExecutionResources, executionResources, hostShellEnvironment } from './harness-execution.js';

export const commandTimeoutMs = 60_000;
export const commandOutputBytes = 50 * 1024;
export interface BashInput { command: string; cwd?: string; timeout?: number; background?: boolean; metadata?: Record<string, unknown> }
export interface CommandResult {
  output: string; exitCode: number | null; durationMs: number; truncated: boolean;
  timedOut: boolean; jobId?: number; shellRestarted?: boolean; error?: string;
}
export type GitExecutor = (args:string[],env:NodeJS.ProcessEnv)=>Promise<{output:string;code:number}>;
type GitOperation = (args: string[], cwd: string, env: NodeJS.ProcessEnv, onWait: (waiting: boolean) => void, signal: AbortSignal, execute: GitExecutor) => Promise<{output: string; code: number}>;
interface BashEnvironment { memberId: string; root: string; request: BashInput; signal: AbortSignal; git?: GitOperation; permissionsEnabled?: boolean }
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function parseBashInput(value: unknown): BashInput {
  if (!object(value) || Object.keys(value).some(k => !['command', 'cwd', 'timeout', 'background', 'metadata'].includes(k)) || typeof value.command !== 'string' || !value.command.trim() || value.command.length > 20000 || value.command.includes('\0')) throw new AppError('invalid_input', 'Bash requires command and optional cwd, timeout, background and metadata');
  if (value.cwd !== undefined && (typeof value.cwd !== 'string' || !value.cwd || value.cwd.includes('\0'))) throw new AppError('invalid_input', 'cwd must be a nonempty path');
  if (value.timeout !== undefined && (typeof value.timeout !== 'number' || !Number.isFinite(value.timeout) || value.timeout <= 0 || value.timeout > 2_147_483)) throw new AppError('invalid_input', 'timeout must be positive seconds, at most 2147483');
  if (value.background !== undefined && typeof value.background !== 'boolean') throw new AppError('invalid_input', 'background must be boolean');
  if (value.metadata !== undefined) {
    if (!object(value.metadata) || Object.keys(value.metadata).length) throw new AppError('invalid_input', 'No Bash metadata fields are currently defined; git.scope is retired');
  }
  return value as unknown as BashInput;
}

const wrapping = new OperationQueue(), queues = new OperationQueue();
const sessions = new Map<string, Promise<MemberShell>>();
const restarted = new Set<string>();
let initialized: Promise<void> | undefined;
const keyFor = (root: string, member: string) => `${root}\0${member}`;
const inside = (root: string, path: string) => { const r = relative(root, path); return !isAbsolute(r) && r !== '..' && !r.startsWith('../'); };
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
  waiting?: (waiting: boolean) => void;
  resolve: (result: CommandResult & { pid?: number; jobs?: number[] }) => void;
}
/** A pipe-fed Bash, with one output pipe and an invocation-specific completion frame. */
class MemberShell {
  private child!: ChildProcessWithoutNullStreams;
  private pending?: Pending;
  private decoder = new StringDecoder('utf8');
  private dead = false;
  private stopping?: Promise<void>;
  private server!: Server;
  private clients = new Set<Socket>();
  private gitCalls = new Map<string, { git: GitOperation }>();
  private brokerAbort = new AbortController();
  private timers = new Map<number, NodeJS.Timeout>();
  private jobPids = new Set<number>();
  private brokerOperations = new Set<Promise<void>>();
  private home = '';
  private socketPath = '';
  private profile!: SandboxRuntimeConfig;
  private nativeGit='';
  private shellEnv:NodeJS.ProcessEnv={};
  // Use a high descriptor, leaving ordinary script descriptors (e.g. flock 9)
  // available, while supporting the system Bash 3.2 shipped with macOS.
  private control = randomInt(100, 240);
  constructor(readonly memberId: string, readonly root: string, readonly permissionsEnabled: boolean) {}
  get alive() { return !this.dead; }

  async open(signal: AbortSignal) {
    let wrapped = 'exec /bin/bash --noprofile --norc';
    let env = hostShellEnvironment();
    if (this.permissionsEnabled) {
      if (!['darwin', 'linux'].includes(process.platform)) throw new AppError('sandbox_unavailable', 'Bash requires macOS sandbox-exec or Linux bubblewrap', 503);
      if (process.platform === 'linux') { const deps = await SandboxManager.checkDependenciesAsync(); if (deps.errors.length) throw new AppError('sandbox_unavailable', deps.errors.join('; '), 503); }
      const resources = await executionResources(this.root), shell = await resources.shell();
      this.shellEnv=shell.env;
      this.home = shell.home; this.socketPath = join(this.home, 'git.sock');
      await this.openBroker();
      const bridge = join(this.home, 'git.mjs');
      const nativeGit = this.nativeGit = (await runFile('/usr/bin/which', ['git'])).stdout.trim();
      await writeFile(bridge, `import {connect} from 'node:net';
const argv=process.argv.slice(2);let n=0;while(argv[n]==='-C')n+=2;
if(argv[n]!=='commit'&&!argv.includes('commit')){const {spawnSync}=await import('node:child_process');const r=spawnSync(${JSON.stringify(nativeGit)},argv,{stdio:'inherit'});process.exit(r.status??1);}
const allowed=['HOME','PATH','LANG','LC_ALL','GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_AUTHOR_DATE','GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL','GIT_COMMITTER_DATE'];
const invalid=['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_NAMESPACE'].filter(k=>process.env[k]!==undefined);
const env=Object.fromEntries(allowed.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
const s=connect(${JSON.stringify(this.socketPath)});let raw='';s.on('connect',()=>s.write(JSON.stringify({token:process.env.RSI_COMMIT_TOKEN,argv,cwd:process.cwd(),env,invalid})+'\\n'));s.on('data',b=>{raw+=b;const n=raw.indexOf('\\n');if(n<0)return;const r=JSON.parse(raw.slice(0,n));process.stdout.write(r.output);process.exitCode=r.code;s.end();});s.on('error',()=>{process.stderr.write('Git approval session unavailable; commit not executed\\n');process.exitCode=1;});`);
      await writeFile(join(this.home, '.local/bin/git'), `#!/bin/bash\nif [[ -n "\${RSI_COMMIT_TOKEN:-}" ]]; then exec ${quote(process.execPath)} ${quote(bridge)} "$@"; else exec ${quote(nativeGit)} "$@"; fi\n`, { mode: 0o700 });
      // Remove SRT convenience write grants outside this workspace's resource area.
      const denyWrite = getDefaultWritePaths().filter(p => !p.startsWith('/dev/') && !inside(this.root, p) && !inside(resources.area, p));
      const config: SandboxRuntimeConfig = {
        filesystem: { denyRead: [], allowWrite: [{ path: this.root, literal: true }, { path: resources.area, literal: true }], denyWrite },
        network: { allowedDomains: ['*'], deniedDomains: [], allowLocalBinding: true, allowUnixSockets: [this.socketPath], allowAllUnixSockets: process.platform === 'linux', allowMachLookup: ['com.apple.SystemConfiguration.DNSConfiguration'] },
      };
      this.profile=config;
      wrapped = await wrapping.run('profile', async () => {
        initialized ??= SandboxManager.initialize(config);
        try { await initialized; } catch (error) { initialized = undefined; throw error; }
        // Filesystem overrides are per-wrap, but SRT reads socket allowances
        // from its global config while generating each immutable OS profile.
        SandboxManager.updateConfig(config);
        return SandboxManager.wrapWithSandbox('exec /bin/bash --noprofile --norc', '/bin/bash', config, signal);
      });
      env = shell.env;
    }
    signal.throwIfAborted();
    this.child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', wrapped], { cwd: this.root, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => { /* exit event settles an in-flight invocation */ });
    this.child.stdout.on('data', b => this.consume(this.decoder.write(b)));
    this.child.stderr.on('data', b => this.consume(b.toString()));
    this.child.once('error', error => this.exited(error.message));
    this.child.once('exit', (code, sig) => this.exited(`Shell exited (${sig ?? code}); its jobs and shell state have been reset`));
    const setup = `exec ${this.control}>&1 2>&1\nset -m`;
    const result = await this.invoke(setup, false, undefined, '', signal, 10_000);
    if (result.exitCode !== 0) throw new AppError(this.permissionsEnabled ? 'sandbox_unavailable' : 'shell_unavailable', result.output || result.error || 'Could not start member shell', 503);
  }
  private async openBroker() {
    this.server = createServer(socket => {
      this.clients.add(socket); socket.once('close', () => this.clients.delete(socket)); socket.on('error', () => socket.destroy());
      let data = '', handled = false;
      socket.on('data', bytes => {
        if (handled) return;
        data += bytes.toString();
        if (Buffer.byteLength(data) > 65536) { handled = true; socket.destroy(); return; }
        if (!data.includes('\n')) return; handled = true;
        const op = (async () => {
          try {
            const request = JSON.parse(data.split('\n')[0]!);
            const call = this.gitCalls.get(request.token);
            if (this.dead || !call || !request.env || request.invalid?.length || !Array.isArray(request.argv) || request.argv.length > 128 || request.argv.some((v: unknown) => typeof v !== 'string') || typeof request.cwd !== 'string') throw new AppError('command_denied', `Explicit Git commit invocation is unavailable (active=${!!call}, env=${!!request.env}, unsupported=${(request.invalid??[]).join(',')})`);
            const cwd = await realpath(request.cwd);
            socket.end(JSON.stringify(await call.git(request.argv, cwd, request.env, waiting => this.pending?.waiting?.(waiting), this.brokerAbort.signal,(args,env)=>this.executeGit(args,env))) + '\n');
          } catch (error) { socket.end(JSON.stringify({ output: `${error instanceof AppError ? error.code : 'git_error'}: ${error instanceof Error ? error.message : 'Git failed'}\n`, code: 1 }) + '\n'); }
        })();
        this.brokerOperations.add(op); void op.finally(() => this.brokerOperations.delete(op)).catch(() => undefined);
      });
    });
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.socketPath, resolve); });
  }
  private async executeGit(args:string[],env:NodeJS.ProcessEnv):Promise<{output:string;code:number}>{
    const command=[this.nativeGit,'--no-replace-objects','-C',this.root,...args].map(quote).join(' ');
    const wrapped=await wrapping.run('profile',async()=>{SandboxManager.updateConfig(this.profile);return SandboxManager.wrapWithSandbox(command,'/bin/bash',this.profile,this.brokerAbort.signal);});
    try{const result=await runFile('/bin/bash',['--noprofile','--norc','-c',wrapped],{cwd:this.root,env:{...this.shellEnv,...env,RSI_COMMIT_TOKEN:''},maxBuffer:128*1024*1024,timeout:60_000,signal:this.brokerAbort.signal});return {output:result.stdout+result.stderr,code:0};}
    catch(error){const result=error as {code?:unknown;stdout?:string;stderr?:string;message:string};if(typeof result.code!=='number')throw error;return {output:(result.stdout??'')+(result.stderr??''),code:result.code};}
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
  private async invoke(command: string, background: boolean, cwd: string | undefined, token: string, signal: AbortSignal, timeout: number): Promise<CommandResult & { pid?: number; jobs?: number[] }> {
    signal.throwIfAborted();
    const id = randomUUID().replaceAll('-', ''), variable = `__rsi_${id}`;
    const prefix = `\x1eRSI_${id}:`;
    const commandBody = background
      ? `builtin eval -- ${quote(command)} </dev/null >/dev/null 2>&1 &\n${variable}_pid=$!\n${variable}_job=$(builtin jobs -l %+)\n${variable}_job=\${${variable}_job%%]*}\n${variable}_job=\${${variable}_job#\\[}\n${variable}_exit=0`
      : `builtin eval -- ${quote(command)} </dev/null\n${variable}_exit=$?\n${variable}_job=0\n${variable}_pid=0`;
    const body = `export RSI_COMMIT_TOKEN=${quote(token)}\n${cwd === undefined ? commandBody : `if builtin cd -- ${quote(cwd)}; then\n${commandBody}\nelse\n${variable}_exit=$?\n${variable}_job=0\n${variable}_pid=0\nfi`}\n${variable}_jobs=$(builtin jobs -p)\nbuiltin printf '\\036RSI_${id}:%s:%s:%s:%s\\037' "$${variable}_exit" "$${variable}_job" "$${variable}_pid" "$${variable}_jobs" >&${this.control}\nunset ${variable}_exit ${variable}_job ${variable}_pid ${variable}_jobs\n`;
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false, remaining = timeout, armedAt = Date.now();
    const arm = () => { armedAt=Date.now();timer=setTimeout(()=>{timedOut=true;void this.stop();},remaining);timer.unref(); };
    const abort = () => { void this.stop(); };
    signal.addEventListener('abort', abort, { once: true });
    const result = new Promise<CommandResult & { pid?: number; jobs?: number[] }>(resolve => {
      this.pending = { prefix, buffer: '', text: '', bytes: 0, truncated: false, started: Date.now(), resolve, waiting: waiting => { if(waiting){clearTimeout(timer);remaining=Math.max(1,remaining-(Date.now()-armedAt));}else if(!this.dead)arm(); } };
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
  async run(request: BashInput, signal: AbortSignal, git?: GitOperation): Promise<CommandResult> {
    const explicit = this.permissionsEnabled && /(?:^|[\s;&|()])(?:["']?(?:[^\s;&|()"']*\/)?git["']?)\s+[^\n;&|()]*\bcommit(?:\s|$)/m.test(request.command.replace(/\\\r?\n/g,' '));
    if(explicit && request.background)throw new AppError('command_denied','Explicit Git commits must run in the foreground so approval and execution can be observed');
    const token = explicit && git ? randomUUID() : '';
    if(token && git)this.gitCalls.set(token,{git});
    // Absolute explicit Git executables use the same commit gate. Other commands are untouched.
    const command = token ? request.command.replace(/(^|[;&|\n]\s*|\b(?:command|exec)\s+)["']?(?:\/[^\s;&|()"']+\/git)["']?(?=\s)/gm, '$1git') : request.command;
    const result = await this.invoke(command, request.background ?? false, request.cwd, token, signal, request.background ? 10_000 : (request.timeout === undefined ? commandTimeoutMs : request.timeout * 1000));
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
    this.gitCalls.delete(token);
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
    this.dead = true;this.brokerAbort.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.gitCalls.clear();
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
    await Promise.allSettled(this.brokerOperations);
    for (const socket of this.clients) socket.destroy();
    if (this.server?.listening) await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}

export async function executeBash(environment: BashEnvironment): Promise<CommandResult> {
  const { memberId, request, signal, git, permissionsEnabled = true } = environment;
  const root = await realpath(environment.root), key = keyFor(root, memberId);
  return queues.run(key, async () => {
    signal.throwIfAborted();
    let opening = sessions.get(key), shell = opening ? await opening : undefined;
    if (shell && (!shell.alive || shell.permissionsEnabled !== permissionsEnabled)) { await shell.stop(); sessions.delete(key); restarted.add(key); shell = undefined; opening = undefined; }
    if (!shell) {
      const fresh = new MemberShell(memberId, root, permissionsEnabled);
      opening = fresh.open(signal).then(() => fresh).catch(async error => { await fresh.stop(); sessions.delete(key); throw error; });
      sessions.set(key, opening); shell = await opening;
    }
    const reset = restarted.delete(key);
    const result = await shell.run(request, signal, permissionsEnabled ? git : undefined);
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
  await wrapping.run('profile', async () => {
    if (initialized) { await initialized; await SandboxManager.reset(); initialized = undefined; }
    await closeExecutionResources();
  });
}
