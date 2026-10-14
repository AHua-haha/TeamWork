import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mentions } from '../src/group-chat.js';
import { code, settle, withTeam, worker } from './team-fixture.js';

const textOf = (entries: { message: { content: unknown } }[]) => entries.map(entry => String(entry.message.content));

test('mentions use exact names, braces and case-insensitive deduplication; emails are ordinary text', () => {
  assert.deepEqual(mentions('@Backend @backend @{Frontend Worker} user@example.com'), ['backend', 'Frontend Worker']);
  assert.deepEqual(mentions('foo@Backend x@domain.test'), []);
  for (const text of ['@{Backend Worker', '@{}', '@{Backend\nWorker}']) assert.throws(() => mentions(text), code('invalid_input'));
});

test('all members receive messages but only mentioned members activate, in parallel', () => withTeam(async f => {
  const backend = await worker(f, 'Backend'); const frontend = await worker(f, 'Frontend');
  const result = await f.team.runner.postUser(f.workspaceId, '@Backend @Frontend build');
  assert.equal(result.runs.length, 2);
  assert.ok(f.runtime.active(backend.memberId) && f.runtime.active(frontend.memberId));
  assert.equal(f.runtime.active(f.lead.memberId), undefined);
  for (const member of [f.lead, backend, frontend]) assert.equal(f.store.agentContexts.get(member.memberId)?.length, 1);
  const firstRun = f.runtime.active(backend.memberId)!.runId;
  await f.team.runner.publishFinal(backend.memberId, firstRun, 'Backend done without mentions', 'final');
  assert.equal(f.runtime.active(backend.memberId), undefined);
  assert.equal(f.store.agentContexts.get(f.lead.memberId)?.length, 2);
  assert.equal(f.store.agentContexts.get(frontend.memberId)?.length, 1);
  f.runtime.end(frontend.memberId);
  await settle();
  assert.equal(f.store.agentContexts.get(frontend.memberId)?.length, 2);
  assert.equal(f.runtime.runs.length, 2, 'buffer flushing starts no run');
}));

test('busy members buffer all accepted shared messages after private work; idle members append immediately', () => withTeam(async f => {
  const backend = await worker(f, 'Backend');
  await f.team.runner.postUser(f.workspaceId, '@Backend start');
  const context = f.store.agentContexts.get(backend.memberId)!;
  context.push({ messageId: 'private', message: { role: 'user', content: 'PRIVATE WORK', timestamp: 1 }, metadata: { private: true } });
  await f.team.runner.postUser(f.workspaceId, '@Lead discuss');
  assert.equal(context.length, 2);
  assert.equal(f.store.agentContexts.get(f.lead.memberId)?.length, 2);
  f.runtime.end(backend.memberId); await settle();
  assert.deepEqual(textOf(context), ['[Group message 1 from User]\n@Backend start', 'PRIVATE WORK', '[Group message 2 from User]\n@Lead discuss']);
  assert.equal(f.runtime.runs.length, 2);
}));

test('busy, unknown, self and unready recipients refuse entire publications without partial delivery', () => withTeam(async f => {
  const backend = await worker(f, 'Backend'); const frontend = await worker(f, 'Frontend');
  await f.team.service.create(f.workspaceId, { name: 'Unready', role: 'developer' });
  const first = await f.team.runner.postUser(f.workspaceId, '@Backend start');
  for (const [text, error] of [['@Backend @Frontend work', 'member_busy'], ['@Nobody work', 'not_found'], ['@Unready work', 'member_unavailable']] as const) await assert.rejects(f.team.runner.postUser(f.workspaceId, text), code(error));
  await assert.rejects(f.team.runner.publishFinal(backend.memberId, first.runs[0]!.runId, '@Backend again', 'final'), code('self_mention'));
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 1);
  assert.equal(f.runtime.active(frontend.memberId), undefined);
  assert.equal(f.store.agentContexts.get(f.lead.memberId)?.length, 1);
}));

