import type {WorkspaceClient} from '../../shared/backend-client/index.js';
export interface ActivationState {busy: boolean; error: string | null; notice: string | null}
/** A single explicit user action. No configuration inspection, Git reads or background polling. */
export class MemberActivation {
  private state: ActivationState = {busy:false,error:null,notice:null};
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(private readonly workspaceId:string, private readonly api:Pick<WorkspaceClient,'activateMemberConfiguration'>) {}
  getSnapshot = () => this.state;
  subscribe = (listener:() => void) => {this.listeners.add(listener);return () => {this.listeners.delete(listener);};};
  private publish(next:Partial<ActivationState>) {if(!this.disposed){this.state={...this.state,...next};for(const listener of this.listeners)listener();}}
  async activate():Promise<boolean> {
    if(this.disposed || this.state.busy)return false;
    this.publish({busy:true,error:null,notice:null});
    try {
      await this.api.activateMemberConfiguration(this.workspaceId);
      this.publish({notice:'Current member configuration activated.'});
      return true;
    }catch(error){this.publish({error:error instanceof Error ? error.message : 'Member activation failed'});return false;}
    finally{this.publish({busy:false});}
  }
  dispose = () => {this.disposed=true;this.listeners.clear();};
}
