import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { StepScope } from '../src/core/team/runtime.js';
import { code, withTeam, worker } from './team-fixture.js';
import { teamTools } from '../src/core/team/member-tools.js';

const scope = (agentId: string) => ({ agentId, runId: 'tools-run', signal: new AbortController().signal } as StepScope);
const text = (result: { content: { type: string; text?: string }[] }) => result.content.map(b => b.type === 'text' ? b.text : '').join('');

test('default Pi read/search tools inspect the whole workspace; write/edit are scoped and preserve native details', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  await mkdir(join(f.directory, 'other')); await mkdir(join(f.directory, 'src'));
  await writeFile(join(f.directory, 'other/fact.txt'), 'unassigned FACT\n');
  const prepared = await f.team.harness.prepare(member.memberId, []);
  const call = async (name: string, args: Record<string, unknown>) => prepared.tools.find(t => t.definition.name === name)!.execute(args as never, scope(member.memberId), { id: name } as never);
  assert.equal(text(await call('read', { path: 'other/fact.txt' })), 'unassigned FACT\n');
  assert.match(text(await call('ls', { path: 'other' })), /fact.txt/);
  assert.match(text(await call('grep', { path: 'other', pattern: 'FACT' })), /fact.txt:1: unassigned FACT/);
  assert.match(text(await call('find', { path: 'other', pattern: '*.txt' })), /fact.txt/);
  await assert.rejects(call('write', { path: 'other/new.txt', content: 'denied' }), code('access_denied'));
  await assert.rejects(call('edit', { path: 'other/fact.txt', edits: [{ oldText: 'FACT', newText: 'no' }] }), code('access_denied'));
  const created = await call('write', { path: 'src/a.ts', content: 'const a = 1;\n' });
  assert.equal(text(created), `Successfully wrote to ${join(f.directory, 'src/a.ts')}`);
  const edited = await call('edit', { path: 'src/a.ts', edits: [{ oldText: 'const a = 1;', newText: 'const a = 2;' }] });
  assert.match(text(edited), /Successfully replaced 1 block/);
  assert.match((edited.details as { patch: string }).patch, /\+const a = 2/);
  await writeFile(join(f.folder, 'outside.txt'), 'outside');
  await symlink(join(f.folder, 'outside.txt'), join(f.directory, 'src/alias.txt'));
  await assert.rejects(call('write', { path: 'src/alias.txt', content: 'no' }), code('access_denied'));
  await assert.rejects(call('read', { path: '../outside.txt' }), code('access_denied'));
  assert.equal(await readFile(join(f.folder, 'outside.txt'), 'utf8'), 'outside');
  const broad = await f.team.harness.bash(member.memberId, { command: 'printf allowed > other/fact.txt' }, new AbortController().signal);
  assert.equal(broad.exitCode, 0, broad.output);
}));

test('custom management/Bash content is readable with metadata, errors retain status, and reset stops shell state', () => withTeam(async f => {
  const { management } = teamTools(f.team.service, f.team.configuration);
  const prepared = await f.team.harness.prepare(f.lead.memberId, management);
  const call = async (name: string, args: Record<string, unknown>) => prepared.tools.find(t => t.definition.name === name)!.execute(args as never, scope(f.lead.memberId), { id: name } as never);
  assert.match(text(await call('list_models', {})), /^## Workspace models[\s\S]*\(default\)[\s\S]*<metadata>/);
  const validation = await call('validate_member_config', { path: '.rsi/members' });
  assert.match(text(validation), /^## Member configuration validation/); assert.ok(validation.details);
  const failure = await call('bash', { command: 'printf problem >&2; false' });
  assert.equal(failure.isError, true); assert.match(text(failure), /^problem\n\n<metadata>/); assert.doesNotMatch(text(failure), /cwd:|pid:/);
  await call('bash', { command: 'export FLAG=old' });
  await f.team.runner.reset(f.workspaceId);
  const fresh = await call('bash', { command: 'printf "${FLAG:-fresh}"' });
  assert.match(text(fresh), /fresh/); assert.match(text(fresh), /shell_restarted: true/);
}));
