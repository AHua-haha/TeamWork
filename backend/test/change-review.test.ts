import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTeam, code } from './team-fixture.js';

const signal = new AbortController().signal;
test('Changes reads approved scopes with bounded Git calls and no configuration/design reconstruction', () => withTeam(async f => {
  const lead = f.lead.memberId, env = await f.team.harness.environment(lead);
  const part = env.parts.find(p => p.id === 'design')!;
  const source = join(env.root, '.rsi/context/design/design.md');
  await writeFile(source, '# Changed design\n');
  await env.history.scopedGit(lead, part, env.root, ['add', '.rsi/context/design/design.md'], env.root, {type:'agent',memberId:lead});
  const staged = await env.history.scopedGit(lead, part, env.root, ['diff','--cached'], env.root, {type:'agent',memberId:lead});
  await mkdir(join(env.root, '.rsi/context/design/design'), {recursive:true});
  await Promise.all(Array.from({length:80}, (_,i)=>writeFile(join(env.root, `.rsi/context/design/design/doc-${i}.md`), `# Document ${i}\n`)));
  await mkdir(join(env.root, '.rsi/members/proposed'), {recursive:true});
  await writeFile(join(env.root, '.rsi/members/proposed/member.json'), '{invalid pending JSON');
  // Neither invalid pending prose/schema nor unavailable semantic assignments prevent file inspection.
  f.team.configuration.current = async () => { throw new Error('Full inspection must not run'); };
  f.team.configuration.materialize = async () => { throw new Error('Materialization must not run'); };
  f.team.designs.read = async () => { throw new Error('Design resolution must not run'); };
  f.team.harness.environment = async () => { throw new Error('Full harness assembly must not run'); };
  const history = env.history as any, git = history.git;
  let commands = 0;
  history.git = function(...args:unknown[]) { commands++; return git.apply(this,args); };
  const review = await f.team.changes(f.workspaceId);
  assert.equal(review.design.changes.length,81);
  assert.equal(review.members.changes.length,1);
  assert.match(review.members.changes[0]!.patch,/invalid pending JSON/);
  assert.ok(commands <= 24, `Review must batch Git work, saw ${commands} commands for 82 changes`);
  assert.equal(review.activation.hasChanges,false);
  assert.equal(await env.history.scopedGit(lead, part, env.root, ['diff','--cached'], env.root, {type:'agent',memberId:lead}),staged);
}));

test('review includes deleted, untracked, quoted and binary files and preserves exact approval safety', () => withTeam(async f => {
  const lead = f.lead.memberId, env = await f.team.harness.environment(lead);
  const rootFile=join(env.root,'.rsi/context/design/design.md');
  const original=await readFile(rootFile,'utf8');
  await writeFile(rootFile, original+'\nReviewed update.\n');
  const first=await f.team.harness.review(lead,'design');
  await writeFile(rootFile, original+'\nNewer update.\n');
  await assert.rejects(f.team.harness.commit(lead,'design','Accept stale',{type:'user',memberId:lead},first.revision,first.base),code('stale_revision'));
  const current=await f.team.harness.review(lead,'design');
  await f.team.harness.commit(lead,'design','Accept current',{type:'user',memberId:lead},current.revision,current.base);
  assert.equal((await f.team.harness.review(lead,'design')).changes.length,0);
  await assert.rejects(f.team.harness.commit(lead,'design','Accept old base',{type:'user',memberId:lead},current.revision,current.base),code('stale_revision'));
  const dir=join(env.root,'.rsi/members/pending'); await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'space "quoted".txt'),'new file');
  await writeFile(join(dir,'binary'),Buffer.from([0,255,1]));
  await rm(join(env.root, '.rsi/members',lead,'prompts/member.md'));
  const files=(await f.team.harness.review(lead,'member-config')).changes;
  assert.ok(files.some(c=>c.action==='delete'));
  assert.match(files.find(c=>c.path.endsWith('space "quoted".txt'))!.patch,/new file/);
  assert.match(files.find(c=>c.path.endsWith('/binary'))!.patch,/Binary files/);
  await symlink(rootFile,join(dir,'link'));
  await assert.rejects(f.team.harness.review(lead,'member-config'),code('invalid_path'));
}));
