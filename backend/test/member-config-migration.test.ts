import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {generatedSource,sourceBundle} from '../src/core/team/data/member-config.js';
import {memberFields,type MemberRecord,type MemberView} from '../src/core/team/data/members.js';
import {upgradeMemberManifest} from '../src/core/team/data/member-config-migration.js';
import {gitText} from './native-git.js';
import {initGit} from './git-fixture.js';
import {withTeam,worker,code,type Fixture} from './team-fixture.js';

async function legacy(f:Fixture,member:MemberView,retired=false){
 const current=(await f.team.service.find(member.memberId))!,source=current.value.configuration!;
 const manifest={...JSON.parse(source.files['member.json']!),execute:{allowedCommands:[{kind:'executable',executable:'bash'}]}};
 const raw=JSON.stringify(manifest,null,2)+'\n';
 const oldSource={...source,...sourceBundle(source.path,{...source.files,'member.json':raw},'user'),formatVersion:4};
 const {designScope,...other}=current.value;
 const value={...other,harness:{designScope,allowedCommands:manifest.execute.allowedCommands},configuration:oldSource,...(retired?{retiredAt:123}:{})};
 await f.store.updateMember(current.id,current.revision,retired?null:member.name.toLowerCase(),value as unknown as MemberRecord);
 await writeFile(join(f.directory,source.path),raw);
 return {source:oldSource,manifest,raw};
}

test('members expose design assignment directly and reject legacy Harness configuration on current inputs',()=>withTeam(async f=>{
 const member=await worker(f,'Backend',['src']);
 assert.deepEqual(member.designScope,{working:['systems/backend/metadata.json'],dependencies:[]});
 for(const key of ['harness','harnesses','execute','allowedCommands','implementationScope'])assert.equal(key in member,false);
 const fields={name:member.name,role:member.role,responsibility:member.responsibility,settings:member.settings,designScope:member.designScope};
 assert.deepEqual(JSON.parse(generatedSource(fields).files['member.json']!).designScope,member.designScope);
 assert.throws(()=>memberFields({...fields,harness:{designScope:member.designScope}}));
 const text=JSON.stringify({name:'Old',harnesses:{project:{designScope:member.designScope}},execute:{allowedCommands:[]},promptFiles:['prompts/member.md']});
 const upgraded=JSON.parse(upgradeMemberManifest(text));assert.deepEqual(upgraded.designScope,member.designScope);assert.equal('harnesses' in upgraded,false);assert.equal('execute' in upgraded,false);
 assert.equal('inspect' in f.team,false);assert.equal('inspect' in f.team.service,false);
}));

test('startup migrates records and manifests without activating pending edits, rewriting Git or losing context',()=>withTeam(async f=>{
 const member=await worker(f,'Backend',['src']),old=await legacy(f,member);
 await initGit(f);await gitText(f.directory,['add','-f','-A','--','.rsi/members']);await gitText(f.directory,['commit','-m','Old member format']);
 const head=await gitText(f.directory,['rev-parse','HEAD']);
 const retained=[{messageId:'retained',message:{role:'user' as const,content:'Existing context',timestamp:1},metadata:{source:'test'}}];
 f.store.agentContexts.set(member.memberId,retained);
 await writeFile(join(f.directory,old.source.path),JSON.stringify({...old.manifest,responsibility:'Pending responsibility'}));
 await writeFile(join(f.directory,dirname(old.source.path),'prompts/member.md'),'Pending prompt');
 await f.team.initialize();
 const active=(await f.team.service.find(member.memberId))!,source=active.value.configuration!;
 assert.equal(active.id,member.memberId);assert.deepEqual(active.value.designScope,member.designScope);assert.equal('harness' in active.value,false);assert.equal('execute' in JSON.parse(source.files['member.json']!),false);
 assert.equal(source.formatVersion,5);assert.equal('previous' in source,false);assert.equal(source.files['prompts/member.md'],old.source.files['prompts/member.md']);
 assert.equal(active.value.responsibility,member.responsibility);assert.deepEqual(f.store.agentContexts.get(member.memberId),retained);
 const pending=JSON.parse(await readFile(join(f.directory,source.path),'utf8'));assert.equal(pending.responsibility,'Pending responsibility');assert.equal('execute' in pending,false);
 assert.equal(await readFile(join(f.directory,dirname(source.path),'prompts/member.md'),'utf8'),'Pending prompt');
 assert.equal(await gitText(f.directory,['rev-parse','HEAD']),head);assert.match(await gitText(f.directory,['show',`HEAD:${source.path}`]),/allowedCommands/);
 const review=await f.team.configuration.validate(f.lead.memberId,'.rsi/members');assert.equal(review.valid,true);assert.equal(review.changes.length,1);
 const before=await f.team.service.all(f.workspaceId);await f.team.initialize();assert.deepEqual(await f.team.service.all(f.workspaceId),before);
 // The historical converter only accepts recorded old blobs, not newly authored obsolete config.
 await writeFile(join(f.directory,source.path),JSON.stringify({...pending,responsibility:'New change',execute:{allowedCommands:[]}}));
 assert.equal((await f.team.configuration.validate(f.lead.memberId,'.rsi/members')).valid,false);
 await gitText(f.directory,['add','-f','-A','--','.rsi/members']);await gitText(f.directory,['commit','-m','Invalid new legacy field']);
 assert.equal((await f.team.configuration.validate(f.lead.memberId,'.rsi/members')).valid,false);
}));

