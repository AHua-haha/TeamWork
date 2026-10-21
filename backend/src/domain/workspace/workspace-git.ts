import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AppError } from '../../foundation/types.js';
import { decodeText, sha256 } from '../../foundation/text.js';

export interface GitBaseline { time?: number; design: Record<string,string>; members: Record<string,string> }
export interface FileChange { path: string; action: 'add'|'modify'|'delete'; patch: string; truncated: boolean }
export const coversPath = (scope: string, path: string) => scope === '.' || path === scope || path.startsWith(scope + '/');
export class OperationQueue {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    this.tails.set(key,result);
    void result.finally(() => { if(this.tails.get(key) === result)this.tails.delete(key); }).catch(() => {});
    return result;
  }
}
export function git(root: string, args: string[], env: NodeJS.ProcessEnv = {}, input?: string | Buffer): Promise<{output: string; code: number; stdout: Buffer}> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return new Promise((resolveResult,reject) => {
    const child = execFile('git',['--no-replace-objects','-C',root,...args], {env:{...clean,GIT_TERMINAL_PROMPT:'0',...env},maxBuffer:128*1024*1024,timeout:60_000,encoding:'buffer'},(error,stdout,stderr) => {
      if(error && typeof error.code !== 'number') reject(error);
      else resolveResult({output:Buffer.concat([stdout,stderr]).toString(),stdout,code:error ? Number(error.code) : 0});
    });
    child.stdin?.on('error',()=>{});child.stdin?.end(input);
  });
}
export async function gitText(root:string,args:string[],env:NodeJS.ProcessEnv={},input?:string|Buffer) {
  const result=await git(root,args,env,input);
  if(result.code)throw new AppError('git_error',result.output.trim()||'Git failed',409);
  return result.output.trimEnd();
}
export async function repository(root:string, initialize=false) {
  try {const info=await lstat(join(root,'.git'));if(!info.isDirectory()||info.isSymbolicLink())throw new AppError('git_repository','Git requires a repository directory at the workspace root',409);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(!initialize)return false;await gitText(root,['init','-q']);}
  if(resolve(await gitText(root,['rev-parse','--show-toplevel']))!==resolve(root))throw new AppError('git_repository','Git repository must belong to this workspace',409);
  return true;
}
export const filesRevision=(files:Record<string,string>)=>sha256(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))));
export async function currentFiles(root:string,prefix:string):Promise<Record<string,string>> {
  const files:Record<string,string>={};let bytes=0;
  async function visit(path:string){
    let info;try{info=await lstat(join(root,path));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
    if(info.isSymbolicLink())throw new AppError('invalid_path',`Control files cannot contain symbolic links: ${path}`);
    if(info.isDirectory()){for(const name of (await readdir(join(root,path))).sort())await visit(`${path}/${name}`);return;}
    if(!info.isFile()||info.size>1024*1024||bytes+info.size>16*1024*1024)throw new AppError('invalid_config',`Control file is not regular UTF-8 text within size limits: ${path}`);
    const text=decodeText(await readFile(join(root,path)));if(text===null)throw new AppError('invalid_config',`Control file must be UTF-8 text: ${path}`);
    bytes+=info.size;if(Object.keys(files).length>=2000)throw new AppError('invalid_config','Control file count exceeds limit');files[path]=text;
  }
  await visit(prefix);return files;
}
export async function committedFiles(root:string,prefix:string,baseline:Record<string,string>={}):Promise<{files:Record<string,string>;revision:string;committed:boolean}> {
  if(!await repository(root))return {files:baseline,revision:filesRevision(baseline),committed:false};
  const log=await git(root,['log','-1','--format=%H','--',prefix]);
  const revision=log.code===0?log.output.trim():'';
  if(!revision)return {files:baseline,revision:filesRevision(baseline),committed:false};
  const fields=(await gitText(root,['ls-tree','-r','-l','-z','HEAD','--',prefix])).split('\0').filter(Boolean);
  const seen=new Set((await gitText(root,['log','--format=','--name-only','-z','HEAD','--',prefix])).split('\0').map(p=>p.replace(/^\n+/,'')));
  const files:Record<string,string>=Object.fromEntries(Object.entries(baseline).filter(([path])=>!seen.has(path)));let total=0;
  for(const entry of fields){const tab=entry.indexOf('\t'),[mode,,hash]=entry.slice(0,tab).split(/\s+/),path=entry.slice(tab+1);if(!['100644','100755'].includes(mode!))throw new AppError('invalid_config',`Committed control file is not regular: ${path}`);const size=Number(entry.slice(0,tab).trim().split(/\s+/).at(-1));total+=size;if(size>1024*1024||total>16*1024*1024||fields.length>2000)throw new AppError('invalid_config','Committed control content exceeds text limits');
    const raw=await git(root,['cat-file','blob',hash!]),text=decodeText(raw.stdout);if(raw.code||text===null)throw new AppError('invalid_config',`Committed control file must be UTF-8 text: ${path}`);files[path]=text;
  }
  return {files,revision,committed:true};
}
/** Display diff only: temporary ordinary files, no Git indexes, refs, objects or history. */
export async function fileChanges(before:Record<string,string>,after:Record<string,string>):Promise<FileChange[]> {
  const paths=[...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(path=>before[path]!==after[path]);
  if(!paths.length)return [];
  const temp=await mkdtemp(join(tmpdir(),'rsi-review-'));
  try{
    for(const [side,files] of [['before',before],['after',after]] as const){await mkdir(join(temp,side));for(const path of paths)if(files[path]!==undefined){const file=join(temp,side,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,files[path]!);}}
    const result=await git(temp,['diff','--no-index','--no-color','--no-ext-diff','--no-textconv','--no-renames','--','before','after']);
    if(result.code>1)throw new AppError('git_error',result.output,503);
    const patches=result.output.split(/(?=^diff --git )/m).filter(Boolean);
    return paths.map((path,i)=>({path,action:before[path]===undefined?'add':after[path]===undefined?'delete':'modify',patch:(patches[i]??'').slice(0,256*1024),truncated:(patches[i]?.length??0)>256*1024}));
  }finally{await rm(temp,{recursive:true,force:true});}
}
/** Read-only, one-time import. Never stage, commit, restore or write legacy history. */
export async function legacyBaseline(root:string):Promise<GitBaseline|null>{
  const directory=join(root,'.rsi/harness/repository.git');
  try{await lstat(join(directory,'HEAD'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  const command=(args:string[])=>gitText(root,['--git-dir',directory,...args]);
  const design:Record<string,string>={},members:Record<string,string>={};
  for(const line of (await command(['for-each-ref','--format=%(refname) %(objectname)','refs/harness/designs/'])).split('\n').filter(Boolean)){
    const [ref,revision]=line.split(' ');
    const paths=(await command(['ls-tree','-r','--name-only',revision!,'--','.rsi/context/design'])).split('\n').filter(Boolean);
    for(const path of paths)if(ref===`refs/harness/designs/${sha256(path.toLowerCase())}`)design[path]=(await git(root,['--git-dir',directory,'show',`${revision}:${path}`])).output;
  }
  const key=sha256(JSON.stringify({paths:['.rsi/members'],exclude:[]}));
  const ref=`refs/harness/scopes/${key}/committed`;
  const found=await command(['for-each-ref','--format=%(objectname)',ref]);
  if(found)for(const path of (await command(['ls-tree','-r','--name-only',found,'--','.rsi/members'])).split('\n').filter(Boolean))members[path]=(await git(root,['--git-dir',directory,'show',`${found}:${path}`])).output;
  const latest=await command(['log','--all','-1','--format=%ct']);
  return {design,members,time:latest?Number(latest)*1000+999:0};
}
/** Read-only native history for configuration inspection, never a second history. */
export async function configurationCommits(root:string,active:string|null){
  if(!await repository(root))return {commits:[],more:false,historyKnown:active===null};
  const known=active!==null&&(await git(root,['cat-file','-e',`${active}^{commit}`])).code===0;
  const result=await git(root,['log','--max-count=101','--format=%H%x00%ct%x00%an%x00%B%x00',...(known?[`^${active}`]:[]),'HEAD','--','.rsi/members']);
  if(result.code)return {commits:[],more:false,historyKnown:known};
  const fields=result.output.split('\0'),commits:{revision:string;time:number;author:string;message:string}[]=[];
  for(let i=0;i+3<fields.length;i+=4){if(!fields[i]!.trim())continue;commits.push({revision:fields[i]!.trim(),time:Number(fields[i+1])*1000,author:fields[i+2]!,message:fields[i+3]!.trimEnd()});}
  return {commits:commits.slice(0,100),more:commits.length>100,historyKnown:known};
}
