import assert from 'node:assert/strict';
import { test } from 'node:test';
import { code, withTeam, worker } from './team-fixture.js';

test('current catalog discovers unassigned designs by schema, omits ordinary notes and malformed records, and survives retirement', () => withTeam(async fixture => {
  const base = await fixture.workspaces.context(fixture.workspaceId);
  await base.save('user/notes.md', '# Ordinary notes', null, null);
  await base.save('user/not-design.json', '{"other": true}', null, null);
  await base.save('user/invalid.json', '{"content":"Bad","implementation":["../outside"]}', null, null);
  const loose = await base.save('user/architecture.md', JSON.stringify({ content: '# Architecture', implementation: ['src'] }), null, null);
  await base.save('agent/hidden.json', JSON.stringify({ content: '# Internal', implementation: ['src'] }), null, null).catch(error => assert.equal(error.code, 'read_only'));
  const backend = await worker(fixture, 'Backend', ['backend']);
  const seq = (await base.overview()).seq;
  const catalog = await fixture.team.designs.list(fixture.workspaceId);
  assert.deepEqual(catalog.designs.map(item => item.path), ['user/architecture.md', 'user/design/backend.json']);
  assert.deepEqual(catalog.designs[0], { path: 'user/architecture.md', revision: loose.revision, implementation: ['src'] });
  assert.equal(catalog.truncated, false);
  assert.equal((await base.overview()).seq, seq);
  await fixture.team.runner.retire(fixture.workspaceId, backend.memberId, backend.revision);
  assert.deepEqual((await fixture.team.designs.list(fixture.workspaceId)).designs, catalog.designs);
  const invalid = await fixture.team.designs.inspect(fixture.workspaceId, 'user/invalid.json');
  assert.equal(invalid.design, null);
  assert.ok(invalid.designIssue);
  const valid = await fixture.team.designs.inspect(fixture.workspaceId, 'user/architecture.md');
  assert.deepEqual(valid.design, { content: '# Architecture', implementation: ['src'] });
  await base.delete('user/architecture.md', loose.revision, null);
  await assert.rejects(fixture.team.designs.inspect(fixture.workspaceId, 'user/architecture.md'), code('not_found'));
  assert.deepEqual((await fixture.team.designs.list(fixture.workspaceId)).designs.map(item => item.path), ['user/design/backend.json']);
}));
