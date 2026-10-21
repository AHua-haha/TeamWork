import assert from 'node:assert/strict';
import { test } from 'node:test';
import { userMentions } from '../src/domain/team/group-chat.js';
import { code, settle, withTeam, worker } from './team-fixture.js';

const textOf = (entries: { message: { content: unknown } }[]) => entries.map(entry => String(entry.message.content));

test('mentions use exact names, braces and case-insensitive deduplication; emails are ordinary text', () => {
  assert.deepEqual(userMentions('@Backend @backend @{Frontend Worker} user@example.com'), ['backend', 'Frontend Worker']);
  assert.deepEqual(userMentions('foo@Backend x@domain.test'), []);
  for (const text of ['@{Backend Worker', '@{}', '@{Backend\nWorker}']) assert.throws(() => userMentions(text), code('invalid_input'));
});

test('scoped package and path identifiers are not member mentions', () => {
  assert.deepEqual(userMentions('Use `@joplin/lib`, @types/node and @anthropic-ai/sdk.'), []);
  assert.deepEqual(userMentions('@scope/package@1.0.0 https://registry.npmjs.org/@scope/package'), []);
  assert.deepEqual(userMentions('@joplin/lib @Backend review this with @{Frontend Worker} and @types/node'), ['Backend', 'Frontend Worker']);
  assert.deepEqual(userMentions('@Backend/path @Backend @{Backend}'), ['Backend']);
});

test('reports with scoped packages publish once without activating matching member names', () => withTeam(async f => {
  const namedLikePackage = await worker(f, 'joplin');
  const accepted = await f.team.runner.postUser(f.workspaceId, 'Research @joplin/lib and @types/node');
  assert.equal(accepted.runs.length, 1);
  assert.equal(accepted.runs[0]!.agentId, f.lead.memberId);
  const report = 'Use `@joplin/lib` with @types/node. This is the complete report.';
  const published = await f.team.runner.publishFinal(f.lead.memberId, accepted.runs[0]!.runId, report, 'final');
  assert.deepEqual(published.recipients, []);
  assert.equal(published.text, report);
  assert.equal(f.runtime.active(namedLikePackage.memberId), undefined);
  const chat = await f.team.runner.snapshot(f.workspaceId);
  assert.equal(chat.messages.filter(message => message.author.type === 'member').length, 1);
}));

test('agent bodies never trigger members and an empty header is removed from the shared body', () => withTeam(async f => {
  const backend = await worker(f, 'Backend');
  const first = await f.team.runner.postUser(f.workspaceId, 'Report');
  const body = '@Backend @Nobody @joplin/lib @{unfinished\n<mentions>["Ignored"]</mentions>';
  const report = await f.team.runner.publishFinal(f.lead.memberId, first.runs[0]!.runId, body, 'final');
  assert.deepEqual(report.recipients, []);
  assert.equal(report.text, body);
  assert.equal(f.runtime.active(backend.memberId), undefined);
  const second = await f.team.runner.postUser(f.workspaceId, 'Another report');
  const empty = await f.team.runner.publishFinal(f.lead.memberId, second.runs[0]!.runId, '<mentions>\n</mentions>\n\nDone @Nobody', 'final');
  assert.equal(empty.text, 'Done @Nobody');
  assert.deepEqual(empty.recipients, []);
}));

test('header validation refuses multiple recipients atomically and a revised header admits one recipient', () => withTeam(async f => {
  const backend = await worker(f, 'Backend'), frontend = await worker(f, 'Frontend Worker');
  const start = await f.team.runner.postUser(f.workspaceId, 'Delegate');
  for (const [text, expected] of [
    ['<mentions>bad</mentions>\nBody', 'invalid_mentions'],
    ['<mentions>["Missing"]</mentions>\nBody', 'not_found'],
    ['<mentions>["Backend","Frontend Worker"]</mentions>\nBody', 'invalid_mentions'],
    ['<mentions>["Lead"]</mentions>\nBody', 'self_mention'],
  ]) {
    await assert.rejects(f.team.runner.publishFinal(f.lead.memberId, start.runs[0]!.runId, text, 'final'), code(expected!));
    assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 1);
    assert.equal(f.runtime.active(backend.memberId), undefined);
    assert.equal(f.runtime.active(frontend.memberId), undefined);
  }
  const result = await f.team.runner.publishFinal(f.lead.memberId, start.runs[0]!.runId, '<mentions>["Backend", "backend"]</mentions>\n\nWork. @Nobody is ordinary content.', 'final');
  assert.equal(result.text, 'Work. @Nobody is ordinary content.');
  assert.deepEqual(result.recipients, [backend.memberId]);
  assert.ok(f.runtime.active(backend.memberId));
  assert.equal(f.runtime.active(frontend.memberId), undefined);
}));

