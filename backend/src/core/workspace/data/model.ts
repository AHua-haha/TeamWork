import type {NewMember} from '../../team/data/members.js';
import type {WorkspaceBootstrap} from '../../workspace-bootstrap.js';
import type {WorkspaceModels,StoredWorkspaceModels} from './models.js';

export interface WorkspaceRecord {workspaceId:string;name:string;directory:string;createdAt:number}
export interface WorkspaceStore {
  listWorkspaces():Promise<WorkspaceRecord[]>;
  getWorkspace(workspaceId:string):Promise<WorkspaceRecord|null>;
  createWorkspace(workspace:WorkspaceRecord,directoryKey:string,lead:NewMember,models?:WorkspaceModels,bootstrap?:WorkspaceBootstrap):Promise<void>;
  getWorkspaceModels(workspaceId:string):Promise<StoredWorkspaceModels|null>;
  saveWorkspaceModels(workspaceId:string,revision:number|null,value:WorkspaceModels,initializeLead:boolean):Promise<StoredWorkspaceModels>;
}
