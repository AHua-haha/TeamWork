import { ApprovalRequests } from './data/approvals.js';
import { copyFile, mkdtemp, open, rename, rm, stat, utimes } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { executionResources } from './harness-execution.js';
import { gitText, repository, coversPath, type FileChange } from '../workspace/workspace-git.js';
import { AppError } from '../agent/data/model.js';

/** Preserve Git's racy-stat detection when copying an index; a fresh mtime can hide same-size edits. */
async function copyIndex(source:string,target:string){
  const info=await stat(source);await copyFile(source,target);
  // An earlier timestamp is conservative: Git rechecks possibly racy entries.
  await utimes(target,info.atime,Math.floor(info.mtimeMs/1000));
}

export class GitCommitControl {
  constructor(private readonly approvals:ApprovalRequests){}
  async execute(input:{root:string;workspaceId:string;memberId:string;runId?:string;command:string;args:string[];cwd:string;env:NodeJS.ProcessEnv;implementation:string[];signal:AbortSignal;execute:(args:string[],env:NodeJS.ProcessEnv)=>Promise<{output:string;code:number}>;onWait:(waiting:boolean)=>void}) {
    const {root,signal,onWait}=input;
    await repository(root);
    let args=[...input.args],cwd=input.cwd;
    while(args[0]==='-C'){if(!args[1])throw new AppError('command_denied','git -C needs a path');cwd=resolve(cwd,args[1]);args=args.slice(2);}
    if(resolve(await gitText(cwd,['rev-parse','--show-toplevel']))!==resolve(root))throw new AppError('command_denied','Commit repository must be the registered workspace');
    if(args[0]!=='commit')throw new AppError('command_denied','Only explicit Git commit is mediated');
    const commitArgs:string[]=[];let all=false,message='';
    for(let i=1;i<args.length;i++){
      const arg=args[i]!;
      if(arg==='-a'||arg==='--all'){all=true;continue;}
      if(arg==='-m'||arg==='--message'){if(!args[i+1])throw new AppError('command_denied','Use git commit -m <message>');const text=args[++i]!;commitArgs.push('-m',text);message+=(message?'\n\n':'')+text;continue;}
      if(arg.startsWith('--message=')||/^\-m.+/.test(arg)){const text=arg.startsWith('--message=')?arg.slice(10):arg.slice(2);commitArgs.push('-m',text);message+=(message?'\n\n':'')+text;continue;}
      if(['--allow-empty','--no-verify','--signoff','-s','--quiet','-q'].includes(arg)){commitArgs.push(arg);continue;}
      throw new AppError('command_denied','For reviewed commits, stage the intended paths then use git commit [-a] -m <message>. Path-only, interactive, amend, signing and repository/environment overrides are not supported yet. Other Git commands remain native.');
    }
    if(!message.trim())throw new AppError('command_denied','Noninteractive Git commit requires -m <message>');
    // Only ordinary commit preparation, not a persistent index/scope or a history checkpoint.
    const temp=await mkdtemp(join((await executionResources(root)).area,'commit-'));
    const index=join(temp,'index'),native=join(root,'.git/index'),lock=join(root,'.git/index.lock');
    const env={...input.env,GIT_INDEX_FILE:index};
    const run=(args:string[])=>input.execute(args,env);
    const text=async(args:string[])=>{const result=await run(args);if(result.code)throw new AppError('git_error',result.output,409);return result.output.trimEnd();};
    let locked=false;
    async function prepare(){
      await rm(index,{force:true});
      try{await copyIndex(native,index);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await text(['read-tree','--empty']);}
      if(all)await text(['add','-u']);
      const tree=await text(['write-tree']),head=await run(['rev-parse','--verify','HEAD']);
      return {tree,head:head.code===0?head.output.trim():null};
    }
    try{
      const candidate=await prepare();
      const fields=(await text(['diff','--cached','--no-renames','--name-status','-z'])).split('\0').filter(Boolean);
      const paths=fields.filter((_,i)=>i%2===1);
      let protectedFiles=false,implementation=false;
      for(const path of paths){
        if(coversPath('.rsi/context/design',path)||coversPath('.rsi/members',path))protectedFiles=true;
        else if(coversPath('.rsi/context/implement',path)||(!coversPath('.rsi',path)&&input.implementation.some(p=>coversPath(p,path))))implementation=true;
        else throw new AppError('command_denied',`Commit contains an unrecognized implementation path: ${path}. Use accepted design mappings and split unrelated changes.`);
      }
      if(protectedFiles&&implementation)throw new AppError('command_denied','Split design/member changes and implementation changes into separate commits. Nothing was committed; staged files were preserved.');
      const patches=(await text(['diff','--cached','--no-renames','--no-color','--no-ext-diff','--no-textconv'])).split(/(?=^diff --git )/m).filter(Boolean);
      const changes=paths.map((path,i):FileChange=>({path,action:fields[i*2]==='A'?'add':fields[i*2]==='D'?'delete':'modify',patch:(patches[i]??'').slice(0,256*1024),truncated:(patches[i]?.length??0)>256*1024}));
      if(protectedFiles){
        const decision=await this.approvals.wait({id:randomUUID(),workspaceId:input.workspaceId,memberId:input.memberId,runId:input.runId??null,command:input.command,directory:root,message,createdAt:Date.now(),changes},signal,onWait);
        signal.throwIfAborted();
        if(decision.action!=='accept')return {output:decision.action==='deny'?`User denied the Git commit.${decision.message?' '+decision.message:''}`:`User feedback: ${decision.message}\nNo commit was executed. Revise the work or request another commit.`,code:1};
      }
      signal.throwIfAborted();
      // Native Git clients cannot change staging while this short execution phase owns its lock.
      const handle=await open(lock,'wx').catch(()=>{throw new AppError('git_busy','Git index is locked; retry after the other operation completes',409);});locked=true;await handle.close();
      const current=await prepare();
      if(current.tree!==candidate.tree||current.head!==candidate.head)throw new AppError('stale_approval','Commit contents or HEAD changed after review. No commit was executed; review a new request.',409);
      signal.throwIfAborted();
      const result=await run(['-c','core.hooksPath=/dev/null','commit',...commitArgs]);
      if(result.code===0){await copyIndex(index,lock);await rename(lock,native);locked=false;}
      return result;
    }finally{if(locked)await rm(lock,{force:true});await rm(temp,{recursive:true,force:true});}
  }
}
