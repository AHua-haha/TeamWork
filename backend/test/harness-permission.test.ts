import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StepScope } from '../src/runtime.js';
import { hostShellEnvironment } from '../src/harness-execution.js';
import { harnessPermissionsEnabled } from '../src/harness-policy.js';
import { executeBash, resetMemberShell } from '../src/harness-command.js';
import { teamTools } from '../src/member-tools.js';
import { code, withTeam, worker } from './team-fixture.js';
import { initGit } from './git-fixture.js';
import { gitText } from '../src/workspace-git.js';

const signal = () => new AbortController().signal;
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const scope = (agentId: string) => ({ agentId, runId: 'permission-test', signal: signal() } as StepScope);
const text = (result: { content: { type: string; text?: string }[] }) => result.content.map(b => b.type === 'text' ? b.text : '').join('');

test('operator startup switch defaults to enforced and rejects invalid values', () => {
  assert.equal(harnessPermissionsEnabled(undefined), true);
  assert.equal(harnessPermissionsEnabled('true'), true);
  assert.equal(harnessPermissionsEnabled('false'), false);
  for (const value of ['', '0', 'FALSE', 'no']) assert.throws(() => harnessPermissionsEnabled(value), code('invalid_config'));
});

test('ordinary host shell environment exposes host tooling without injecting backend credentials', () => {
  const values = { DATABASE_URL: 'test-database-secret', CONFIG_ENCRYPTION_KEY: 'test-key', DEEPSEEK_WEB_API_KEY: 'test-web-secret', NODE_OPTIONS: '--require=unrelated.cjs' };
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    const environment = hostShellEnvironment();
    for (const key of Object.keys(values)) assert.equal(environment[key], undefined);
    assert.equal(environment.HOME, process.env.HOME);
    assert.ok(environment.PATH?.includes(process.env.PATH!));
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('disabled harness grants native file tools outside assignments/workspace and management tools to workers', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const { management } = teamTools(f.team.service, f.team.configuration, f.team.harness.permissionsEnabled);
  const prepared = await f.team.harness.prepare(member.memberId, management);
  const call = (name: string, args: Record<string, unknown>) => prepared.tools.find(tool => tool.definition.name === name)!.execute(args as never, scope(member.memberId), { id: name } as never);
  assert.match(prepared.context, /operator has disabled harness permission enforcement/i);
  assert.doesNotMatch(prepared.context, /commit policy: user|write boundaries are enforced/);
  assert.match(prepared.tools.find(t => t.definition.name === 'bash')!.definition.description, /without sandbox restrictions or Git commit approval/);
  const outside = join(f.folder, 'outside.txt');
  await call('write', { path: outside, content: 'original' });
  await call('edit', { path: '../outside.txt', edits: [{ oldText: 'original', newText: 'edited' }] });
  await symlink(outside, join(f.directory, 'linked.txt'));
  assert.equal(text(await call('read', { path: 'linked.txt' })), 'edited');
  await call('write', { path: 'linked.txt', content: 'through link' });
  assert.equal(await readFile(outside, 'utf8'), 'through link');
  await call('write', { path: '.rsi/context/design/extra.md', content: '# Worker can edit design' });
  await call('write', { path: '.rsi/private.txt', content: 'also writable' });
  assert.match(text(await call('list_models', {})), /Workspace models/);
  const validation = await call('validate_member_config', { path: '.rsi/members' });
  assert.equal(validation.isError, false);
  // Permissions do not disable semantic validation or activate invalid edits.
  const memberPath = (await f.team.service.find(member.memberId))!.value.configuration!.path;
  await writeFile(join(f.directory, memberPath), '{invalid JSON');
  const invalid = await call('validate_member_config', { path: '.rsi/members' });
  assert.equal(invalid.isError, true);
}, false));

test('disabled Bash writes outside the workspace and performs mixed/protected and background Git commits without approval', { timeout: 15000 }, () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  await initGit(f); await gitText(f.directory, ['config', 'commit.gpgsign', 'false']);
  await mkdir(join(f.directory, 'src'));
  const outside = join(f.folder, 'native.txt');
  const run = (command: string, background = false) => f.team.harness.bash(member.memberId, { command, background }, signal());
  const result = await run(`printf host > ${quote(outside)}; export FLAG=retained; printf '%s' "$HOME"`);
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(result.output, process.env.HOME);
  assert.equal(await readFile(outside, 'utf8'), 'host');
  assert.equal((await run('printf "$FLAG"')).output, 'retained');
  await writeFile(join(f.directory, 'src/a'), 'code');
  await gitText(f.directory, ['add', '-f', '.rsi/context/design', '.rsi/members', 'src']);
  const commit = await run('git commit -m Mixed');
  assert.equal(commit.exitCode, 0, commit.output);
  assert.equal(await gitText(f.directory, ['log', '-1', '--format=%s']), 'Mixed');
  assert.deepEqual(f.team.harness.approvals.list(f.workspaceId), []);
  await writeFile(join(f.directory, '.rsi/context/design/protected.md'), '# Next');
  await gitText(f.directory, ['add', '-f', '.rsi/context/design/protected.md']);
  const background = await run('git commit -m Protected', true);
  assert.ok(background.jobId);
  const waited = await run(`wait %${background.jobId}`);
  assert.equal(waited.exitCode, 0, waited.output);
  assert.equal(await gitText(f.directory, ['log', '-1', '--format=%s']), 'Protected');
  assert.deepEqual(f.team.harness.approvals.list(f.workspaceId), []);
  const cancelled = await f.team.harness.bash(member.memberId, { command: 'sleep 10', timeout: .05 }, signal());
  assert.equal(cancelled.timedOut, true);
  const next = await run('printf "${FLAG:-fresh}"');
  assert.equal(next.shellRestarted, true); assert.equal(next.output, 'fresh');
}, false));

test('changing permission mode replaces a persistent shell and restores the sandbox boundary', { timeout: 15000 }, () => withTeam(async f => {
  const outside = join(f.folder, 'outside-native.txt');
  const run = (permissionsEnabled: boolean, command: string) => executeBash({ memberId: f.lead.memberId, root: f.directory, request: { command }, signal: signal(), permissionsEnabled });
  try {
    assert.equal((await run(false, `export FLAG=unrestricted; printf before > ${quote(outside)}`)).exitCode, 0);
    const enforced = await run(true, `printf "%s:" "\${FLAG:-new}"; printf denied > ${quote(outside)}`);
    assert.equal(enforced.shellRestarted, true); assert.notEqual(enforced.exitCode, 0);
    assert.match(enforced.output, /^new:/); assert.equal(await readFile(outside, 'utf8'), 'before');
    const native = await run(false, `printf after > ${quote(outside)}`);
    assert.equal(native.shellRestarted, true); assert.equal(native.exitCode, 0);
    assert.equal(await readFile(outside, 'utf8'), 'after');
  } finally { await resetMemberShell(f.lead.memberId, f.directory); }
}));
