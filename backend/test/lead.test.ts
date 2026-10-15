import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyHarness } from '../src/harness-config.js';
import { leadTools } from '../src/lead-tools.js';
import type { StepScope } from '../src/runtime.js';
import { code, withTeam, worker } from './team-fixture.js';

const scope = (agentId: string) => ({ agentId, runId: 'lead-run', signal: new AbortController().signal } as StepScope);
const raw = (content: string, implementation = ['src']) => JSON.stringify({ content, implementation }, null, 2) + '\n';

test('lead exposes assignment configuration while design edits use reusable harness tools', () => withTeam(async fixture => {
  assert.deepEqual(leadTools(fixture.team.lead).map(tool => tool.definition.name), ['configure_harness']);
  const backend = await worker(fixture, 'Backend', ['src']);
  const prepared = await fixture.team.harness.prepare(backend.memberId, []);
  const runScope = scope(backend.memberId);
  const call = async (name: string, args: Record<string, unknown>) => {
    const output = await prepared.tools.find(t => t.definition.name === name)!.execute(args as never, runScope, {} as never);
    return output.content.map(p => p.type === 'text' ? p.text : '').join('');
  };
  const path = '.context/' + backend.harness.designScope.working[0]!;
  await call('write', { path, content: raw('Pending design') });
  const pending = await fixture.team.harness.inspect(backend.memberId);
  const design = pending.parts.find(p => p.state.part.id === 'design')!;
  assert.match(design.diff, /Pending design/);
  assert.match(await call('commit_scope', { part: 'design', message: 'Agent cannot approve' }), /approval_required/);
  const accepted = await fixture.team.harness.commit(backend.memberId, 'design', 'User accepted', { type: 'user', memberId: backend.memberId }, design.revision, design.state.committed);
  assert.equal(accepted.actor.type, 'user');
  assert.match((await fixture.team.harness.prepare(backend.memberId, [])).context, /Pending design/);
  const original = await fixture.team.designs.read(fixture.workspaceId, backend.harness.designScope.working[0]!);
  assert.equal(original.content, 'Design for Backend', 'acceptance does not silently integrate into the original workspace');
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
