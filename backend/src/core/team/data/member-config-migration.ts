import {lstat, readFile, writeFile, readdir, unlink, rmdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {AppError} from '../../agent/data/model.js';
import {decodeText} from '../../text.js';
import {emptyDesignScope, parseDesignScope, type DesignScope} from './assignment.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Read only at the historical storage boundary; current member inputs never accept Harness fields. */
export function restoredDesignScope(data: Record<string, unknown>): DesignScope {
  const harness = object(data.harness) ? data.harness : undefined;
  const scope=data.designScope??harness?.designScope??emptyDesignScope();
  return parseDesignScope(object(scope)?{working:scope.working}:scope);
}
/** Preserve every meaningful pending field; remove only retired configuration keys. */
export function upgradeMemberManifest(text: string): string {
  let data: unknown;
  try {data = JSON.parse(text);} catch {return text;}
  if (!object(data) || !['execute', 'harness', 'harnesses'].some(key => Object.hasOwn(data, key))) return text;
  const {execute: _execute, harness, harnesses, ...current} = data;
  const old = object(harnesses) ? harnesses : {}, project = object(old.project) ? old.project : {};
  const scope = data.designScope ?? (object(harness) ? harness.designScope : undefined) ?? project.designScope ?? old.design;
  if (scope !== undefined) current.designScope = scope;
  return JSON.stringify(current, null, 2) + '\n';
}
export function legacyPromptFiles(value:unknown):string[] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>20||value.some(path=>typeof path!=='string'||!/^prompts\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.md$/.test(path)||path.split('/').some(part=>part==='..'||part.startsWith('.'))))throw new AppError('invalid_config','Cannot migrate invalid member prompt references');
  return value as string[];
}
export function legacyCatalogIds(value:unknown):string[] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!id))throw new AppError('invalid_config','Cannot migrate invalid member catalog references');
  return value as string[];
}
/** Convert only the format; the caller owns preserving active or draft instruction bytes. */
export function currentMemberManifest(text:string):string {
  const upgraded=upgradeMemberManifest(text),data=JSON.parse(upgraded) as Record<string,unknown>;
  if(!object(data))throw new AppError('invalid_config','Member manifest must be an object');
  const settings=object(data.settings)?data.settings:{};
  const scope=object(data.designScope)?data.designScope:undefined;
  if(!Object.hasOwn(data,'promptFiles')&&!Object.hasOwn(settings,'prompt')&&!Object.hasOwn(settings,'promptOptionIds')&&!Object.hasOwn(scope??{},'dependencies'))return upgraded;
  const {promptFiles,...current}=data;
  const {prompt,promptOptionIds,...modelSettings}=settings;
  return JSON.stringify({...current,settings:modelSettings,...(scope?{designScope:{working:scope.working}}:{})},null,2)+'\n';
}
export type CatalogInstructions=(ids:readonly string[])=>Promise<string>;
const noCatalog:CatalogInstructions=async ids=>{if(ids.length)throw new AppError('invalid_config','Catalog instructions are required to migrate this member');return '';};

/** Read migration inputs without following links through the member directory. */
async function migrationText(root:string,path:string):Promise<string|undefined> {
  const parts=path.split('/');
  for(let i=1;i<=parts.length;i++){
    let info;try{info=await lstat(join(root,...parts.slice(0,i)));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    if(info.isSymbolicLink()||(i<parts.length?!info.isDirectory():!info.isFile()))throw new AppError('config_conflict','Member migration refuses non-regular files or symbolic links',409);
  }
  const text=decodeText(await readFile(join(root,path)));return text===null?undefined:text;
}
/** Startup-only format conversion; never replace a draft with the active snapshot. */
export async function upgradeMemberManifestFile(root:string,path:string,catalog:CatalogInstructions=noCatalog):Promise<void>{
  if(!/^\.rsi\/members\/[^/]+\/member\.json$/.test(path))throw new AppError('config_conflict','Invalid member manifest path',409);
  const previous=await migrationText(root,path);if(previous===undefined)return;
  let data:unknown;try{data=JSON.parse(previous);}catch{return;}
  if(!object(data))return;
  const settings=object(data.settings)?data.settings:{};
  const legacy=Object.hasOwn(data,'promptFiles')||Object.hasOwn(settings,'prompt')||Object.hasOwn(settings,'promptOptionIds');
  if(!legacy){const next=currentMemberManifest(previous);if(next!==previous)await writeFile(join(root,path),next,'utf8');return;}
  const refs=legacyPromptFiles(data.promptFiles),prefix=dirname(path),agentPath=prefix+'/agent.md';
  const existing=await migrationText(root,agentPath),old=new Map<string,string>();
  for(const ref of refs){const text=await migrationText(root,prefix+'/'+ref);if(text===undefined&&existing===undefined)return;if(text!==undefined)old.set(ref,text);}
  if(existing===undefined){
    const selected=await catalog(legacyCatalogIds(settings.promptOptionIds));
    const own=refs.length?refs.map(ref=>old.get(ref)!).join('\n\n'):typeof settings.prompt==='string'?settings.prompt:'';
    const text=[selected,own].filter(Boolean).join('\n\n');
    await writeFile(join(root,agentPath),text,{encoding:'utf8',flag:'wx'});
  }
  if(await migrationText(root,path)!==previous)throw new AppError('config_conflict','Member files changed during format migration',409);
  await writeFile(join(root,path),currentMemberManifest(previous),'utf8');
  for(const [ref,text]of old)if(await migrationText(root,prefix+'/'+ref)===text)await unlink(join(root,prefix,ref));
  const directories=[...new Set(refs.flatMap(ref=>{const parts=ref.split('/');return parts.slice(0,-1).map((_,i)=>prefix+'/'+parts.slice(0,i+1).join('/'));}))].sort((a,b)=>b.length-a.length);
  for(const directory of directories)try{await rmdir(join(root,directory));}catch(error){if(!['ENOENT','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
}
/** Existing pending bundles migrate independently of the active database snapshot. */
export async function upgradeMemberDirectory(root:string,catalog:CatalogInstructions=noCatalog):Promise<void>{
  for(const part of ['.rsi','.rsi/members']){
    let info;try{info=await lstat(join(root,part));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    if(!info.isDirectory()||info.isSymbolicLink())throw new AppError('config_conflict','Member migration refuses directory symlinks',409);
  }
  for(const entry of await readdir(join(root,'.rsi/members'),{withFileTypes:true}))if(entry.isDirectory())await upgradeMemberManifestFile(root,`.rsi/members/${entry.name}/member.json`,catalog);
}
