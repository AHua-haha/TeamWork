import type { ContextFile } from './data/context-base.js';
import { contextDocuments } from './data/documents.js';
import { projectPath } from './project-files.js';
import { AppError } from '../agent/data/model.js';
import { sha256 } from '../text.js';
import type { WorkspaceService } from './workspace.js';
import { committedFiles, gitText } from './workspace-git.js';
import { contextPaths, contextRoot, nodeReference, nodePrefix, metadataPath } from './workspace-layout.js';

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
  const metadata=get(metadataPath(path));
  if(metadata===undefined)throw new AppError('invalid_design',`${path} is missing`);
  let value:unknown;
  try{value=JSON.parse(metadata);}catch{throw new AppError('invalid_design',`${path} is not valid JSON metadata`);}
  const mapping=designMetadata(value),documents=contextDocuments(path,'design',files);
  return {...mapping,documents,content:documents.map(d=>d.content).join('\n\n')};
}

/** Metadata identifies systems; Markdown documents never create extra system nodes. */
export class DesignService {
  constructor(private readonly workspaces: WorkspaceService) {}
  private async accepted(workspaceId:string) {
    const root=(await this.workspaces.record(workspaceId)).directory;
    const baseline=await this.workspaces.gitBaseline(workspaceId);
    const result=await committedFiles(root,'.rsi/context/design',baseline.design);
    const committed=result.committed;
    const time=committed ? Number(await gitText(root,['show','-s','--format=%ct',result.revision]))*1000+999 : baseline.time??0;
    return {...result,time};
  }
  private async file(workspaceId:string,path:string,accepted:Awaited<ReturnType<DesignService['accepted']>>):Promise<ContextFile>{
    const base=await this.workspaces.context(workspaceId);
    let before:number|null=null, userRevision:string|null|undefined;
    try {
      do {const page=await base.history(path,before,100),user=page.versions.find(v=>v.author.type==='user');
        if(user){if(user.time>accepted.time)userRevision=user.revision;break;}
        before=page.next;
      }while(before!==null);
    }catch(error){if(!(error instanceof AppError)||error.code!=='not_found')throw error;}
    if(userRevision===null)throw new AppError('not_found',`${path} was deleted`,404);
    if(userRevision!==undefined)return base.read({revision:userRevision});
    const entry=Object.entries(accepted.files).find(([key])=>key.toLowerCase()===`${contextRoot}/${path}`.toLowerCase());
    if(!entry)throw new AppError('not_found',`${path} not found in committed design`,404);
    return {path:entry[0].slice(contextRoot.length+1),content:entry[1],size:Buffer.byteLength(entry[1]),revision:accepted.revision,updatedAt:accepted.time,current:true,author:{type:'user'},reason:'Committed project design'};
  }
  async list(workspaceId:string):Promise<{designs:Omit<ResolvedDesign,'content'|'documents'>[];truncated:boolean}>{
    const base=await this.workspaces.context(workspaceId),listing=await base.tree('',16),history=await this.accepted(workspaceId);
    const paths=new Set([...listing.entries.filter(e=>e.type==='file').map(e=>e.path),...Object.keys(history.files).map(p=>p.slice(contextRoot.length+1))]);
    const designs:Omit<ResolvedDesign,'content'|'documents'>[]=[];
    for(const path of paths){
      if(!path.toLowerCase().startsWith('design/')||path.split('/').at(-1)?.toLowerCase()!=='metadata.json')continue;
      try{const {content:_content,documents:_documents,...summary}=await this.read(workspaceId,path);designs.push(summary);}
      catch(error){if(!(error instanceof AppError)||error.status>=500)throw error;}
    }
    return {designs:designs.sort((a,b)=>a.path.localeCompare(b.path)),truncated:listing.truncated};
  }
  async inspect(workspaceId:string,input:unknown):Promise<ContextFile & {design:DesignPart|null;designIssue:string|null}>{
    return this.inspectAccepted(workspaceId,input,await this.accepted(workspaceId));
  }
  private async inspectAccepted(workspaceId:string,input:unknown,history:Awaited<ReturnType<DesignService['accepted']>>):Promise<ContextFile & {design:DesignPart|null;designIssue:string|null}>{
    const path=designPath(input),metadata=await this.file(workspaceId,metadataPath(path),history);
    try{
      const base=await this.workspaces.context(workspaceId),[single,directory]=contextPaths(metadata.path,'design');
      const overview=await base.overview();
      const problem=overview.problems.find(p=>p.path.toLowerCase()===single!.toLowerCase()||p.path.toLowerCase().startsWith(directory!.toLowerCase()+'/'));
      if(problem)throw new AppError('invalid_design',`Design document problem: ${problem.path}: ${problem.message}`);
      let raw:string[]=[];
      try{const listing=await base.tree(directory!,16);if(listing.truncated)throw new AppError('invalid_design','Design document listing exceeds the context listing limit');raw=listing.entries.filter(e=>e.type==='file').map(e=>e.path);}catch(error){if(!(error instanceof AppError)||error.code!=='not_found')throw error;}
      const candidates=new Set([single!,...raw,...Object.keys(history.files).map(p=>p.slice(contextRoot.length+1)).filter(p=>p.toLowerCase().startsWith(directory!.toLowerCase()+'/'))]);
      const versions=[metadata],files=new Map([[metadata.path.toLowerCase(),metadata.content]]);
      for(const candidate of candidates){try{const file=await this.file(workspaceId,candidate,history);versions.push(file);files.set(file.path.toLowerCase(),file.content);}catch(error){if(!(error instanceof AppError)||error.code!=='not_found')throw error;}}
      const design=resolveDesign(metadata.path,files);
      design.documents=design.documents.map(document=>({...document,path:versions.find(file=>file.path.toLowerCase()===document.path)?.path??document.path}));
      const revision=sha256(JSON.stringify(versions.map(f=>[f.path.toLowerCase(),f.revision]).sort((a,b)=>a[0]!.localeCompare(b[0]!))));
      return {...metadata,revision,updatedAt:Math.max(...versions.map(f=>f.updatedAt)),design,designIssue:null};
    }catch(error){if(!(error instanceof AppError)||error.status>=500)throw error;return {...metadata,design:null,designIssue:error.message};}
  }
  async read(workspaceId:string,input:unknown):Promise<ResolvedDesign>{
    return this.readAccepted(workspaceId,input,await this.accepted(workspaceId));
  }
  private async readAccepted(workspaceId:string,input:unknown,history:Awaited<ReturnType<DesignService['accepted']>>):Promise<ResolvedDesign>{
    const file=await this.inspectAccepted(workspaceId,input,history);
    if(!file.design)throw new AppError('invalid_design',file.designIssue??'Invalid system design');
    return {...file.design,path:nodeReference(file.path),revision:file.revision};
  }

