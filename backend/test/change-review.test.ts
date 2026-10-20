import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile,mkdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { withTeam,code } from './team-fixture.js';
import { acceptFiles,initGit } from './git-fixture.js';
import { gitText } from '../src/workspace-git.js';
test('Changes reads ordinary committed-to-current files without staging, checkpoints or full configuration validation',()=>withTeam(async f=>{
 await acceptFiles(f,'.rsi/context/design');await initGit(f);
 await writeFile(join(f.directory,'.rsi/context/design/design.md'),'Pending');await gitText(f.directory,['add','-f','.rsi/context/design/design.md']);const index=await gitText(f.directory,['write-tree']);
 await mkdir(join(f.directory,'.rsi/context/design/extra'),{recursive:true});await writeFile(join(f.directory,'.rsi/context/design/extra/notes.md'),'New notes');
 f.team.configuration.review=async()=>{throw new Error('Full validation must not block changes');};
 const view=await f.team.changes(f.workspaceId);assert.equal(view.design.changes.length,2);assert.match(view.design.changes.find(c=>c.path.endsWith('design.md'))!.patch,/Pending/);assert.equal(await gitText(f.directory,['write-tree']),index);
}));
test('file review includes deletion, untracked and quoted paths; unsupported control symlinks refuse',()=>withTeam(async f=>{
 await acceptFiles(f,'.rsi/context/design');await rm(join(f.directory,'.rsi/context/design/design.md'));await writeFile(join(f.directory,'.rsi/context/design/a "quote".md'),'Untracked');
 const changes=(await f.team.changes(f.workspaceId)).design.changes;assert.ok(changes.some(c=>c.action==='delete'));assert.ok(changes.some(c=>c.action==='add'&&c.path.includes('quote')));
 const {symlink}=await import('node:fs/promises');await symlink('/tmp',join(f.directory,'.rsi/context/design/link'));await assert.rejects(f.team.changes(f.workspaceId),code('invalid_path'));
}));
