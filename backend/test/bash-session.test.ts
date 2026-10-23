import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeBashRuntime, executeBash, parseBashInput, resetMemberShell, type BashInput } from '../src/core/harness/harness-command.js';
import { withFolder } from './memory-store.js';

after(closeBashRuntime);
const signal = () => new AbortController().signal;
const run = (root: string, memberId: string, request: BashInput, abort = signal()) => executeBash({ root, memberId, request, signal: abort });

test('persistent member shells preserve state, combine streams, honor cwd and redirects, and isolate members', { timeout: 30000 }, () => withFolder(async root => {
  await mkdir(join(root, 'backend'));
  try {
    const descriptor = await run(root, 'a', { command: 'exec 9> descriptor.log; printf fd >&9; exec 9>&-; printf intact' });
    assert.equal(descriptor.output, 'intact');
    const first = await run(root, 'a', { command: 'cd backend; export FLAG=kept; answer() { printf function; }; alias say="printf alias"; shopt -s expand_aliases; printf out; printf err >&2' });
    assert.equal(first.exitCode, 0, JSON.stringify(first)); assert.equal(first.output, 'outerr');
    const next = await run(root, 'a', { command: 'printf "%s:%s:" "$FLAG" "${PWD##*/}"; answer; say' });
    assert.equal(next.output, 'kept:backend:functionalias', JSON.stringify(next));
    const other = await run(root, 'b', { command: 'printf "%s:%s" "${FLAG:-empty}" "${PWD##*/}"' });
    assert.equal(other.output, `empty:${root.split('/').at(-1)}`);
    const redirected = await run(root, 'a', { cwd: root, command: 'printf saved > result.log; printf error >&2' });
    assert.equal(redirected.output, 'error'); assert.equal(await readFile(join(root, 'result.log'), 'utf8'), 'saved');
    const missing = await run(root, 'a', { cwd: 'missing', command: 'touch must-not-exist' });
    assert.notEqual(missing.exitCode, 0); await assert.rejects(readFile(join(root, 'must-not-exist')));
  } finally { await resetMemberShell('a'); await resetMemberShell('b'); }
}));

test('native background jobs free the shell, discard inherited output, preserve explicit redirects and accept wait/kill', { timeout: 30000 }, () => withFolder(async root => {
  try {
    const immediate = await run(root, 'jobs', { command: 'true', background: true });
    assert.ok(immediate.jobId);
    assert.equal((await run(root, 'jobs', { command: `wait %${immediate.jobId}` })).exitCode, 0);
    const background = await run(root, 'jobs', { command: 'sleep .2; printf noisy; printf err >&2', background: true });
    assert.ok(background.jobId, JSON.stringify(background)); assert.equal(background.output, '');
    const foreground = await run(root, 'jobs', { command: `printf foreground; wait %${background.jobId}` });
    assert.equal(foreground.output, 'foreground', JSON.stringify(foreground));
    const logged = await run(root, 'jobs', { command: 'sleep .1; printf stdout; printf stderr >&2', background: true });
    await run(root, 'jobs', { command: `wait %${logged.jobId}` });
    const redirected = await run(root, 'jobs', { command: '{ sleep .1; printf stdout; printf stderr >&2; } > job.log 2>&1', background: true });
    const read = await run(root, 'jobs', { command: `wait %${redirected.jobId}; cat job.log` });
    assert.equal(read.output, 'stdoutstderr');
    const long = await run(root, 'jobs', { command: 'sleep 30', background: true });
    const killed = await run(root, 'jobs', { command: `kill %${long.jobId}; wait %${long.jobId}` });
    assert.notEqual(killed.exitCode, 0);
  } finally { await resetMemberShell('jobs'); }
}));

