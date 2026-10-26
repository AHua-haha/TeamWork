import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommitApprovalPrompt } from '../src/features/chat/CommitApproval.js';
import { pendingCommits,reviewCommit,decideCommit } from '../src/shared/backend-client/commit-approval.js';
test('approval input has decisions, optional feedback and Review without diff content',()=>{
 const html=renderToStaticMarkup(createElement(CommitApprovalPrompt,{busy:false,error:null,message:'',onMessage(){},onReview(){},onDecide(){}}));
 assert.match(html,/Git commit approval required/);assert.match(html,/Commit approval feedback/);for(const label of ['Accept','Deny','Send feedback','Review'])assert.match(html,new RegExp(label));
 assert.doesNotMatch(html,/change-diff|Unified diff|Changed files|<pre/);
 const busy=renderToStaticMarkup(createElement(CommitApprovalPrompt,{busy:true,error:'Stale request',message:'Please revise',onMessage(){},onReview(){},onDecide(){}}));assert.match(busy,/Submitting/);assert.match(busy,/Stale request/);
});
test('approval clients separate summary polling, full review and exact user decision',async()=>{
 const previous=globalThis.fetch,calls:{url:string;body:unknown}[]=[];
 globalThis.fetch=async(input,init)=>{calls.push({url:String(input),body:init?.body?JSON.parse(String(init.body)):null});return Response.json({approvals:[]});};
 try{await pendingCommits('w 1');await reviewCommit('w 1','a 1');await decideCommit('w 1','a 1','feedback','Separate changes');assert.deepEqual(calls,[{url:'/workspaces/w%201/team/commit-approvals',body:null},{url:'/workspaces/w%201/team/commit-approvals/a%201',body:null},{url:'/workspaces/w%201/team/commit-approvals/a%201',body:{action:'feedback',message:'Separate changes'}}]);
 globalThis.fetch=async()=>Response.json({error:{message:'Approval expired'}},{status:404});await assert.rejects(reviewCommit('w','old'),/Approval expired/);
 }finally{globalThis.fetch=previous;}
});
