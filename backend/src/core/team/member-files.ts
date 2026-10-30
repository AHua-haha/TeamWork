import {lstat,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {decodeText} from '../text.js';
import {AppError} from '../errors.js';

/** Capture current member files once for validation/activation; never reads project Git. */
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
