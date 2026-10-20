import { contextLocation, contextRoot } from './workspace-layout.js';
export interface HarnessResource { id: string; paths: string[]; exclude: string[]; commit: 'agent'|'user'; prompt: string; context?: 'design'|'impl' }
export interface HarnessDefinition { id: string; resources: HarnessResource[]; prompt: string; tools: string[] }
export const coversPath=(scope:string,path:string)=>scope==='.'||path.toLowerCase()===scope.toLowerCase()||path.toLowerCase().startsWith(scope.toLowerCase()+'/');
export const resourceOwns=(resource:HarnessResource,path:string)=> (!resource.context||(path.startsWith(contextRoot+'/')&&(resource.context==='design'?['metadata','design'].includes(contextLocation(path.slice(contextRoot.length+1))?.kind??''):contextLocation(path.slice(contextRoot.length+1))?.kind==='impl'))) && resource.paths.some(p=>coversPath(p,path))&&!resource.exclude.some(p=>coversPath(p,path))&&!path.split('/').some(p=>p.toLowerCase()==='.git');