test('Bash resource policy permits whole workspace/system reads and denies outside writes; output is bounded', { timeout: 30000 }, () => withFolder(async folder => {
  const root = join(folder, 'project'); await mkdir(root); await writeFile(join(folder, 'outside.txt'), 'system-read');
  try {
    const value = await run(root, 'policy', { command: 'mkdir -p .rsi/members dependency; printf allowed > .rsi/members/test; printf permitted > dependency/result; cat ../outside.txt; printf cache > "$XDG_CACHE_HOME/test"; cat "$XDG_CACHE_HOME/test"' });
    assert.equal(value.exitCode, 0, JSON.stringify(value)); assert.equal(value.output, 'system-readcache');
    const denied = await run(root, 'policy', { command: 'printf denied > ../outside.txt' });
    assert.notEqual(denied.exitCode, 0); assert.equal(await readFile(join(folder, 'outside.txt'), 'utf8'), 'system-read');
    const output = await run(root, 'policy', { command: `${JSON.stringify(process.execPath)} -e 'process.stdout.write("x".repeat(100000)+"END")'` });
    assert.equal(output.truncated, true); assert.ok(Buffer.byteLength(output.output) <= 50 * 1024); assert.ok(output.output.endsWith('END'));
  } finally { await resetMemberShell('policy'); }
}));

test('foreground timeout/cancellation resets shell and jobs; explicit background timeout stops only its job', { timeout: 30000 }, () => withFolder(async root => {
  try {
    await run(root, 'timeouts', { command: 'export VALUE=old' });
    const job = await run(root, 'timeouts', { command: 'sleep 30', background: true }); assert.ok(job.jobId);
    const timeout = await run(root, 'timeouts', { command: 'sleep 30', timeout: .15 });
    assert.equal(timeout.timedOut, true, JSON.stringify(timeout));
    const fresh = await run(root, 'timeouts', { command: 'printf "${VALUE:-new}"; jobs' });
    assert.equal(fresh.output, 'new'); assert.equal(fresh.shellRestarted, true);
    const controller = new AbortController();
    const pending = run(root, 'timeouts', { command: 'sleep 30' }, controller.signal);
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(pending);
    const background = await run(root, 'timeouts', { command: 'sleep 30', background: true, timeout: .15 });
    const waited = await run(root, 'timeouts', { command: `wait %${background.jobId}` });
    assert.notEqual(waited.exitCode, 0);
    assert.equal((await run(root, 'timeouts', { command: 'printf alive' })).output, 'alive');
  } finally { await resetMemberShell('timeouts'); }
}));

test('Bash input accepts execution options without authority extensions', () => {
  assert.deepEqual(parseBashInput({ command: 'pwd', cwd: '.', timeout: .5, background: true, metadata: {} }).cwd, '.');
  for (const value of [{ command: 'pwd', timeout: 0 }, { command: 'pwd', background: 'yes' }, { command: 'pwd', metadata: { git: { scope: 'design', approved: true } } }]) assert.throws(() => parseBashInput(value));
});

test('explicit member reset stops a live native job and starts a fresh shell', { timeout: 30000 }, () => withFolder(async root => {
  try {
    await run(root, 'reset-jobs', { command: 'export OLD_STATE=present; sleep 30', background: true });
    const pid = Number((await run(root, 'reset-jobs', { command: 'jobs -p' })).output.trim());
    assert.ok(pid > 0); process.kill(pid, 0);
    await resetMemberShell('reset-jobs');
    for (let tries = 0; tries < 20; tries++) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const fresh = await run(root, 'reset-jobs', { command: 'printf "${OLD_STATE:-fresh}"; jobs' });
    assert.equal(fresh.output, 'fresh'); assert.equal(fresh.shellRestarted, true);
    await run(root, 'reset-jobs', { command: 'sleep 30', background: true });
    const beforeExit = Number((await run(root, 'reset-jobs', { command: 'jobs -p' })).output.trim());
    const exited = await run(root, 'reset-jobs', { command: 'exit 7' });
    assert.match(exited.error!, /Shell exited/);
    assert.throws(() => process.kill(beforeExit, 0), { code: 'ESRCH' });
  } finally { await resetMemberShell('reset-jobs'); }
}));
