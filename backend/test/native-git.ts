/** Ordinary Git operations used only by tests; production has no Git adapter. */
import {execFile} from 'node:child_process';
import {AppError} from '../src/core/errors.js';
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
