import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceClient, BackendError, type TeamRoster } from '../src/shared/backend-client/index.js';
import { ChatRoster } from '../src/features/workspace/chat-roster.js';
import { MemberActivation } from '../src/features/workspace/member-activation.js';
import { MemberActivationView } from '../src/features/workspace/MemberActivationPanel.js';
const roster: TeamRoster = {workspaceId: 'w1', members: [{memberId:'lead',workspaceId:'w1',revision:0,name:'Lead',role:'Lead',responsibility:'Help',lead:true,running:false}]};


test('chat roster uses its narrow endpoint and coalesces concurrent refreshes', async () => {
  const calls: string[] = [];
  let finish!: (value: Response) => void;
  const api = new WorkspaceClient((async input => { calls.push(String(input)); return new Promise(resolve => {finish=resolve;}); }) as typeof fetch);
  const model = new ChatRoster('w1', api);
  const first = model.refresh(); assert.equal(model.refresh(), first);
  assert.deepEqual(calls, ['/workspaces/w1/members']);
  finish(new Response(JSON.stringify(roster))); await first;
  assert.deepEqual(model.getSnapshot(), {team:roster,loading:false,error:null});
  model.dispose(); await model.refresh(); assert.equal(calls.length, 1);
});
test('disposed roster ignores a late result; failures remain retryable', async () => {
  let resolve!: (value:TeamRoster) => void;
  const model = new ChatRoster('w1',{roster:() => new Promise(done => {resolve=done;})});
  const pending=model.refresh();model.dispose();resolve(roster);await pending;
  assert.equal(model.getSnapshot().team,null);
  let count=0;
  const retry=new ChatRoster('w1',{roster:async()=>{if(!count++)throw Error('offline');return roster;}});
  await retry.refresh();assert.equal(retry.getSnapshot().error,'offline');
  await retry.refresh();assert.deepEqual(retry.getSnapshot().team,roster);retry.dispose();
});
test('activation is manual, coalesces clicks and sends no Git revision or review request',async()=>{
 const calls:unknown[]=[];let finish!:(value:any)=>void;
 const api=new WorkspaceClient((async (input,options)=>{calls.push([String(input),options?.body]);return new Promise(resolve=>{finish=resolve;});}) as typeof fetch);
 const model=new MemberActivation('w1',api);assert.deepEqual(calls,[]);
 const pending=model.activate();assert.equal(await model.activate(),false);
 assert.deepEqual(calls,[['/workspaces/w1/team/configuration/activate','{}']]);
 finish(new Response(JSON.stringify({revision:'application-id',memberIds:['lead']})));assert.equal(await pending,true);
 assert.match(model.getSnapshot().notice!,/activated/);model.dispose();assert.equal(await model.activate(),false);
});
test('activation failures are shown and can be retried without configuration inspection',async()=>{
 let calls=0;
 const model=new MemberActivation('w1',{activateMemberConfiguration:async()=>{if(!calls++)throw new BackendError('Workspace is busy',409,'workspace_busy');return {revision:'id',memberIds:[]};}});
 assert.equal(await model.activate(),false);assert.equal(model.getSnapshot().error,'Workspace is busy');
 assert.equal(await model.activate(),true);assert.equal(model.getSnapshot().error,null);model.dispose();
});
test('activation view exposes one action and disables it while busy or members are working',()=>{
 for(const running of [false,true]){
  const markup=renderToStaticMarkup(createElement(MemberActivationView,{state:{busy:false,error:null,notice:null},running,onActivate:async()=>{}}));
  assert.match(markup,/Activate members/);assert.equal(markup.includes('disabled=""'),running);
  assert.doesNotMatch(markup,/Check committed|reviewed revision|FileDiff|DesignTab|TeamTab/);
 }
});
