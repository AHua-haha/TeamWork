import {AppError} from '../errors.js';
import {sha256} from '../text.js';
import type {WorkspaceService} from './workspace.js';
import {nodeReference} from './workspace-layout.js';
import {migratedReference,projectNode,workspaceContext} from './project-context.js';
import type {ContextIndexSnapshot} from './context-base/index.js';

export interface DesignDocument {path:string;content:string}
export interface DesignPart {implementation:string[];content:string;documents:DesignDocument[]}
export interface ResolvedDesign extends DesignPart {path:string;revision:string}
export function designPath(value:unknown):string{
  if(typeof value!=='string')throw new AppError('invalid_input','A design reference names its context DESIGN.md');
  return nodeReference(value);
}

/** The metadata manager discovers designs; current content is read directly from files on demand. */
export class DesignService{
  constructor(private readonly workspaces:WorkspaceService){}
  async refresh(workspaceId:string):Promise<ContextIndexSnapshot>{return(await this.workspaces.contextManager(workspaceId)).refresh();}
  private async project(workspaceId:string){
    const root=(await this.workspaces.record(workspaceId)).directory,layout=await workspaceContext(root);
    const manager=await this.workspaces.contextManager(workspaceId);
    return{root,layout,manager,snapshot:manager.snapshot()??await manager.refresh()};
  }
  private async reference(input:unknown,project:Awaited<ReturnType<DesignService['project']>>){
    return migratedReference(project.root,project.layout,designPath(input));
  }
  private async readProject(input:unknown,project:Awaited<ReturnType<DesignService['project']>>):Promise<ResolvedDesign>{
    const reference=await this.reference(input,project),system=project.manager.design(projectNode(reference),project.snapshot);
    const document=await project.manager.loadDesign(system.projectPath,project.snapshot);
    if(!document.content.trim())throw new AppError('invalid_design',`${document.path} is empty`);
    return{path:system.designReference,revision:sha256(document.content),implementation:[system.projectPath],documents:[{path:system.designReference,content:document.content}],content:document.content};
  }
  async checkAssignment(workspaceId:string,working:readonly string[]):Promise<void>{
    const project=await this.project(workspaceId);
    for(const input of working)project.manager.design(projectNode(await this.reference(input,project)),project.snapshot);
  }
  async list(workspaceId:string):Promise<{designs:Omit<ResolvedDesign,'content'|'documents'>[];truncated:boolean}>{
    const project=await this.project(workspaceId);
    return{designs:Object.values(project.snapshot.designSystems).map(system=>({path:system.designReference,revision:project.snapshot.revision,implementation:[system.projectPath]})).sort((a,b)=>a.path.localeCompare(b.path)),truncated:false};
  }
  async inspect(workspaceId:string,input:unknown){
    const project=await this.project(workspaceId),resolved=await this.readProject(input,project);
    return{...resolved,size:Buffer.byteLength(resolved.content),updatedAt:project.snapshot.refreshedAt,design:resolved,designIssue:null};
  }
  async read(workspaceId:string,input:unknown):Promise<ResolvedDesign>{return this.readProject(input,await this.project(workspaceId));}
  async workingPaths(workspaceId:string,references:readonly string[]):Promise<string[]>{
    const project=await this.project(workspaceId);
    return Promise.all(references.map(async input=>{
      const path=projectNode(await this.reference(input,project));project.manager.design(path,project.snapshot);return path;
    }));
  }
  async working(workspaceId:string,references:readonly string[]):Promise<ResolvedDesign[]>{
    if(!references.length)return[];
    const project=await this.project(workspaceId);
    const paths=await Promise.all(references.map(async input=>{
      const path=projectNode(await this.reference(input,project));project.manager.design(path,project.snapshot);return path;
    }));
    const selected=Object.values(project.snapshot.designSystems).filter(system=>paths.some(path=>path==='.'||system.projectPath===path||system.projectPath.startsWith(path+'/')));
    return Promise.all(selected.sort((a,b)=>a.designReference.localeCompare(b.designReference)).map(system=>this.readProject(system.designReference,project)));
  }
}
