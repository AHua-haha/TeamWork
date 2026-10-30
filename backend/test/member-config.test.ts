import { acceptFiles, initGit } from './git-fixture.js';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { TeamSystem } from '../src/core/team/team-system.js';
import { sourceBundle, migrateMemberSource } from '../src/core/team/data/member-config.js';
import { code, stubConfig, withTeam, worker } from './team-fixture.js';

const assignment = (member: Awaited<ReturnType<typeof worker>>) => member.designScope;

test('accepted bundle contains meaningful JSON and Markdown; identity, revisions and policy stay in backend records', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const source = await f.team.configuration.activeSource(f.workspaceId, member.memberId);
  const manifest = JSON.parse(source.files['member.json']!);
  assert.deepEqual(Object.keys(manifest).sort(), ['designScope', 'name', 'promptFiles', 'responsibility', 'role', 'settings']);
  assert.deepEqual(manifest.designScope, member.designScope);
  assert.equal(source.formatVersion, 5);
  assert.equal(manifest.settings.prompt, undefined);
  assert.equal(manifest.implementationScope, undefined);
  const files = await f.team.memberWorkspace.files(f.lead.memberId);
  assert.equal(await readFile(join(files.root, source.path), 'utf8'), source.files['member.json']);
  await f.team.configuration.validate(member.memberId,'.rsi/members');
  assert.ok(await (await f.team.memberWorkspace.files(member.memberId)).read.readFile(join(f.directory,source.path)));
}));

test('invalid pending JSON and prompts never replace stable configuration, including after restart', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const accepted = await f.team.configuration.activeSource(f.workspaceId, member.memberId);
  const stored = await f.team.service.find(member.memberId);
  const files = await f.team.memberWorkspace.files(f.lead.memberId);
  await files.write.writeFile(join(files.root, accepted.path), '{invalid JSON');
  await files.write.writeFile(join(files.root, dirname(accepted.path), 'prompts/member.md'), 'Unaccepted prompt');
  assert.equal(await readFile(join(files.root, accepted.path), 'utf8'), '{invalid JSON');
  assert.deepEqual(await f.team.service.find(member.memberId), stored);
  const reopened = new TeamSystem(f.store, f.workspaces, stubConfig); reopened.attach(f.runtime);
  try { await reopened.initialize(); assert.deepEqual(await reopened.configuration.activeSource(f.workspaceId, member.memberId), accepted); }
  finally { await reopened.runner.close(); }
}));

test('materialization preserves intentional deletions after seeding rather than inventing metadata', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const source = await f.team.configuration.activeSource(f.workspaceId, member.memberId);
  const files = await f.team.memberWorkspace.files(f.lead.memberId);
  await rm(join(files.root, dirname(source.path)), { recursive: true });
  await assert.rejects(readFile(join(files.root, source.path), 'utf8'), code('ENOENT'));
  const plan = await f.team.configuration.validate(f.lead.memberId, '.rsi/members');
  assert.ok(plan.changes.some(change => change.type === 'delete' && change.memberId === member.memberId));
}));

test('runtime admission still rejects an actual concurrent backend configuration update', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  f.runtime.prepareRun = async () => {
    await f.team.service.update(f.workspaceId, member.memberId, member.revision, { name: member.name, role: member.role, responsibility: member.responsibility, designScope: assignment(member), settings: { ...member.settings, prompt: 'new' } });
    return {} as never;
  };
  await assert.rejects(f.team.runner.postUser(f.workspaceId, '@Backend start'), code('config_conflict'));
  assert.equal((await f.team.runner.snapshot(f.workspaceId)).messages.length, 0);
  assert.equal(f.runtime.runs.length, 0);
}));

test('user model preferences survive file activation and do not create pending member changes', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const initial = (await f.team.service.find(member.memberId))!.value.configuration!;
  const preference = { connectionId: 'conn', modelId: 'user-choice', modelOptions: [{ connectionId: 'conn', modelId: 'user-choice', reasoning: 'high' as const }] };
  await f.team.updateModelSettings(f.workspaceId, member.memberId, member.revision, preference);
  assert.equal((await f.team.service.find(member.memberId))!.value.configuration!.digest,initial.digest);
  const source=await f.team.configuration.activeSource(f.workspaceId,member.memberId);
  const files=await f.team.memberWorkspace.files(f.lead.memberId);
  await files.write.writeFile(join(files.root, source.path),JSON.stringify({...JSON.parse(source.files['member.json']!),responsibility:'Updated responsibility'}));
  await f.team.activateConfiguration(f.workspaceId);
  const active = await f.team.service.get(f.workspaceId,member.memberId);
  assert.equal(active.responsibility,'Updated responsibility'); assert.equal(active.settings.modelId,'user-choice');
  assert.equal((await f.team.service.find(member.memberId))!.value.settings.modelId,'model','manifest model remains unchanged');
}));

test('unified member names are the directory names, including supported spaces', () => withTeam(async f => {
  const member = await worker(f, 'Backend Worker', ['src']);
  const source = await f.team.configuration.activeSource(f.workspaceId, member.memberId);
  assert.equal(source.path, '.rsi/members/Backend Worker/member.json');
  assert.equal(JSON.parse(source.files['member.json']!).name, 'Backend Worker');
  const valid = await f.team.configuration.validate(f.lead.memberId, '.rsi/members');
  assert.equal(valid.valid, true, JSON.stringify(valid.issues));
  const files = await f.team.memberWorkspace.files(f.lead.memberId);
  const {rename} = await import('node:fs/promises');
  await rename(join(files.root, dirname(source.path)), join(files.root, '.rsi/members/other'));
  const invalid = await f.team.configuration.validate(f.lead.memberId, '.rsi/members');
  assert.equal(invalid.valid, false); assert.ok(invalid.issues.some(issue => /exactly match/.test(issue.message)));
}));

