import {newLead} from './team/data/members.js';
import {workspacePrompt} from './workspace/workspace-prompts.js';
import {dirname,join} from 'node:path';
import type {WorkspaceRecord,MemberBaseline} from './workspace/data/model.js';
import {filesRevision} from './workspace/workspace-git.js';
import type {MemberActivationState} from './team/data/members.js';
import {PreparedWorkspaceFiles} from './workspace/workspace-initialization.js';
import {workspaceContext} from './workspace/project-context.js';

export interface WorkspaceBootstrap {baseline:MemberBaseline;activation:MemberActivationState}
/** Prepare files only; registration, lead and member acceptance commit atomically in SQL. */
export async function prepareWorkspace(workspace:WorkspaceRecord,settings:import('./team/data/config.js').RunSettings,cleanupRevision?:string){
  const files=await PreparedWorkspaceFiles.begin(workspace.directory,cleanupRevision);
  try{
    const layout=await workspaceContext(workspace.directory);
    const lead=newLead(workspace.workspaceId,settings,[layout.rootDesign]);
    await files.mkdir(`${layout.root}/_ctx`);
    await files.create(`${layout.root}/${layout.rootDesign}`,workspacePrompt('project-design-template',{project:workspace.name})+'\n');
    const baseline:MemberBaseline={members:{}};
    for(const [path,content]of Object.entries(lead.value.configuration!.files)){
      const target=join(dirname(lead.value.configuration!.path),path);
      await files.create(target,content);baseline.members[target]=content;
    }
    const revision=filesRevision(baseline.members);
    lead.value.configuration!.acceptedRevision=revision;
    lead.value.configuration!.submittedBy='harness';
    return {lead,files,bootstrap:{baseline,activation:{revision,time:workspace.createdAt}} satisfies WorkspaceBootstrap};
  }catch(error){await files.rollback();throw error;}
}
