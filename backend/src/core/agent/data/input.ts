import {randomUUID} from 'node:crypto';
import type {JsonObject} from '@earendil-works/pi-ai';
import type {AgentContextState} from './state.js';
import {validateEntries} from './validation.js';
import {AppError,type ContextEntry,type ContextPatch,type ComponentMessageEffects} from './model.js';

export function countedMessage(entry:ContextEntry):number {return entry.metadata.contextMessageCounted===false?0:1;}
export function userInput(entry:ContextEntry):boolean {
  if(entry.message.role!=='user'||entry.metadata.runtimeGenerated===true)return false;
  const source=entry.metadata.source;
  if(source==='group-chat')return (entry.metadata.author as JsonObject|undefined)?.type==='user';
  return !source || source==='user';
}
/** Context-only operations also work for idle delivery; original stable history is never changed. */
export class AgentInputData {
  constructor(readonly context:AgentContextState,private readonly persist?:(revision:number,patch:ContextPatch,effects?:ComponentMessageEffects)=>Promise<void>,private readonly durable=false){}
  entry(id:string):ContextEntry|undefined {const value=this.context.entry(id);return value?structuredClone(value):undefined;}
  async commit(patch:ContextPatch,effects?:ComponentMessageEffects):Promise<void>{
    if(this.durable&&!this.persist)throw new AppError('invalid_config','Input reactions require atomic context/state persistence');
    validateEntries([...patch.append,...patch.update]);
    for(const update of [...(patch.metadata??[]),...(effects?.metadataUpdates??[])])if(!this.context.entry(update.messageId))throw new AppError('invalid_context_update','Context entry no longer exists');
    const saved={...patch,metadata:[...(patch.metadata??[]),...(effects?.metadataUpdates??[])]};
    const revision=this.context.history.revision;
    try{
      await this.persist?.(revision,saved,effects?{...effects,metadataUpdates:[]}:undefined);
      if(this.context.history.revision===revision&&(saved.append.length||saved.update.length||saved.metadata.length))this.context.patch(revision+1,saved);
    }catch(error){this.context.invalidate();throw error;}
  }
  instruction(text:string,metadata:JsonObject={}):ContextEntry{return {messageId:randomUUID(),message:{role:'user',content:text,timestamp:Date.now()},metadata};}
}
