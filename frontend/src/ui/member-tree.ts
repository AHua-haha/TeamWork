import type { DesignSummary, Member } from '../client/workspace-client.js';
import { sameDesign } from './design-state.js';
export interface MemberTreeNode { path: string; name: string; folder: boolean; children: MemberTreeNode[]; members: Member[]; unavailable: boolean }
/** System-node folders provide hierarchy; document directories never create nodes. Root is rendered by MemberTree. */
export function memberTree(designs:readonly DesignSummary[],members:readonly Member[]):MemberTreeNode[]{
 const nodes=new Map<string,MemberTreeNode>(),roots:MemberTreeNode[]=[];
 const paths=new Set([...designs.map(d=>d.path),...members.flatMap(m=>m.harness.designScope.working)]);
 for(const path of paths){
  const reference=path.replace(/^\.rsi\/context\//,'');
  if(reference.toLowerCase()==='metadata.json')continue;
  const parts=reference.replace(/\/metadata\.json$/i,'').split('/');
  let parent=roots,prefix='';
  for(const [index,name]of parts.entries()){
   prefix=prefix?prefix+'/'+name:name;const nodePath=prefix+'/metadata.json',key=nodePath.toLowerCase();
   let node=nodes.get(key);
   if(!node){node={path:nodePath,name,folder:index<parts.length-1,children:[],members:[],unavailable:false};nodes.set(key,node);parent.push(node);}
   if(index<parts.length-1)node.folder=true;
   if(index===parts.length-1){node.members=members.filter(m=>m.harness.designScope.working.some(ref=>sameDesign(ref,path)));node.unavailable=!designs.some(d=>sameDesign(d.path,path));}
   parent=node.children;
  }
 }
 const sort=(items:MemberTreeNode[])=>{items.sort((a,b)=>Number(b.folder)-Number(a.folder)||a.name.localeCompare(b.name));for(const node of items)sort(node.children);};sort(roots);return roots;
}
