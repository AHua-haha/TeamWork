import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {TeamSystem} from '../src/core/team/team-system.js';
import type {ConfigService} from '../src/core/team/data/config.js';
import {sourceBundle} from '../src/core/team/data/member-config.js';
import {withTeam,worker,stubConfig,code} from './team-fixture.js';

test('one conventional agent.md is activated independently of later file edits; selectors and inline instructions are rejected',()=>withTeam(async f=>{
 const member=await worker(f,'Backend',['src']);
 const source=await f.team.configuration.activeSource(f.workspaceId,member.memberId),path=join(f.directory,source.path),manifest=JSON.parse(source.files['member.json']!);
 assert.deepEqual(Object.keys(source.files).sort(),['agent.md','member.json']);
 assert.equal('promptFiles' in manifest,false);assert.equal('promptOptionIds' in manifest.settings,false);
 const agent=join(dirname(path),'agent.md');await writeFile(agent,'Instructions selected by convention');
 assert.notEqual((await f.team.service.find(member.memberId))!.value.settings.prompt,'Instructions selected by convention');
 await f.team.activateConfiguration(f.workspaceId);
 const active=(await f.team.service.find(member.memberId))!;assert.equal(active.value.settings.prompt,'Instructions selected by convention');
 assert.deepEqual(active.value.settings.promptOptionIds,[]);
 for(const extra of [{promptFiles:[]},{settings:{...manifest.settings,prompt:'inline'}},{settings:{...manifest.settings,promptOptionIds:[]}}]){
  await writeFile(path,JSON.stringify({...manifest,...extra}));
  await assert.rejects(f.team.activateConfiguration(f.workspaceId),code('invalid_config'));
  assert.deepEqual(await f.team.service.find(member.memberId),active);
 }
 await writeFile(path,JSON.stringify(manifest));await rm(agent);
 await assert.rejects(f.team.activateConfiguration(f.workspaceId),code('invalid_config'));
 assert.deepEqual(await f.team.service.find(member.memberId),active);
}));

test('legacy multi-file and catalog prompts migrate to one file while active and draft text stay separate across restart',()=>withTeam(async f=>{
 const member=await worker(f,'Backend',['src']),stored=(await f.team.service.find(member.memberId))!,source=stored.value.configuration!;
 const manifest=JSON.parse(source.files['member.json']!);
 const legacy={...manifest,settings:{...manifest.settings,promptOptionIds:['shared']},promptFiles:['prompts/first.md','prompts/second.md']};
 const raw=JSON.stringify(legacy),files={'member.json':raw,'prompts/first.md':'Active first','prompts/second.md':'Active second'};
 await f.store.updateMember(stored.id,stored.revision,'backend',{...stored.value,settings:{...stored.value.settings,prompt:'Active first\n\nActive second',promptOptionIds:['shared']},configuration:{...sourceBundle(source.path,files,'user'),formatVersion:5}});
 const directory=join(f.directory,dirname(source.path));await rm(join(directory,'agent.md'));
 await mkdir(join(directory,'prompts'),{recursive:true});await writeFile(join(directory,'member.json'),raw);
 await writeFile(join(directory,'prompts/first.md'),'Draft first');await writeFile(join(directory,'prompts/second.md'),'Draft second');
 f.store.agentContexts.set(member.memberId,[{messageId:'private-context',message:{role:'user',content:'Preserve existing working history',timestamp:1},metadata:{}}]);
 let catalogReads=0;
 const config={...stubConfig,getCatalog:async(id:string)=>{catalogReads++;assert.equal(id,'shared');return {id,revision:1,value:{kind:'prompt' as const,label:'Shared',text:'Shared fixed instructions'}};}} as ConfigService;
 const team=new TeamSystem(f.store,f.workspaces,config);team.attach(f.runtime);
 try{
  await team.initialize();
  const active=(await team.service.find(member.memberId))!;
  assert.equal(active.value.settings.prompt,'Shared fixed instructions\n\nActive first\n\nActive second');
  assert.deepEqual(active.value.settings.promptOptionIds,[]);
  assert.deepEqual(Object.keys(active.value.configuration!.files).sort(),['agent.md','member.json']);
  assert.equal(await readFile(join(directory,'agent.md'),'utf8'),'Shared fixed instructions\n\nDraft first\n\nDraft second');
  const current=JSON.parse(await readFile(join(directory,'member.json'),'utf8'));
  assert.equal('promptFiles' in current,false);assert.equal('promptOptionIds' in current.settings,false);
  await assert.rejects(readFile(join(directory,'prompts/first.md')),code('ENOENT'));
  const reads=catalogReads;await team.initialize();assert.equal(catalogReads,reads,'catalog selections no longer participate');
  assert.deepEqual(await team.service.find(member.memberId),active);
  await team.activateConfiguration(f.workspaceId);
  assert.equal((await team.service.find(member.memberId))!.value.settings.prompt,'Shared fixed instructions\n\nDraft first\n\nDraft second');
  assert.equal(f.store.agentContexts.get(member.memberId)![0]!.messageId,'private-context');
 }finally{await team.closeMaintenance();await team.runner.close();}
}));
