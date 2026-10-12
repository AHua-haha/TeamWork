import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maxChainMembers, maxResponseCharacters } from '../src/team-runner.js';
import { code, settle, withTeam, worker, type Fixture } from './team-fixture.js';

const never = new AbortController().signal;
const inputOf = (fixture: Fixture, agentId: string) => String(fixture.runtime.last(agentId)?.input);
const running = async (fixture: Fixture) => Object.fromEntries((await fixture.team.team(fixture.workspaceId)).members.map(member => [member.name, member.running]));

test('a call runs the recipient and returns only its final response', () => withTeam(async fixture => {
  const { team, runtime, lead } = fixture;
  const backend = await worker(fixture, 'Backend');
  const run = await team.runner.startUser(lead.memberId, 'Build it');
  assert.deepEqual(await running(fixture), { Lead: true, Backend: false });

  const call = team.runner.call(lead.memberId, run.runId, never, 'backend', 'Do the API');
  await settle();
  assert.equal(inputOf(fixture, backend.memberId), 'Message from Lead:\n\nDo the API');
  assert.deepEqual(await running(fixture), { Lead: true, Backend: true });

  runtime.end(backend.memberId, 'API done; see report.md');
  assert.equal(await call, 'API done; see report.md');
  await settle();
  assert.deepEqual(await running(fixture), { Lead: true, Backend: false });
  runtime.end(lead.memberId);
  await settle();
  assert.deepEqual(await running(fixture), { Lead: false, Backend: false });
}));

test('a long response is cut, and an empty one is said to be empty', () => withTeam(async fixture => {
  const { team, runtime, lead } = fixture;
  const backend = await worker(fixture, 'Backend');
  const run = await team.runner.startUser(lead.memberId, 'go');
  for (const [text, expected] of [
    ['x'.repeat(maxResponseCharacters + 50), `${'x'.repeat(maxResponseCharacters)}\n\n[The response was cut at ${maxResponseCharacters} characters.]`],
    ['', 'Backend finished without a response.'],
  ] as const) {
    const call = team.runner.call(lead.memberId, run.runId, never, 'Backend', 'again');
    await settle();
    runtime.end(backend.memberId, text);
    assert.equal(await call, expected);
  }
}));

test('a recipient that fails, is cancelled, or is retired still ends the call', () => withTeam(async fixture => {
  const { team, runtime, lead } = fixture;
  const backend = await worker(fixture, 'Backend');
  const run = await team.runner.startUser(lead.memberId, 'go');

  let call = team.runner.call(lead.memberId, run.runId, never, 'Backend', 'one');
  await settle();
  runtime.fail(backend.memberId, 'Model request failed');
  assert.equal(await call, 'Backend failed: Model request failed');

  call = team.runner.call(lead.memberId, run.runId, never, 'Backend', 'two');
  await settle();
  await runtime.cancel(backend.memberId, runtime.active(backend.memberId)!.runId);
  assert.equal(await call, 'Backend was cancelled.');

  call = team.runner.call(lead.memberId, run.runId, never, 'Backend', 'three');
  await settle();
  const current = await team.service.get(fixture.workspaceId, backend.memberId);
  await team.runner.retire(fixture.workspaceId, backend.memberId, current.revision);
  assert.equal(await call, 'Backend was cancelled.');
  assert.equal(runtime.last(backend.memberId)!.cancelled, true);
}));

test('stopping the caller stops the recipient, down the chain', () => withTeam(async fixture => {
  const { team, runtime, lead } = fixture;
  const [a, b] = [await worker(fixture, 'Alpha'), await worker(fixture, 'Beta')];
  const run = await team.runner.startUser(lead.memberId, 'go');
  const stopLead = new AbortController();
  const callA = team.runner.call(lead.memberId, run.runId, stopLead.signal, 'Alpha', 'start');
  await settle();
  const stopAlpha = new AbortController();
  const callB = team.runner.call(a.memberId, runtime.active(a.memberId)!.runId, stopAlpha.signal, 'Beta', 'continue');
  await settle();
  assert.equal(runtime.active(b.memberId) !== undefined, true);

  stopLead.abort();
  assert.equal(await callA, 'Alpha was cancelled.');
  // The runtime aborts the tool of a cancelled run, which here is Alpha's call to Beta.
  stopAlpha.abort();
  assert.equal(await callB, 'Beta was cancelled.');
  assert.equal(runtime.active(a.memberId) === undefined && runtime.active(b.memberId) === undefined, true);
}));

