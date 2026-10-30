import type {NewMember} from '../../team/data/members.js';
import type {WorkspaceBootstrap} from '../../workspace-bootstrap.js';
import type {WorkspaceModels,StoredWorkspaceModels} from './models.js';

export interface WorkspaceRecord {workspaceId:string;name:string;directory:string;createdAt:number}
/** Initial member acceptance only. Project context is never stored in this snapshot. */
export interface MemberBaseline {members:Record<string,string>}
export interface WorkspaceStore {
  initialMemberFiles?(workspaceId:string):Promise<Record<string,string>>;
  getMemberBaseline(workspaceId:string):Promise<MemberBaseline|null>;
  initializeMemberBaseline(workspaceId:string,baseline:MemberBaseline):Promise<MemberBaseline>;
  listWorkspaces():Promise<WorkspaceRecord[]>;
  getWorkspace(workspaceId:string):Promise<WorkspaceRecord|null>;
  createWorkspace(workspace:WorkspaceRecord,directoryKey:string,lead:NewMember,models?:WorkspaceModels,bootstrap?:WorkspaceBootstrap):Promise<void>;
  getWorkspaceModels(workspaceId:string):Promise<StoredWorkspaceModels|null>;
  saveWorkspaceModels(workspaceId:string,revision:number|null,value:WorkspaceModels,initializeLead:boolean):Promise<StoredWorkspaceModels>;
}
