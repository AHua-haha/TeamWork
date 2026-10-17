import type { ContextFile } from './context-base.js';
import { contextDocuments } from './context-documents.js';
import { projectPath } from './project-files.js';
import { AppError } from './types.js';
import { sha256 } from './text.js';
import type { WorkspaceService } from './workspace.js';
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { HarnessHistory, harnessStorage } from './harness-history.js';
import { contextPaths, contextRoot, nodeReference } from './workspace-layout.js';

export interface DesignMetadata { implementation: string[] }
export interface DesignDocument { path: string; content: string }
export interface DesignPart extends DesignMetadata { content: string; documents: DesignDocument[] }
export interface ResolvedDesign extends DesignPart { path: string; revision: string }
export function designPath(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('invalid_input', 'A system reference is its metadata.json path');
  return nodeReference(value);
}
export function implementationPath(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('invalid_path', 'An implementation reference is a project path');
  if (value === '.') return value;
  if (value.toLowerCase() === '.rsi' || value.toLowerCase().startsWith('.rsi/')) throw new AppError('invalid_path', '.rsi is reserved for backend-managed state');
  return projectPath(value.replace(/\/+$/, '')).join('/');
}
export function designMetadata(value: unknown): DesignMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid_design', 'Metadata is an object containing implementation paths only');
  const data=value as Record<string,unknown>;
  if (Object.keys(data).some(key=>key!=='implementation') || !Array.isArray(data.implementation) || data.implementation.length>50) throw new AppError('invalid_design','metadata.json contains only implementation: at most 50 project paths');
  const implementation=data.implementation.map(implementationPath);
  if(new Set(implementation.map(p=>p.toLowerCase())).size!==implementation.length)throw new AppError('invalid_design','Duplicate implementation paths');
  return {implementation};
}
/** Resolve one complete design from metadata plus exactly one Markdown representation. */
export function resolveDesign(path: string, files: ReadonlyMap<string,string>): DesignPart {
  const get=(name:string)=>files.get(name.toLowerCase());
  const metadata=get(path);
  if(metadata===undefined)throw new AppError('invalid_design',`${path} is missing`);
  let value:unknown;
  try{value=JSON.parse(metadata);}catch{throw new AppError('invalid_design',`${path} is not valid JSON metadata`);}
  const mapping=designMetadata(value),documents=contextDocuments(path,'design',files);
  return {...mapping,documents,content:documents.map(d=>d.content).join('\n\n')};
}

/** Metadata identifies systems; Markdown documents never create extra system nodes. */
export class DesignService {
  constructor(private readonly workspaces: WorkspaceService) {}
  private async history(workspaceId:string):Promise<HarnessHistory|null>{
    const source=(await this.workspaces.record(workspaceId)).directory,history=new HarnessHistory(harnessStorage(source),source);
    try{await lstat(join(history.repository,'HEAD'));return history;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }
  private async file(workspaceId:string,path:string,history:HarnessHistory|null):Promise<ContextFile>{
    const accepted=await history?.acceptedDesign(`${contextRoot}/${path}`);
    if(accepted){
      if(accepted.content===null)throw new AppError('not_found','This file was deleted in accepted design history',404);
      return {path,content:accepted.content,size:Buffer.byteLength(accepted.content),revision:accepted.state.revision,updatedAt:accepted.state.time,current:true,author:{type:'user'},reason:accepted.state.message};
    }
    return (await this.workspaces.context(workspaceId)).read({path});
  }
  async list(workspaceId:string):Promise<{designs:Omit<ResolvedDesign,'content'|'documents'>[];truncated:boolean}>{
    const base=await this.workspaces.context(workspaceId),listing=await base.tree('',16),history=await this.history(workspaceId);
    const paths=new Set([...listing.entries.filter(e=>e.type==='file').map(e=>e.path),...await history?.acceptedDesignPaths()??[]]);
    const designs:Omit<ResolvedDesign,'content'|'documents'>[]=[];
    for(const path of paths){
      if(path.split('/').at(-1)?.toLowerCase()!=='metadata.json')continue;
      try{const {content:_content,documents:_documents,...summary}=await this.read(workspaceId,path);designs.push(summary);}
      catch(error){if(!(error instanceof AppError)||error.status>=500)throw error;}
    }
    return {designs:designs.sort((a,b)=>a.path.localeCompare(b.path)),truncated:listing.truncated};
  }
  async inspect(workspaceId:string,input:unknown):Promise<ContextFile & {design:DesignPart|null;designIssue:string|null}>{
    const path=designPath(input),history=await this.history(workspaceId),metadata=await this.file(workspaceId,path,history);
    try{
      const base=await this.workspaces.context(workspaceId),[single,directory]=contextPaths(metadata.path,'design');
      const overview=await base.overview();
      const problem=overview.problems.find(p=>p.path.toLowerCase()===single!.toLowerCase()||p.path.toLowerCase().startsWith(directory!.toLowerCase()+'/'));
      if(problem)throw new AppError('invalid_design',`Design document problem: ${problem.path}: ${problem.message}`);
      let raw:string[]=[];
      try{const listing=await base.tree(directory!,16);if(listing.truncated)throw new AppError('invalid_design','Design document listing exceeds the context listing limit');raw=listing.entries.filter(e=>e.type==='file').map(e=>e.path);}catch(error){if(!(error instanceof AppError)||error.code!=='not_found')throw error;}
      const candidates=new Set([single!,...raw,...(await history?.acceptedDesignPaths()??[]).filter(p=>p.toLowerCase().startsWith(directory!.toLowerCase()+'/'))]);
      const versions=[metadata],files=new Map([[path.toLowerCase(),metadata.content]]);
      for(const candidate of candidates){try{const file=await this.file(workspaceId,candidate,history);versions.push(file);files.set(file.path.toLowerCase(),file.content);}catch(error){if(!(error instanceof AppError)||error.code!=='not_found')throw error;}}
      const design=resolveDesign(metadata.path,files);
      design.documents=design.documents.map(document=>({...document,path:versions.find(file=>file.path.toLowerCase()===document.path)?.path??document.path}));
      const revision=sha256(JSON.stringify(versions.map(f=>[f.path.toLowerCase(),f.revision]).sort((a,b)=>a[0]!.localeCompare(b[0]!))));
      return {...metadata,revision,updatedAt:Math.max(...versions.map(f=>f.updatedAt)),design,designIssue:null};
    }catch(error){if(!(error instanceof AppError)||error.status>=500)throw error;return {...metadata,design:null,designIssue:error.message};}
  }
  async read(workspaceId:string,input:unknown):Promise<ResolvedDesign>{
    const file=await this.inspect(workspaceId,input);
    if(!file.design)throw new AppError('invalid_design',file.designIssue??'Invalid system design');
    return {...file.design,path:file.path,revision:file.revision};
  }
}