test('a call that cannot happen is refused with a reason', () => withTeam(async fixture => {
  const { team, runtime, lead } = fixture;
  const [a, b] = [await worker(fixture, 'Alpha'), await worker(fixture, 'Beta')];
  await team.service.create(fixture.workspaceId, { name: 'Idle', role: 'x', settings: { connectionId: null, modelId: null } });
  const run = await team.runner.startUser(lead.memberId, 'go');
  const call = (from: string, runId: string, to: string, text = 'hi') => team.runner.call(from, runId, never, to, text);

  await assert.rejects(call(lead.memberId, run.runId, 'Nobody'), /No member named "Nobody". The team: Lead, Alpha, Beta, Idle/);
  await assert.rejects(call(lead.memberId, run.runId, 'Lead'), code('member_in_chain'));
  await assert.rejects(call(lead.memberId, run.runId, 'Idle'), /cannot run yet: Select a provider and model/);
  await assert.rejects(call(lead.memberId, run.runId, 'Alpha', '  '), code('invalid_input'));
  await assert.rejects(call('plain-agent', 'r', 'Alpha'), code('not_found'));
  assert.equal(runtime.runs.length, 1, 'no refused call started a run');

  const toAlpha = call(lead.memberId, run.runId, 'Alpha');
  await settle();
  const alphaRun = runtime.active(a.memberId)!.runId;
  await assert.rejects(call(a.memberId, alphaRun, 'Lead'), /already part of this chain of calls \(Lead → Alpha\)/);
  await assert.rejects(call(a.memberId, alphaRun, 'alpha'), code('member_in_chain'));
  const toBeta = call(a.memberId, alphaRun, 'Beta');
  await settle();
  await assert.rejects(call(b.memberId, runtime.active(b.memberId)!.runId, 'Alpha'), code('member_in_chain'));
  runtime.end(b.memberId, 'beta result');
  assert.equal(await toBeta, 'beta result');
  runtime.end(a.memberId, 'alpha result');
  assert.equal(await toAlpha, 'alpha result');
}));

test('a chain has at most five members, and a member that is already working is refused', () => withTeam(async fixture => {
  const { team, runtime, lead } = fixture;
  const members = [];
  for (let index = 1; index <= maxChainMembers; index++) members.push(await worker(fixture, `Member${index}`));
  let runId = (await team.runner.startUser(lead.memberId, 'go')).runId;
  let from = lead.memberId;
  const pending: Promise<string>[] = [];
  for (let index = 0; index < maxChainMembers - 1; index++) {
    pending.push(team.runner.call(from, runId, never, members[index]!.name, 'next'));
    await settle();
    from = members[index]!.memberId;
    runId = runtime.active(from)!.runId;
  }
  await assert.rejects(team.runner.call(from, runId, never, members[maxChainMembers - 1]!.name, 'one more'), code('chain_full'));

  // The user's run ends elsewhere, so a stray call from a run the team did not start sees only its caller in the chain.
  const stray = await worker(fixture, 'Stray');
  await runtime.start(stray.memberId, 'working');
  await assert.rejects(team.runner.call(lead.memberId, 'unknown-run', never, 'Stray', 'hi'), code('member_busy'));
  for (const member of members) runtime.end(member.memberId);
  await Promise.all(pending);
}));

test('only the lead takes input from the user, and only when it is idle', () => withTeam(async fixture => {
  const backend = await worker(fixture, 'Backend');
  await assert.rejects(fixture.team.runner.startUser(backend.memberId, 'hi'), code('member_conversation'));
  await fixture.team.runner.startUser(fixture.lead.memberId, 'one');
  await assert.rejects(fixture.team.runner.startUser(fixture.lead.memberId, 'two'), code('agent_busy'));
  assert.equal(fixture.runtime.runs.length, 1);
  await fixture.team.runner.startUser('plain-agent', 'not a member');
  assert.equal(fixture.runtime.last('plain-agent')?.input, 'not a member');
}));
