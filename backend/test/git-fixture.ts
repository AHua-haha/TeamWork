import { gitText, git } from '../src/core/workspace-git.js';
import type { TeamSystem } from '../src/core/team-system.js';
type Fixture={team:TeamSystem;workspaceId:string;lead:{memberId:string};directory?:string};
const root=async(f:Fixture)=>f.directory??(await f.team.harness.environment(f.lead.memberId)).root;
export async function initGit(f:Fixture){await gitText(await root(f),['init','-q']);await gitText(await root(f),['config','user.name','Test']);await gitText(await root(f),['config','user.email','test@example.invalid']);}
export async function waitApproval(f:Fixture){for(let i=0;i<500;i++){const request=f.team.harness.approvals.list(f.workspaceId)[0];if(request)return request;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('No pending Git commit approval');}
export async function acceptFiles(f:Fixture,prefix='.rsi/members',message='Accept member files'){
  await initGit(f);await gitText(await root(f),['add','-f','-A','--',prefix]);
  if((await git(await root(f),['diff','--cached','--quiet'])).code===0)return f.team.reviewConfiguration(f.workspaceId);
  const request=f.team.harness.bash(f.lead.memberId,{command:`git commit --allow-empty -m ${JSON.stringify(message)}`},new AbortController().signal);
  const pending=await waitApproval(f);f.team.harness.approvals.decide(f.workspaceId,pending.id,'accept','');
  const result=await request;if(result.exitCode!==0)throw new Error(result.output);
  return f.team.reviewConfiguration(f.workspaceId);
}
