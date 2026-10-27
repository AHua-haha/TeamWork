import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceClient, BackendError, type TeamRoster, type MemberConfigurationReview } from '../src/shared/backend-client/index.js';
import { ChatRoster } from '../src/features/workspace/chat-roster.js';
import { MemberActivation } from '../src/features/workspace/member-activation.js';
import { MemberActivationView } from '../src/features/workspace/MemberActivationPanel.js';
const roster: TeamRoster = {workspaceId: 'w1', members: [{memberId:'lead',workspaceId:'w1',revision:0,name:'Lead',role:'Lead',responsibility:'Help',lead:true,running:false}]};
const review: MemberConfigurationReview = {revision:'commit',digest:'digest',valid:true,issues:[],changes:[{type:'create',path:'.rsi/members/b/member.json',name:'Builder'}]};

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
test('temporary activation is manual and sends exactly the reviewed revision and digest', async () => {
  const calls:unknown[]=[];
  const model = new MemberActivation('w1',{
    committedMemberReview:async id=>{calls.push(['check',id]);return review;},
    activateMemberConfiguration:async(id,value)=>{calls.push(['activate',id,value]);return {} as any;},
  });
  assert.deepEqual(calls,[]);assert.equal(await model.activate(),false);
  const pending=model.check();await model.check();await pending;
  assert.deepEqual(calls,[['check','w1']]);assert.equal(await model.activate(),true);
  assert.deepEqual(calls,[['check','w1'],['activate','w1',{revision:'commit',digest:'digest'}]]);
  assert.equal(model.getSnapshot().review,null);assert.match(model.getSnapshot().notice!,/activated/);
  model.dispose();await model.check();assert.equal(calls.length,2);
});
test('invalid or unchanged activation is refused and conflicts require another explicit check', async () => {
  for(const response of [{...review,valid:false},{...review,changes:[]}]) {
    const model=new MemberActivation('w1',{committedMemberReview:async()=>response,activateMemberConfiguration:async()=>{throw Error('must not run');}});
    await model.check();assert.equal(await model.activate(),false);model.dispose();
  }
  const model=new MemberActivation('w1',{committedMemberReview:async()=>review,activateMemberConfiguration:async()=>{throw new BackendError('Workspace is busy',409,'workspace_busy');}});
  await model.check();assert.equal(await model.activate(),false);
  assert.equal(model.getSnapshot().review,null);assert.equal(model.getSnapshot().error,'Workspace is busy');model.dispose();
});
test('activation view exposes only explicit activation actions', () => {
  const markup=renderToStaticMarkup(createElement(MemberActivationView,{state:{review:null,busy:null,error:null,notice:null},running:false,onCheck:()=>{},onActivate:async()=>{}}));
  assert.match(markup,/Check committed members/);assert.match(markup,/disabled=""[^>]*>Activate members/);
  assert.doesNotMatch(markup,/FileDiff|Reading changes|DesignTab|TeamTab/);
});
