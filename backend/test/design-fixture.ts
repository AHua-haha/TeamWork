import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {WorkspaceService} from '../src/core/workspace/workspace.js';
import {projectNode,workspaceContext} from '../src/core/workspace/project-context.js';
/** Real filesystem setup. Old assignment names are explicit aliases, never old context files. */
export async function seedDesign(workspaces:WorkspaceService,workspaceId:string,path:string,value:{content:string;implementation:string[]}){
  const root=(await workspaces.record(workspaceId)).directory,layout=await workspaceContext(root);
  const reference=path.replace(/(?:^|\/)metadata\.json$/,(match)=>match.startsWith('/')?'/_ctx/DESIGN.md':'_ctx/DESIGN.md');
  const node=projectNode(reference);
  if(node!=='.'){
    if(reference.endsWith('.ctx/DESIGN.md')){await mkdir(dirname(join(root,node)),{recursive:true});await writeFile(join(root,node),'');}
    else await mkdir(join(root,node),{recursive:true});
  }
  const target=join(root,layout.root,reference);await mkdir(dirname(target),{recursive:true});await writeFile(target,value.content);
  if(reference!==path){
    const file=join(root,layout.root,'_ctx/internal/context-migration.json');
    let map:{references:Record<string,string>}={references:{}};
    try{map=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    map.references[path]=reference;await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(map));
  }
  await(await workspaces.contextManager(workspaceId)).refresh();
  return reference;
}
