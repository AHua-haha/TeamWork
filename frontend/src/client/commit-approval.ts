import type { FileChange } from './workspace-client.js';
export interface CommitApproval { id:string;workspaceId:string;memberId:string;runId:string|null;command:string;directory:string;message:string;createdAt:number }
export interface CommitReview extends CommitApproval { changes:FileChange[] }
async function request<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,init);const body=await response.json();if(!response.ok)throw new Error(body.error?.message??body.message??'Commit approval request failed');return body;}
const base=(workspace:string)=>`/workspaces/${encodeURIComponent(workspace)}/team/commit-approvals`;
export const pendingCommits=(workspace:string)=>request<{approvals:CommitApproval[]}>(base(workspace));
export const reviewCommit=(workspace:string,id:string)=>request<CommitReview>(`${base(workspace)}/${encodeURIComponent(id)}`);
export const decideCommit=(workspace:string,id:string,action:'accept'|'deny'|'feedback',message:string)=>request(`${base(workspace)}/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,message})});
