import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode, encode, validateAuthor } from '../src/codec.js';
import { emptyHarness } from '../src/harness-config.js';
import { leadTools } from '../src/lead-tools.js';
import type { StepScope } from '../src/runtime.js';
import { code, withTeam, worker } from './team-fixture.js';

const scope = (agentId: string) => ({ agentId, runId: 'lead-run', signal: new AbortController().signal } as StepScope);
const raw = (content: string, implementation = ['src']) => JSON.stringify({ content, implementation }, null, 2) + '\n';

test('lead design tools expose exact changes, revisions, and persisted lead authorship', () => withTeam(async fixture => {
  const tools = leadTools(fixture.team.lead);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await tools.find(tool => tool.definition.name === name)!.execute(args as never, scope(fixture.lead.memberId), {} as never);
    return result.content.map(part => part.type === 'text' ? part.text : '').join('');
  };
  const created = JSON.parse(await call('save_design', { path: '.context/user/design.json', content: '# Design\nShared scale.', implementation: ['src'], baseRevision: null, reason: 'The user chose a shared scale.' }));
  assert.equal(created.status, 'created');
  assert.deepEqual([created.before, created.after, created.seq], [null, raw('# Design\nShared scale.'), 1]);
  const current = JSON.parse(await call('read_design', { path: 'user/design.json' }));
  assert.equal(current.revision, created.revision);
  assert.deepEqual(current.design, { content: '# Design\nShared scale.', implementation: ['src'] });
  const author = { type: 'lead', memberId: fixture.lead.memberId, runId: 'lead-run' };
  assert.deepEqual(current.author, author);
  assert.deepEqual(decode(encode(author), validateAuthor), author);
  assert.throws(() => validateAuthor({ type: 'lead', memberId: 'bad/path', runId: 'r' }));
  const updated = JSON.parse(await call('save_design', { path: 'user/design.json', content: '# Design\nFive stops.', implementation: ['src', 'test'], baseRevision: created.revision, reason: 'The user chose five stops.' }));
  assert.deepEqual([updated.status, updated.before, updated.after, updated.seq], ['updated', created.after, raw('# Design\nFive stops.', ['src', 'test']), 2]);
  const base = await fixture.workspaces.context(fixture.workspaceId);
  assert.deepEqual((await base.history('user/design.json', null, 50)).versions.map(version => version.author), [author, author]);
  assert.deepEqual((await base.changes(0, 50)).records.map(record => record.author), [author, author]);
  const same = JSON.parse(await call('save_design', { path: 'user/design.json', ...updated.design, baseRevision: updated.revision, reason: 'Confirm current design.' }));
  assert.deepEqual([same.status, same.seq, (await base.overview()).seq], ['unchanged', null, 2]);
}));

test('stale design changes and worker changes refuse without modifying the design', () => withTeam(async fixture => {
  const input = { path: 'user/design.json', content: 'first', implementation: ['src'], baseRevision: null, reason: 'Requested design.' };
  const first = await fixture.team.lead.saveDesign(fixture.lead.memberId, 'r', input);
  const base = await fixture.workspaces.context(fixture.workspaceId);
  const userEdit = await base.save(input.path, raw('user edit'), first.revision, 'Edited by user');
  await assert.rejects(fixture.team.lead.saveDesign(fixture.lead.memberId, 'r', { ...input, content: 'stale', baseRevision: first.revision }), code('stale_revision'));
  const member = await worker(fixture, 'Backend');
  await assert.rejects(fixture.team.lead.saveDesign(member.memberId, 'r', { ...input, baseRevision: userEdit.revision }), code('access_denied'));
  await assert.rejects(fixture.team.lead.saveDesign(fixture.lead.memberId, 'r', { ...input, path: 'agent/design.json' }), code('read_only'));
  await assert.rejects(fixture.team.lead.saveDesign(fixture.lead.memberId, 'r', { ...input, reason: '  ' }), code('invalid_input'));
  const result = await leadTools(fixture.team.lead).find(tool => tool.definition.name === 'save_design')!.execute({ ...input, baseRevision: first.revision }, scope(fixture.lead.memberId), {} as never);
  assert.equal(result.isError, false);
  assert.match(result.content[0]!.type === 'text' ? result.content[0]!.text : '', /^Refused \(stale_revision\)/);
  assert.equal((await base.read({ path: input.path })).content, raw('user edit'));
}));

test('assignments use the configured designs and return the worker report', () => withTeam(async fixture => {
  const { team, runtime, lead } = fixture;
  const backend = await worker(fixture, 'Backend', ['src/api.ts']);
  const part = await team.designs.read(fixture.workspaceId, backend.harness.designScope.working[0]);
  const unconfigured = await team.service.create(fixture.workspaceId, { name: 'Empty', role: 'developer' });
  const run = await team.runner.startUser(lead.memberId, 'Implement the backend design.');
  const signal = new AbortController().signal;
  for (const input of [{ to: 'Empty', text: 'Work' }, { to: 'Lead', text: 'Work' }, { to: 'Backend', text: 'x'.repeat(20_000) }, { to: 'Backend', text: ' ' }]) await assert.rejects(team.lead.assign(lead.memberId, run.runId, signal, input));
  assert.equal(runtime.runs.length, 1);
  assert.equal(unconfigured.ready, false);
  await assert.rejects(team.lead.assign(backend.memberId, run.runId, signal, { to: 'Backend', text: 'Work' }), code('access_denied'));
  const result = team.lead.assign(lead.memberId, run.runId, signal, { to: 'backend', text: 'Implement step 1 and report changed files.' });
  await runtime.started(backend.memberId);
  assert.match(String(runtime.active(backend.memberId)!.input), /Message from Lead:/);
  assert.ok(String(runtime.active(backend.memberId)!.input).includes(`.context/${part.path} (revision ${part.revision}); implementation src/api.ts`));
  runtime.end(backend.memberId, 'Implemented step 1; src/api.ts changed.');
  assert.equal(await result, 'Implemented step 1; src/api.ts changed.');
  runtime.end(lead.memberId);
}));

test('lead configures its own harness and member harness independently from model settings', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend');
  const value = { ...backend.harness, allowedCommands: [{ kind: 'executable', executable: 'node' }] };
  const changed = await fixture.team.lead.configureHarness(fixture.lead.memberId, 'Backend', value);
  assert.deepEqual(changed.settings, backend.settings);
  assert.equal(changed.revision, backend.revision + 1);
  const leader = await fixture.team.lead.configureHarness(fixture.lead.memberId, 'Lead', value);
  assert.deepEqual(leader.harness, changed.harness);
  await assert.rejects(fixture.team.lead.configureHarness(backend.memberId, 'Lead', emptyHarness()), code('access_denied'));
  await assert.rejects(fixture.team.lead.configureHarness(fixture.lead.memberId, 'Backend', { ...emptyHarness(), designScope: { working: ['user/missing.json'], dependencies: [] } }), code('not_found'));
}));

test('stopping a lead assignment cancels the worker call', () => withTeam(async fixture => {
  const { team, runtime, lead } = fixture;
  const backend = await worker(fixture, 'Backend');
  const run = await team.runner.startUser(lead.memberId, 'Work');
  const controller = new AbortController();
  const pending = team.lead.assign(lead.memberId, run.runId, controller.signal, { to: 'Backend', text: 'Build it.' });
  await runtime.started(backend.memberId);
  controller.abort();
  assert.equal(await pending, 'Backend was cancelled.');
  assert.equal(runtime.last(backend.memberId)!.cancelled, true);
  runtime.end(lead.memberId);
}));
