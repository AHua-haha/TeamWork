import type {ReactHarness} from '../react-harness/contracts.js';
import type {AgentInputData} from './data/input.js';
export async function reactToUserInputs(agentId:string,data:AgentInputData,harnesses:readonly ReactHarness[],signal:AbortSignal):Promise<void>{
  if(!harnesses.some(harness=>harness.onInput))return;
  for(const input of data.context.pendingInputs()){
    signal.throwIfAborted();
    for(const harness of harnesses){harness.restoreContext?.(data.context);await harness.onInput?.({agentId,input:structuredClone(input),data,signal});}
    const current=data.entry(input.messageId);if(!current)continue;
    await data.commit({append:[],update:[],metadata:[{messageId:current.messageId,metadata:{...current.metadata,reactInputHandled:true}}]});
  }
}
