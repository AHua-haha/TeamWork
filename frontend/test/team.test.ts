import assert from 'node:assert/strict';
import test from 'node:test';
import { BackendError } from '../src/client/agent-client.js';
import type { Member, Team } from '../src/client/workspace-client.js';
import { WorkspaceClient } from '../src/client/workspace-client.js';
import { readRoute, routeUrl, sameRoute } from '../src/ui/routes.js';
import { findLead, memberConfig, memberFields, memberStatus, modelText, pollIntervalMs, shouldPoll } from '../src/ui/team-state.js';
import { callRecipient, toolHeading, toolLabels } from '../src/ui/tool-label.js';

const settings = { connectionId: 'main', modelId: 'm1', toolOptionIds: ['t'], prompt: 'Be brief', promptOptionIds: [], modelOptions: [{ connectionId: 'main', modelId: 'm1', reasoning: 'high' as const }] };
const member = (patch: Partial<Member> = {}): Member => ({
  memberId: 'lead-1', workspaceId: 'w1', revision: 3, name: 'Lead', role: 'Lead', responsibility: 'Works with the user', harness: { designScope: { working: ['user/design.json'], dependencies: [] }, allowedCommands: [] }, lead: true,
  settings, issues: [], ready: true, running: false, ...patch,
});

test('the team client reads a team and saves a member at its revision', async () => {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const api = new WorkspaceClient((async (input, init) => {
    calls.push({ path: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(String(input).endsWith('/team') ? { workspaceId: 'w 1', members: [member()] } : member({ revision: 4 })));
  }) as typeof fetch);
  const team = await api.team('w 1');
  assert.equal(team.members[0]!.name, 'Lead');
  const saved = await api.updateMember('w 1', 'lead/1', 3, { name: 'Lead', role: 'Lead', responsibility: '', harness: { designScope: { working: [], dependencies: [] }, allowedCommands: [] }, settings });
  assert.equal(saved.revision, 4);
  assert.deepEqual(calls, [
    { path: '/workspaces/w%201/team', method: 'GET', body: undefined },
    { path: '/workspaces/w%201/team/members/lead%2F1', method: 'PUT', body: { revision: 3, value: { name: 'Lead', role: 'Lead', responsibility: '', harness: { designScope: { working: [], dependencies: [] }, allowedCommands: [] }, settings } } },
  ]);
});

test('a refused member save keeps the backend code', async () => {
  const api = new WorkspaceClient((async () => new Response(JSON.stringify({ error: { code: 'config_conflict', message: 'Member revision changed' } }), { status: 409 })) as typeof fetch);
  await assert.rejects(api.updateMember('w1', 'm', 0, { name: 'a', role: 'b', responsibility: '', harness: { designScope: { working: [], dependencies: [] }, allowedCommands: [] }, settings }), (error: unknown) =>
    error instanceof BackendError && error.status === 409 && error.code === 'config_conflict');
});

test('member settings use the agent config shape and saved without changing its identity', () => {
  const lead = member();
  assert.deepEqual(memberConfig(lead), { id: 'lead-1', revision: 3, value: { name: 'Lead', ...settings }, issues: [] });
  const edited = { ...memberConfig(lead).value, modelId: 'm2', name: 'Renamed in the composer' };
  assert.deepEqual(memberFields(lead, edited), {
    name: 'Lead', role: 'Lead', responsibility: 'Works with the user', harness: { designScope: { working: ['user/design.json'], dependencies: [] }, allowedCommands: [] },
    settings: { connectionId: 'main', modelId: 'm2', toolOptionIds: ['t'], prompt: 'Be brief', promptOptionIds: [], modelOptions: settings.modelOptions },
  });
  const team: Team = { workspaceId: 'w1', members: [member({ lead: false, memberId: 'b', name: 'Backend' }), lead] };
  assert.equal(findLead(team)?.memberId, 'lead-1');
  assert.equal(findLead(null), null);
});

test('a member is working, idle, or unable to run, and the model shows its connection', () => {
  assert.deepEqual(memberStatus(member({ running: true })), { label: 'Working', reasons: [] });
  assert.deepEqual(memberStatus(member()), { label: 'Idle', reasons: [] });
  assert.deepEqual(memberStatus(member({ ready: false, issues: ['Select a provider and model'] })), { label: 'Cannot run', reasons: ['Select a provider and model'] });
  assert.deepEqual(memberStatus(member({ running: true, ready: false, issues: ['x'] })), { label: 'Working', reasons: [] });
  assert.equal(modelText(member()), 'm1 · main');
  assert.equal(modelText(member({ settings: { ...settings, modelId: null } })), null);
});

test('the team is read on a timer only while team work runs', () => {
  assert.equal(shouldPoll(true), true);
  assert.equal(shouldPoll(false), false);
  assert.ok(pollIntervalMs >= 1000 && pollIntervalMs <= 10_000);
});

test('addresses name a workspace, a solo conversation, config, or home', () => {
  assert.deepEqual(readRoute('?workspace=w_1'), { page: 'workspace', id: 'w_1' });
  assert.deepEqual(readRoute('?agent=a-1'), { page: 'conversation', id: 'a-1' });
  assert.deepEqual(readRoute('?page=providers'), { page: 'providers' });
  assert.deepEqual(readRoute(''), { page: 'home' });
  assert.deepEqual(readRoute('?page=home'), { page: 'home' });
  assert.deepEqual(readRoute('?workspace=w1&agent=a1'), { page: 'workspace', id: 'w1' });
  for (const bad of ['?workspace=', '?workspace=a/b', `?workspace=${'x'.repeat(65)}`, '?agent=../x']) assert.deepEqual(readRoute(bad), { page: 'home' }, bad);
  for (const route of [{ page: 'workspace', id: 'w1' }, { page: 'conversation', id: 'a1' }, { page: 'providers' }, { page: 'home' }] as const) {
    assert.deepEqual(readRoute(routeUrl(route)), route, routeUrl(route));
  }
  assert.equal(sameRoute({ page: 'workspace', id: 'w1' }, { page: 'workspace', id: 'w1' }), true);
  assert.equal(sameRoute({ page: 'workspace', id: 'w1' }, { page: 'conversation', id: 'w1' }), false);
});

test('a call to a member is headed by its recipient, and other tools keep their names', () => {
  assert.equal(callRecipient('{"to":"Backend","text":"Do it"}'), 'Backend');
  assert.equal(toolHeading('send_message', '{"to":" Backend ","text":"x"}'), '→ Backend');
  assert.equal(toolHeading('send_message', '{"text":"x"}'), 'send_message');
  assert.equal(toolHeading('send_message', '{"to":'), 'send_message');
  assert.equal(toolHeading('send_message', undefined), 'send_message');
  assert.equal(toolHeading('send_message', `{"to":"${'x'.repeat(81)}"}`), 'send_message');
  assert.equal(toolHeading('read', '{"to":"Backend"}'), 'read');
  assert.deepEqual(toolLabels('send_message'), { input: 'Message', output: 'Response' });
  assert.deepEqual(toolLabels('read'), { input: 'Arguments', output: 'Result' });
  assert.equal(toolHeading('assign_member', '{"to":"Backend","text":"Implement"}'), 'Assign → Backend');
  assert.equal(toolHeading('assign_member', '{"to":'), 'assign_member');
  assert.deepEqual(toolLabels('assign_member'), { input: 'Assignment', output: 'Report' });
  assert.equal(toolHeading('save_design', '{"path":"user/design.json"}'), 'Update design');
  assert.deepEqual(toolLabels('save_design'), { input: 'Design change', output: 'Applied change' });
  assert.equal(toolHeading('read_design', '{}'), 'Read design');
});
