import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {backendClient} from '../../shared/backend-client/index.js';
import {MemberActivation,type ActivationState} from './member-activation.js';
export function MemberActivationPanel({workspaceId,running,onActivated}:{workspaceId:string;running:boolean;onActivated():Promise<void>}) {
  const model=useMemo(() => new MemberActivation(workspaceId,backendClient.workspace),[workspaceId]);
  const state=useSyncExternalStore(model.subscribe,model.getSnapshot);
  useEffect(() => model.dispose,[model]);
  return <MemberActivationView state={state} running={running} onActivate={async () => {if(await model.activate())await onActivated();}} />;
}
export function MemberActivationView({state,running,onActivate}:{state:ActivationState;running:boolean;onActivate():Promise<void>}) {
  const {busy,error,notice}=state;
  return <section className="changes-tab" aria-label="Member activation">
    <header className="changes-head"><div><span className="eyebrow">MEMBERS</span><h2>Activate member configuration</h2><p>Validate the current member files and save them as the active workspace configuration.</p></div></header>
    <div className="member-activation-actions"><button type="button" className="primary-button" disabled={busy || running} onClick={() => void onActivate()}>{busy ? 'Activating…' : 'Activate members'}</button></div>
    {running && <p className="changes-note">Wait for all members to finish before activation.</p>}
    {error && <p className="changes-error" role="alert">{error}</p>}
    {notice && <p className="changes-success" role="status">{notice}</p>}
  </section>;
}
