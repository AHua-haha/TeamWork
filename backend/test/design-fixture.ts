import type { WorkspaceService } from '../src/domain/workspace/workspace.js';
import { contextPaths, metadataPath } from '../src/domain/workspace/workspace-layout.js';
/** Seed actual node files for tests through the ordinary context file API. */
export async function seedDesign(workspaces:WorkspaceService,workspaceId:string,path:string,value:{content:string;implementation:string[]}) {
  const base=await workspaces.context(workspaceId);
  for(const [target,content] of [[metadataPath(path),JSON.stringify({implementation:value.implementation})],[contextPaths(path,'design')[0]!,value.content]]){
    let revision:string|null=null;
    try{revision=(await base.read({path:target!})).revision;}catch(error){if((error as {code?:string}).code!=='not_found')throw error;}
    await base.save(target!,content!,revision,'Seed test system design');
  }
  return path;
}