test('shared messages stay authoritative and user mentions preserve multi-recipient admission', () => withTeam(async f => {
  const backend = await worker(f, 'Backend'); const frontend = await worker(f, 'Frontend');
  const result = await f.team.runner.postUser(f.workspaceId, '@Backend @Frontend build');
  assert.equal(result.runs.length, 2);
  assert.ok(f.runtime.active(backend.memberId) && f.runtime.active(frontend.memberId));
  assert.equal(f.runtime.active(f.lead.memberId), undefined);
  assert.equal(f.store.agentContexts.get(f.lead.memberId)?.length, 0);
  for (const member of [backend, frontend]) assert.equal(f.store.agentContexts.get(member.memberId)?.length, 1);
  const firstRun = f.runtime.active(backend.memberId)!.runId;
  await f.team.runner.publishFinal(backend.memberId, firstRun, 'Backend done without mentions', 'final');
  assert.equal(f.runtime.active(backend.memberId), undefined);
  assert.equal(f.store.agentContexts.get(f.lead.memberId)?.length, 0);
  assert.equal(f.store.agentContexts.get(frontend.memberId)?.length, 1);
  f.runtime.end(frontend.memberId);
  await settle();
  assert.equal(f.store.agentContexts.get(frontend.memberId)?.length, 0);
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).messages.length, 2);
  assert.equal(f.runtime.runs.length, 2, 'context bookkeeping starts no run');
}));

test('group updates do not insert into ongoing working context or idle member context', () => withTeam(async f => {
  const backend = await worker(f, 'Backend');
  await f.team.runner.postUser(f.workspaceId, '@Backend start');
  const context = f.store.agentContexts.get(backend.memberId)!;
  context.push({ messageId: 'private', message: { role: 'user', content: 'PRIVATE WORK', timestamp: 1 }, metadata: { private: true } });
  await f.team.runner.postUser(f.workspaceId, '@Lead discuss');
  assert.equal(context.length, 2);
  assert.equal(f.store.agentContexts.get(f.lead.memberId)?.length, 2);
  f.runtime.end(backend.memberId); await settle();
  assert.equal(context.length, 2);
  assert.ok(!textOf(context).some(text => text.includes('@Lead discuss')));
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).messages.length, 2);
  assert.equal(f.runtime.runs.length, 2);
}));

test('busy, unknown, self and unready recipients refuse entire publications without partial delivery', () => withTeam(async f => {
  const backend = await worker(f, 'Backend'); const frontend = await worker(f, 'Frontend');
  await f.team.service.create(f.workspaceId, { name: 'Unready', role: 'developer' });
  const first = await f.team.runner.postUser(f.workspaceId, '@Backend start');
  for (const [text, error] of [['@Backend @Frontend work', 'member_busy'], ['@Nobody work', 'not_found'], ['@Unready work', 'member_unavailable']] as const) await assert.rejects(f.team.runner.postUser(f.workspaceId, text), code(error));
  await assert.rejects(f.team.runner.publishFinal(backend.memberId, first.runs[0]!.runId, '<mentions>["Backend"]</mentions>\nAgain', 'final'), code('self_mention'));
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).position, 1);
  assert.equal(f.runtime.active(frontend.memberId), undefined);
  assert.equal(f.store.agentContexts.get(f.lead.memberId)?.length, 0);
}));

