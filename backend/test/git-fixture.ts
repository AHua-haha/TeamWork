import { gitText, git } from './native-git.js';
import type { TeamSystem } from '../src/core/team/team-system.js';
type Fixture={team:TeamSystem;workspaceId:string;lead:{memberId:string};directory?:string};
const root=async(f:Fixture)=>f.directory??await f.team.memberWorkspace.root(f.lead.memberId);
export async function initGit(f:Fixture){await gitText(await root(f),['init','-q']);await gitText(await root(f),['config','user.name','Test']);await gitText(await root(f),['config','user.email','test@example.invalid']);}
export async function acceptFiles(f:Fixture,prefix='.rsi/members',message='Accept member files'){
  await initGit(f);await gitText(await root(f),['add','-f','-A','--',prefix]);
  if((await git(await root(f),['diff','--cached','--quiet'])).code!==0)await gitText(await root(f),['commit','-m',message]);
  return f.team.configuration.validate(f.lead.memberId,'.rsi/members');
}
