import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { designPart } from '../src/design.js';
import { commandAllowed, commandArgv, emptyHarness, harnessConfig } from '../src/harness-config.js';
import { executeCommand } from '../src/harness-command.js';
import { code, withTeam, worker } from './team-fixture.js';

test('design and harness config reject ambiguous scopes and command rules', () => {
  assert.deepEqual(designPart({ content: 'Design', implementation: ['backend/'] }), { content: 'Design', implementation: ['backend'] });
  for (const implementation of [['../outside'], ['.context/user/design.json'], ['.git/config'], ['src', 'SRC']]) assert.throws(() => designPart({ content: 'x', implementation }));
  const config = { designScope: { working: ['.context/user/api.json'], dependencies: ['user/client.json'] }, allowedCommands: [{ kind: 'exact', argv: ['npm', 'test'] }, { kind: 'executable', executable: 'node' }] };
  const parsed = harnessConfig(config);
  assert.deepEqual(parsed.designScope.working, ['user/api.json']);
  for (const designScope of [{ working: ['user/a', 'user/A'], dependencies: [] }, { working: ['user/a'], dependencies: ['user/A'] }]) assert.throws(() => harnessConfig({ ...config, designScope }));
  assert.throws(() => harnessConfig({ ...config, allowedCommands: [{ kind: 'prefix', executable: 'node' }] }));
  assert.throws(() => commandArgv([]));
  assert.throws(() => commandArgv(['node', '\0']));
  assert.equal(commandAllowed(parsed.allowedCommands, ['npm', 'test']), true);
  assert.equal(commandAllowed(parsed.allowedCommands, ['npm', 'test', '--other']), false);
  assert.equal(commandAllowed(parsed.allowedCommands, ['node', '-e', 'process.stdout.write("ok")']), true);
  assert.equal(commandAllowed(parsed.allowedCommands, ['node-other']), false);
  assert.equal(commandAllowed(parsed.allowedCommands, ['/usr/bin/node']), false);
});

test('mapped design changes take effect at the next file tool operation', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['old.ts']);
  const prepared = await fixture.team.harness.prepare(backend.memberId, []);
  const write = prepared.tools.find(tool => tool.definition.name === 'write')!;
  const scope = { agentId: backend.memberId, runId: 'r', signal: new AbortController().signal };
  const part = await fixture.team.designs.read(fixture.workspaceId, backend.harness.designScope.working[0]);
  await fixture.team.designs.save(fixture.workspaceId, part.path, { content: 'Revised', implementation: ['new.ts'] }, part.revision, 'User revised mapping', { type: 'lead', memberId: fixture.lead.memberId, runId: 'r' });
  const refused = await write.execute({ path: 'old.ts', content: 'old' }, scope as never, {} as never);
  assert.match(JSON.stringify(refused.content), /Error:/);
  await write.execute({ path: 'new.ts', content: 'new' }, scope as never, {} as never);
  assert.equal(await readFile(join((await fixture.team.harness.environment(backend.memberId)).root, 'new.ts'), 'utf8'), 'new');
}));

test('commands execute allowed vectors in isolated worktree cwd without shell string interpretation', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend', ['src']);
  await fixture.team.lead.configureHarness(fixture.lead.memberId, 'Backend', { ...backend.harness, allowedCommands: [{ kind: 'executable', executable: process.execPath }] });
  const signal = new AbortController().signal;
  const result = await fixture.team.harness.command(backend.memberId, [process.execPath, '-e', 'process.stdout.write(process.cwd()+"\\n"+process.argv[1]);process.stderr.write("err");process.exitCode=3', 'literal; $(echo unwanted)'], signal);
  assert.deepEqual([result.exitCode, result.stderr, result.timedOut], [3, 'err', false]);
  assert.equal(result.stdout, (await fixture.team.harness.environment(backend.memberId)).root + '\nliteral; $(echo unwanted)');
  await assert.rejects(fixture.team.harness.command(backend.memberId, ['node-other'], signal), code('command_denied'));
  await fixture.team.lead.configureHarness(fixture.lead.memberId, 'Backend', backend.harness);
  await assert.rejects(fixture.team.harness.command(backend.memberId, [process.execPath, '-v'], signal), code('command_denied'));
}));

test('command output is bounded and timeout and cancellation terminate execution', () => withTeam(async fixture => {
  const output = await executeCommand(fixture.directory, [process.execPath, '-e', 'process.stdout.write("x".repeat(100000))'], new AbortController().signal);
  assert.equal(Buffer.byteLength(output.stdout), 65536);
  assert.equal(output.truncated, true);
  const timeout = await executeCommand(fixture.directory, [process.execPath, '-e', 'setInterval(()=>{},1000)'], new AbortController().signal, 100);
  assert.equal(timeout.timedOut, true);
  const controller = new AbortController();
  const pending = executeCommand(fixture.directory, [process.execPath, '-e', 'setInterval(()=>{},1000)'], controller.signal);
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError');
}));

test('missing or invalid design prevents a worker from running and can be repaired', () => withTeam(async fixture => {
  const member = await fixture.team.service.create(fixture.workspaceId, { name: 'Backend', role: 'developer', harness: { ...emptyHarness(), designScope: { working: ['user/design.json'], dependencies: [] } } });
  assert.equal(member.ready, false);
  const base = await fixture.workspaces.context(fixture.workspaceId);
  const file = await base.save('user/design.json', 'old text design', null, 'User draft');
  assert.match((await fixture.team.designs.inspect(fixture.workspaceId, 'user/design.json')).designIssue!, /JSON design/);
  assert.equal((await fixture.team.service.get(fixture.workspaceId, member.memberId)).ready, false);
  await fixture.team.designs.save(fixture.workspaceId, 'user/design.json', { content: 'Agreed', implementation: ['src'] }, file.revision, 'User agreed', { type: 'lead', memberId: fixture.lead.memberId, runId: 'r' });
  assert.equal((await fixture.team.service.get(fixture.workspaceId, member.memberId)).ready, true);
}));
