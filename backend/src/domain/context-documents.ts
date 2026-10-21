import { AppError } from '../foundation/types.js';
import { contextPaths } from './workspace-layout.js';
export interface ContextDocument { path: string; content: string }
/** Structural format validation only; prose completeness remains a harness instruction. */
export function contextDocuments(reference:string,kind:'design'|'impl',files:ReadonlyMap<string,string>):ContextDocument[]{
 const [single,directory]=contextPaths(reference,kind),get=(path:string)=>files.get(path.toLowerCase());
 const many=[...files.keys()].filter(path=>path.startsWith(directory!.toLowerCase()+'/')).sort();
 if(get(single!)!==undefined&&many.length)throw new AppError('invalid_design',`Choose ${kind}.md or ${kind}/, never both`);
 let paths:string[];
 if(many.length){
  const entry=`${directory}/README.md`.toLowerCase();
  if(!many.includes(entry)||many.some(path=>!path.endsWith('.md')))throw new AppError('invalid_design',`${kind}/ requires README.md and Markdown documents only`);
  paths=[entry,...many.filter(path=>path!==entry)];
 }else paths=get(single!)===undefined?[]:[single!.toLowerCase()];
 if(!paths.length||paths.length>100)throw new AppError('invalid_design',`${kind} context requires 1–100 Markdown documents`);
 const documents=paths.map(path=>({path,content:get(path)!}));
 if(documents.some(d=>!d.content.trim())||documents.reduce((n,d)=>n+Buffer.byteLength(d.content),0)>1024*1024)throw new AppError('invalid_design',`${kind} context documents must be nonempty and at most 1 MiB in total`);
 return documents;
}