test('pre-upgrade committed new member remains reviewable and requires explicit activation',()=>withTeam(async f=>{
 const member=await worker(f,'Backend',['src']),old=await legacy(f,member);
 const planned=await worker(f,'Planned',['lib']);
 // Simulate an old committed bundle that has not been activated into the team.
 const plannedOld=await legacy(f,planned);f.store.members.delete(planned.memberId);
 await initGit(f);await gitText(f.directory,['add','-f','-A','--','.rsi/members']);await gitText(f.directory,['commit','-m','Old pending new member']);
 await f.team.initialize();
 assert.equal(await f.team.service.byName(f.workspaceId,'Planned'),undefined);
 const review=await f.team.configuration.validate(f.lead.memberId,'.rsi/members');assert.equal(review.valid,true,JSON.stringify(review.issues));
 assert.deepEqual(review.changes.map(change=>[change.type,change.name]),[['create','Planned']]);
 await f.team.activateConfiguration(f.workspaceId);
 const activated=(await f.team.service.byName(f.workspaceId,'Planned'))!;assert.deepEqual(activated.value.designScope,planned.designScope);assert.equal('execute' in JSON.parse(activated.value.configuration!.files['member.json']!),false);
 assert.equal('execute' in JSON.parse(await readFile(join(f.directory,plannedOld.source.path),'utf8')),false);
 assert.match(await gitText(f.directory,['show',`HEAD:${plannedOld.source.path}`]),/allowedCommands/);
 assert.ok(await f.team.service.byName(f.workspaceId,member.name));assert.ok(old.source.path);
}));

test('migration preserves malformed or intentionally deleted pending manifests and keeps retired members retired',()=>withTeam(async f=>{
 const a=await worker(f,'Malformed'),b=await worker(f,'Deleted'),c=await worker(f,'Retired');
 const oldA=await legacy(f,a),oldB=await legacy(f,b);await legacy(f,c,true);
 await writeFile(join(f.directory,oldA.source.path),'{invalid pending JSON');await rm(join(f.directory,oldB.source.path));
 await f.team.initialize();
 assert.equal(await readFile(join(f.directory,oldA.source.path),'utf8'),'{invalid pending JSON');await assert.rejects(readFile(join(f.directory,oldB.source.path)),code('ENOENT'));
 const retired=(await f.team.service.find(c.memberId))!;assert.equal(retired.value.retiredAt,123);assert.equal('harness' in retired.value,false);assert.equal(await f.team.service.byName(f.workspaceId,c.name),undefined);
 assert.equal((await f.team.configuration.validate(f.lead.memberId,'.rsi/members')).valid,false);
}));

test('migration refuses linked member manifests rather than rewriting their targets',()=>withTeam(async f=>{
 const member=await worker(f,'Backend'),old=await legacy(f,member),target=join(f.folder,'outside.json');
 await writeFile(target,old.raw);await rm(join(f.directory,old.source.path));await symlink(target,join(f.directory,old.source.path));
 await assert.rejects(f.team.initialize(),code('config_conflict'));assert.equal(await readFile(target,'utf8'),old.raw);
}));