test('default lead routing, return mentions, and limit count accepted activations only', () => withTeam(async f => {
  const backend = await worker(f, 'Backend');
  await f.team.runner.configure(f.workspaceId, 2);
  const user = await f.team.runner.postUser(f.workspaceId, 'implement');
  assert.equal(user.runs[0]!.agentId, f.lead.memberId);
  const assignment = await f.team.runner.publishFinal(f.lead.memberId, user.runs[0]!.runId, '<mentions>["Backend","backend"]</mentions>\nWork', 'final');
  assert.deepEqual(assignment.recipients, [backend.memberId]);
  const run = f.runtime.active(backend.memberId)!;
  await assert.rejects(f.team.runner.publishFinal(backend.memberId, run.runId, '<mentions>["Lead"]</mentions>\nReview', 'final'), code('mention_limit'));
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

test('stop cancels admitted work; retiring a worker cancels it and preserves shared history', () => withTeam(async f => {
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

test('reset requires idle work, clears the workspace conversation and wakes both durable followers', () => withTeam(async f => {
  const backend = await worker(f, 'Backend');
  const members = await f.team.service.team(f.workspaceId);
  await f.team.runner.configure(f.workspaceId, 7);
  const accepted = await f.team.runner.postUser(f.workspaceId, 'Old conversation');
  const before = await f.team.runner.timeline(f.workspaceId);
  await assert.rejects(f.team.runner.reset(f.workspaceId), code('workspace_busy'));
  assert.deepEqual(await f.team.runner.timeline(f.workspaceId), before);
  f.runtime.end(f.lead.memberId); await settle();
  const reset = await f.team.runner.reset(f.workspaceId);
  assert.ok(reset.resetCursor > before.cursor);
  assert.equal((await f.team.runner.timeline(f.workspaceId)).changes.length, 0);
  assert.equal((await f.team.runner.timeline(f.workspaceId)).more, false);
  assert.deepEqual((await f.team.runner.snapshot(f.workspaceId)).messages, []);
  assert.deepEqual((await f.team.runner.snapshot(f.workspaceId)).runs, []);
  for (const member of [f.lead, backend]) assert.deepEqual(f.store.agentContexts.get(member.memberId), []);
  assert.deepEqual(await f.team.service.team(f.workspaceId), members);
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).mentionLimit, 7);
  const controller = new AbortController();
  const timeline = f.team.runner.followTimeline(f.workspaceId, before.cursor, controller.signal);
  const legacy = f.team.runner.follow(f.workspaceId, accepted.message.position, controller.signal);
  assert.deepEqual((await timeline.next()).value, { version: 1, type: 'reset', workspaceId: f.workspaceId, cursor: reset.resetCursor });
  assert.deepEqual((await legacy.next()).value, { version: 1, type: 'reset', workspaceId: f.workspaceId, position: reset.resetPosition });
  assert.equal((await timeline.next()).value?.type, 'sync');
  assert.equal((await timeline.next()).value?.type, 'settings');
  const waiting = timeline.next();
  const fresh = await f.team.runner.postUser(f.workspaceId, 'New conversation');
  assert.equal((await waiting).value?.type, 'entry');
  assert.ok(fresh.entries[0]!.revision > reset.resetCursor);
  assert.ok(fresh.message.position > reset.resetPosition);
  assert.ok(textOf(f.store.agentContexts.get(f.lead.memberId)!).some(t => t.endsWith('New conversation')));
  controller.abort(); await timeline.return(); await legacy.return();
}));

test('reset refuses a completed publication whose runtime is still finalizing', () => withTeam(async f => {
  let release!: () => void;
  const finalization = new Promise<void>(resolve => { release = resolve; });
  const finished = f.runtime.finished.bind(f.runtime);
  f.runtime.finished = async (...args) => { const run = await finished(...args); await finalization; return run; };
  const accepted = await f.team.runner.postUser(f.workspaceId, 'Work');
  await f.team.runner.publishFinal(f.lead.memberId, accepted.runs[0]!.runId, 'Complete', 'final');
  assert.equal(f.team.runner.isRunning(f.lead.memberId), false);
  await assert.rejects(f.team.runner.reset(f.workspaceId), code('workspace_busy'));
  release(); await settle();
  await f.team.runner.reset(f.workspaceId);
  assert.deepEqual((await f.team.runner.snapshot(f.workspaceId)).messages, []);
}));

test('reset and new publication serialize so new input cannot enter the cleared conversation', () => withTeam(async f => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const reset = f.store.resetChat.bind(f.store);
  f.store.resetChat = async workspaceId => { entered(); await hold; return reset(workspaceId); };
  const resetting = f.team.runner.reset(f.workspaceId);
  await started;
  let posted = false;
  const sending = f.team.runner.postUser(f.workspaceId, 'Fresh input').then(result => { posted = true; return result; });
  await settle(); assert.equal(posted, false);
  release(); const boundary = await resetting; const fresh = await sending;
  assert.ok(fresh.entries[0]!.revision > boundary.resetCursor);
  assert.deepEqual((await f.team.runner.snapshot(f.workspaceId)).messages.map(item => item.text), ['Fresh input']);
}));

test('an already connected idle timeline observes reset and synchronizes at its new durable boundary', () => withTeam(async f => {
  const controller = new AbortController();
  const stream = f.team.runner.followTimeline(f.workspaceId, 0, controller.signal);
  assert.equal((await stream.next()).value?.type, 'sync');
  assert.equal((await stream.next()).value?.type, 'settings');
  const waiting = stream.next();
  const result = await f.team.runner.reset(f.workspaceId);
  assert.deepEqual((await waiting).value, { version: 1, workspaceId: f.workspaceId, type: 'reset', cursor: result.resetCursor });
  assert.deepEqual((await stream.next()).value, { version: 1, workspaceId: f.workspaceId, type: 'sync', cursor: result.resetCursor });
  controller.abort(); await stream.return();
}));


test('workspace execution lock waits for release, cancels waiting acquisition, and remains reusable',()=>withTeam(async f=>{
  const backend=await worker(f,'Backend');
  const first=await f.team.runner.acquireExecution(f.lead.memberId,new AbortController().signal);
  let entered=false;
  const abort=new AbortController();
  const waiting=f.team.runner.acquireExecution(backend.memberId,abort.signal).then(release=>{entered=true;return release;});
  await settle();assert.equal(entered,false);
  abort.abort();await assert.rejects(waiting,code('cancelled'));
  let nextEntered=false;
  const next=f.team.runner.acquireExecution(backend.memberId,new AbortController().signal).then(release=>{nextEntered=true;return release;});
  await settle();assert.equal(nextEntered,false);
  first();const release=await next;assert.equal(nextEntered,true);release();
}));

test('picture publication refuses a text-only recipient without storing or activating anything', () => withTeam(async f => {
  const { prepareChatImage } = await import('../src/domain/team/chat-images.js');
  const { png } = await import('./image-fixture.js');
  f.runtime.prepareRun = async () => ({ model: { input: ['text'] } }) as any;
  await assert.rejects(f.team.runner.postUser(f.workspaceId, '', [await prepareChatImage(png(), 'screen.png')]), /without image input/);
  assert.equal(f.store.chatImages.size, 0); assert.equal(f.runtime.runs.length, 0);
}));
