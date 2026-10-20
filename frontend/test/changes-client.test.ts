import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChangesClient } from '../src/client/changes-client.js';
import type { WorkspaceChanges, ConfigurationCommit, MemberConfigurationReview } from '../src/client/workspace-client.js';
const deferred=<T>()=>{let resolve!:(value:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const view=(hasChanges=false):WorkspaceChanges=>({workspaceId:'w',leadId:'lead',design:{memberId:'lead',partId:'design',revision:'d-review',base:'d-base',changes:[]},members:{memberId:'lead',partId:'member-config',revision:'m-review',base:'m-base',changes:[]},activation:{revision:'m-base',activeRevision:hasChanges?'m-old':'m-base',hasChanges}});
const validation:MemberConfigurationReview={revision:'m-base',digest:'digest',valid:true,issues:[]};
function setup(){
 const calls:unknown[][]=[];
 const api={changes:async(w:string)=>{calls.push(['read',w]);return view();},committedMemberReview:async(w:string)=>{calls.push(['validate',w]);return validation;},approveScope:async(...args:unknown[])=>{calls.push(['design',...args]);return {} as ConfigurationCommit;},commitMemberConfiguration:async(...args:unknown[])=>{calls.push(['members',...args]);return {} as ConfigurationCommit;},activateMemberConfiguration:async(...args:unknown[])=>{calls.push(['activate',...args]);return {revision:'m-base',memberIds:[]};}};
 return {calls,api,client:new ChangesClient('w',api)};
}
test('slow focus/poll refreshes share one read and display its result; refresh retains previous files',async()=>{
 const f=setup(),read=deferred<WorkspaceChanges>();f.api.changes=()=>{f.calls.push(['read']);return read.promise;};
 const first=f.client.refresh();assert.equal(first,f.client.refresh());assert.equal(first,f.client.refresh());assert.equal(f.calls.length,1);
 read.resolve(view());await first;assert.ok(f.client.getSnapshot().view);assert.equal(f.client.getSnapshot().loading,false);
 const next=deferred<WorkspaceChanges>();f.api.changes=()=>next.promise;
 const second=f.client.refresh();assert.ok(f.client.getSnapshot().view);assert.equal(f.client.getSnapshot().loading,true);
 next.reject(new Error('Unavailable'));await second;assert.ok(f.client.getSnapshot().view);assert.equal(f.client.getSnapshot().error,'Unavailable');f.client.dispose();
});
test('committed validation is independent of file loading, cached for unchanged refs, and blocks invalid activation',async()=>{
 const f=setup(),pending=deferred<MemberConfigurationReview>();f.api.changes=async()=>view(true);f.api.committedMemberReview=()=>{f.calls.push(['validate']);return pending.promise;};
 await f.client.refresh();assert.equal(f.client.getSnapshot().loading,false);assert.ok(f.client.getSnapshot().view);assert.equal(f.client.getSnapshot().activationLoading,true);
 await f.client.refresh();assert.equal(f.calls.filter(c=>c[0]==='validate').length,1);
 assert.equal(await f.client.perform('activate'),false);
 pending.resolve({...validation,valid:false,issues:[{path:'member.json',code:'invalid_config',message:'Missing design'}]});await pending.promise;await new Promise(r=>setImmediate(r));
 assert.equal(f.client.getSnapshot().activation?.valid,false);assert.equal(await f.client.perform('activate'),false);f.client.dispose();
});
test('operations use exact scope/base or committed digest, serialize refresh and revalidate after stale refusal',async()=>{
 const f=setup();await f.client.refresh();await f.client.perform('design');
 assert.deepEqual(f.calls.find(c=>c[0]==='design'),['design','w','lead','design',{revision:'d-review',base:'d-base',message:'Approve design changes'}]);
 await f.client.perform('members');assert.deepEqual(f.calls.find(c=>c[0]==='members'),['members','w',{revision:'m-review',base:'m-base',message:'Approve member changes'}]);
 f.api.changes=async()=>view(true);await f.client.refresh();await new Promise(r=>setImmediate(r));
 f.api.activateMemberConfiguration=async(...args:unknown[])=>{f.calls.push(['activate',...args]);throw new Error('stale_revision');};
 assert.equal(await f.client.perform('activate'),false);assert.match(f.client.getSnapshot().operationError!,/stale_revision/);
 assert.deepEqual(f.calls.find(c=>c[0]==='activate'),['activate','w',{revision:'m-base',digest:'digest'}]);
 assert.ok(f.calls.filter(c=>c[0]==='validate').length>=2);f.client.dispose();
});
test('disposed views ignore late reads and validation results',async()=>{
 const f=setup(),read=deferred<WorkspaceChanges>();f.api.changes=()=>read.promise;
 const done=f.client.refresh();f.client.dispose();read.resolve(view());await done;assert.equal(f.client.getSnapshot().view,null);
});