test('startup relocates legacy bundles with pending edits and preserves active identity without retaining Git aliases', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const {rename, writeFile} = await import('node:fs/promises');
  const {gitText} = await import('./native-git.js');
  const stored = (await f.team.service.find(member.memberId))!;
  const source = stored.value.configuration!, legacy = `.rsi/members/${stored.id}/member.json`;
  await rename(join(f.directory, dirname(source.path)), join(f.directory, dirname(legacy)));
  await f.store.updateMember(stored.id, stored.revision, stored.value.name.toLowerCase(), {...stored.value, configuration: {...source, path: legacy}});
  await initGit(f);
  await gitText(f.directory, ['config', 'user.name', 'Test']); await gitText(f.directory, ['config', 'user.email', 'test@example.invalid']);
  await gitText(f.directory, ['add', '-f', '-A', '--', '.rsi/members']); await gitText(f.directory, ['commit', '-m', 'Legacy member bundle']);
  const head = await gitText(f.directory, ['rev-parse', 'HEAD']);
  await writeFile(join(f.directory, dirname(legacy), 'prompts/member.md'), 'Pending prompt survives migration');
  await writeFile(join(f.directory, dirname(legacy), 'pending.txt'), 'Untracked pending file');
  await f.team.initialize();
  const migrated = (await f.team.service.find(stored.id))!;
  assert.equal(migrated.id, stored.id); assert.equal(migrated.value.configuration!.path, source.path);
  assert.equal('legacyPaths' in migrated.value.configuration!, false);
  assert.deepEqual(migrated.value.configuration!.files, source.files, 'active prompt snapshot remains accepted bytes');
  assert.equal(await readFile(join(f.directory, dirname(source.path), 'prompts/member.md'), 'utf8'), 'Pending prompt survives migration');
  assert.equal(await readFile(join(f.directory, dirname(source.path), 'pending.txt'), 'utf8'), 'Untracked pending file');
  assert.equal(await gitText(f.directory, ['rev-parse', 'HEAD']), head, 'migration makes no Git commit');
  const reviewed = await f.team.configuration.validate(f.lead.memberId,'.rsi/members');
  assert.equal(reviewed.valid, true, JSON.stringify(reviewed.issues)); assert.equal(reviewed.changes.length,1,'validation reads the current files, not the old commit');
  const pending = await f.team.configuration.validate(f.lead.memberId, '.rsi/members');
  assert.equal(pending.valid, true, JSON.stringify(pending.issues));
  assert.equal(pending.changes.length, 1); assert.equal(pending.changes[0]!.memberId, stored.id); assert.equal(pending.changes[0]!.type, 'update');
  await f.team.initialize(); assert.deepEqual(await f.team.service.find(stored.id), migrated, 'migration is idempotent');
}));

test('legacy directory migration refuses a conflicting destination without overwriting either directory', () => withTeam(async f => {
  const member = await worker(f, 'Backend', ['src']);
  const {rename, mkdir, writeFile} = await import('node:fs/promises');
  const stored = (await f.team.service.find(member.memberId))!, source = stored.value.configuration!;
  const legacy = `.rsi/members/${stored.id}/member.json`;
  await rename(join(f.directory, dirname(source.path)), join(f.directory, dirname(legacy)));
  const before = await f.store.updateMember(stored.id, stored.revision, 'backend', {...stored.value, configuration: {...source, path: legacy}});
  await mkdir(join(f.directory, dirname(source.path)), {recursive: true});
  await writeFile(join(f.directory, dirname(source.path), 'keep.txt'), 'Unrelated content');
  await assert.rejects(f.team.initialize(), code('config_conflict'));
  assert.deepEqual(await f.team.service.find(stored.id), before);
  assert.equal(await readFile(join(f.directory, legacy), 'utf8'), source.files['member.json']);
  assert.equal(await readFile(join(f.directory, dirname(source.path), 'keep.txt'), 'utf8'), 'Unrelated content');
}));

test('old Git acceptance and chained source history are discarded without changing active snapshot bytes', () => withTeam(async f => {
  const member=await worker(f,'Backend',['src']);
  const stored=(await f.team.service.find(member.memberId))!,source=stored.value.configuration!;
  const retired={...source,acceptedRevision:'old-git-hash',previous:{...source,files:{old:'Retired history'}},legacyPaths:['.rsi/members/old/member.json'],legacyManifestHashes:['old-blob-hash']};
  await f.store.updateMember(stored.id,stored.revision,'backend',{...stored.value,configuration:retired});
  await f.team.initialize();
  const current=(await f.team.service.find(member.memberId))!.value.configuration!;
  for(const field of ['acceptedRevision','previous','legacyPaths','legacyManifestHashes'])assert.equal(field in current,false);
  assert.deepEqual(current.files,source.files);assert.equal(current.digest,source.digest);
  assert.equal(migrateMemberSource(current),null,'cleanup is idempotent');
}));
