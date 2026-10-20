import { useEffect, useState } from 'react';
import { decideCommit, pendingCommits, reviewCommit, type CommitApproval, type CommitReview } from '../client/commit-approval.js';
import { FileDiff } from './FileDiff.js';

/** User decisions live above the composer; file content lives only in the right panel. */
export function CommitApprovalInput({workspaceId,running,onReview,onResolved}:{workspaceId:string;running:boolean;onReview(id:string):void;onResolved():void}){
  const [requests,setRequests]=useState<CommitApproval[]>([]),[message,setMessage]=useState(''),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[generation,setGeneration]=useState(0);
  useEffect(()=>{let disposed=false,timer:ReturnType<typeof setTimeout>;const read=async()=>{try{const result=await pendingCommits(workspaceId);if(!disposed){setRequests(result.approvals);setError(null);}}catch(e){if(!disposed)setError(e instanceof Error?e.message:'Approval unavailable');}finally{if(!disposed)timer=setTimeout(read,running?1200:5000);}};void read();return()=>{disposed=true;clearTimeout(timer);};},[workspaceId,running,generation]);
  const request=requests[0];
  useEffect(()=>{setMessage('');setBusy(false);},[request?.id]);
  async function decide(action:'accept'|'deny'|'feedback'){
    if(!request||busy)return;setBusy(true);setError(null);
    try{await decideCommit(workspaceId,request.id,action,message);setRequests(current=>current.filter(item=>item.id!==request.id));setGeneration(n=>n+1);onResolved();}catch(e){setError(e instanceof Error?e.message:'Approval failed');setGeneration(n=>n+1);}finally{setBusy(false);}
  }
  if(!request)return error&&running?<div className="group-command-error" role="alert">{error}</div>:null;
  return <CommitApprovalPrompt busy={busy} error={error} message={message} onMessage={setMessage} onReview={()=>onReview(request.id)} onDecide={action=>void decide(action)} />;
}
export function CommitApprovalPrompt({busy,error,message,onMessage,onReview,onDecide}:{busy:boolean;error:string|null;message:string;onMessage(message:string):void;onReview():void;onDecide(action:'accept'|'deny'|'feedback'):void}){
  return <section className="commit-approval-input" role="region" aria-label="Git commit approval required">
    <div className="commit-approval-heading"><strong>Git commit approval required</strong><button type="button" className="text-button" onClick={onReview}>Review</button></div>
    <textarea aria-label="Commit approval feedback" placeholder="Optional feedback for the agent…" value={message} disabled={busy} onChange={event=>onMessage(event.target.value)} />
    {error&&<p role="alert" className="group-command-error">{error}</p>}
    <div className="commit-approval-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>onDecide('deny')}>Deny</button><button type="button" className="secondary-button" disabled={busy||!message.trim()} onClick={()=>onDecide('feedback')}>Send feedback</button><button type="button" className="primary-button" disabled={busy} onClick={()=>onDecide('accept')}>{busy?'Submitting…':'Accept'}</button></div>
  </section>;
}
export function CommitReviewTab({workspaceId,id}:{workspaceId:string;id:string}){
  const [review,setReview]=useState<CommitReview|null>(null),[error,setError]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null);
  useEffect(()=>{let active=true;setReview(null);setError(null);void reviewCommit(workspaceId,id).then(value=>{if(active)setReview(value);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Review unavailable');});return()=>{active=false;};},[workspaceId,id]);
  return <section className="changes-tab" aria-label="Git commit review"><header className="changes-head"><div><span className="eyebrow">GIT COMMIT</span><h2>Review proposed commit</h2><p>Accept, deny or send feedback above the chat input.</p></div></header>{error?<p role="alert" className="group-command-error">{error}</p>:review?<><pre className="commit-review-command">{review.command}</pre><p className="commit-review-directory">{review.directory}</p><FileDiff files={review.changes} selected={selected} onSelect={setSelected}/></>:<p>Loading review…</p>}</section>;
}