test('default lead routing, return mentions, and limit count accepted activations only', () => withTeam(async f => {
  const backend = await worker(f, 'Backend');
  await f.team.runner.configure(f.workspaceId, 2);
  const user = await f.team.runner.postUser(f.workspaceId, 'implement');
  assert.equal(user.runs[0]!.agentId, f.lead.memberId);
  const assignment = await f.team.runner.publishFinal(f.lead.memberId, user.runs[0]!.runId, '@Backend @backend work', 'final');
  assert.deepEqual(assignment.recipients, [backend.memberId]);
  const run = f.runtime.active(backend.memberId)!;
  await assert.rejects(f.team.runner.publishFinal(backend.memberId, run.runId, '@Lead review', 'final'), code('mention_limit'));
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 2);
  await f.team.runner.publishFinal(backend.memberId, run.runId, 'Finished.', 'final');
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 3);
  const next = await f.team.runner.postUser(f.workspaceId, 'another exchange');
  assert.notEqual(next.message.exchangeId, user.message.exchangeId);
}));

test('storage refusal publishes nothing and starts no member', () => withTeam(async f => {
  f.store.failNextPublication = true;
  await assert.rejects(f.team.runner.postUser(f.workspaceId, 'work'), /publication failure/);
  assert.equal(f.runtime.runs.length, 0);
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 0);
}));

test('stop cancels parallel work; retiring a worker cancels it and preserves shared history', () => withTeam(async f => {
  const backend = await worker(f, 'Backend'); const frontend = await worker(f, 'Frontend');
  await f.team.runner.postUser(f.workspaceId, '@Backend @Frontend work');
  await f.team.runner.retire(f.workspaceId, backend.memberId, backend.revision);
  assert.equal(f.runtime.last(backend.memberId)?.status, 'cancelled');
  await f.team.runner.stop(f.workspaceId); await settle();
  assert.equal(f.runtime.last(frontend.memberId)?.status, 'cancelled');
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 1);
}));

test('follow synchronizes stable shared records and continues across activations; disconnect stops no work', () => withTeam(async f => {
  const accepted = await f.team.runner.postUser(f.workspaceId, 'work');
  const controller = new AbortController();
  const stream = f.team.runner.follow(f.workspaceId, 0, controller.signal);
  assert.equal((await stream.next()).value?.type, 'message');
  assert.equal((await stream.next()).value?.type, 'sync');
  assert.equal((await stream.next()).value?.type, 'state');
  const pending = stream.next();
  await f.team.runner.publishFinal(f.lead.memberId, accepted.runs[0]!.runId, 'Finished.', 'final');
  assert.equal((await pending).value?.type, 'message');
  controller.abort(); await stream.return();
  const next = await f.team.runner.postUser(f.workspaceId, 'more');
  assert.equal(next.message.position, 3);
  assert.ok(f.runtime.active(f.lead.memberId));
}));

test('shutdown waits for in-flight publication to register work and rejects subsequent input', () => withTeam(async f => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const preparing = new Promise<void>(resolve => { entered = resolve; });
  const prepare = f.runtime.prepareRun.bind(f.runtime);
  f.runtime.prepareRun = async () => { entered(); await gate; return prepare(); };
  const publication = f.team.runner.postUser(f.workspaceId, 'start');
  await preparing;
  const shutdown = f.team.runner.close();
  await assert.rejects(f.team.runner.postUser(f.workspaceId, 'later'), code('runtime_unavailable'));
  release();
  const accepted = await publication;
  await shutdown;
  assert.ok(f.runtime.active(f.lead.memberId));
  assert.equal(accepted.runs.length, 1);
}));

test('timeline follow delivers terminal updates for earlier reserved sections while preserving positions', () => withTeam(async f => {
  const accepted = await f.team.runner.postUser(f.workspaceId, 'work');
  const controller = new AbortController();
  const stream = f.team.runner.followTimeline(f.workspaceId, 0, controller.signal);
  assert.equal((await stream.next()).value?.type, 'entry');
  const reserved = (await stream.next()).value;
  assert.equal(reserved?.type, 'entry');
  assert.equal(reserved && 'change' in reserved ? reserved.change?.entry.position : undefined, 2);
  assert.equal((await stream.next()).value?.type, 'sync');
  assert.equal((await stream.next()).value?.type, 'settings');
  const waiting = stream.next();
  await f.team.runner.publishFinal(f.lead.memberId, accepted.runs[0]!.runId, 'Final report', 'committed-final');
  const update = (await waiting).value;
  assert.equal(update?.type, 'entry');
  assert.equal(update && 'change' in update ? update.change?.entry.position : undefined, 2);
  controller.abort(); await stream.return();
}));