  /** Working roots include all accepted descendant nodes, never Markdown topic directories. */
  async working(workspaceId:string,references:readonly string[]):Promise<ResolvedDesign[]>{
    if(!references.length)return [];
    const history=await this.accepted(workspaceId);
    const roots=await Promise.all(references.map(path=>this.readAccepted(workspaceId,path,history)));
    const selected=new Map(roots.map(design=>[design.path.toLowerCase(),design]));
    const prefixes=roots.map(design=>nodePrefix(design.path).toLowerCase());
    const listing=await (await this.workspaces.context(workspaceId)).tree('design',16);
    if(listing.truncated)throw new AppError('invalid_design','Working design subtree listing exceeds the context listing limit');
    const candidates=new Set([...listing.entries.filter(entry=>entry.type==='file').map(entry=>entry.path),...Object.keys(history.files).map(path=>path.slice(contextRoot.length+1))]);
    for(const path of [...candidates].sort()){
      if(!path.toLowerCase().startsWith('design/')||path.split('/').at(-1)?.toLowerCase()!=='metadata.json')continue;
      let reference:string;
      try{reference=nodeReference(path);}catch(error){if(!(error instanceof AppError)||error.code!=='invalid_path')throw error;continue;}
      const key=reference.toLowerCase();
      if(selected.has(key)||!prefixes.some(prefix=>key.startsWith(prefix)))continue;
      try{const design=await this.readAccepted(workspaceId,reference,history);selected.set(key,design);}
      catch(error){if(!(error instanceof AppError)||error.code!=='not_found')throw error;}
    }
    return [...selected.values()].sort((a,b)=>a.path.localeCompare(b.path));
  }
}
