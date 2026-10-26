import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { backendClient } from '../../shared/backend-client/index.js';
import { MemberActivation, type ActivationState } from './member-activation.js';
/** Mounted only when requested; checking and activation remain manual. */
export function MemberActivationPanel({workspaceId, running, onActivated}: {workspaceId: string; running: boolean; onActivated(): Promise<void>}) {
  const model = useMemo(() => new MemberActivation(workspaceId, backendClient.workspace), [workspaceId]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => model.dispose, [model]);
  return <MemberActivationView state={state} running={running} onCheck={() => void model.check()} onActivate={async () => { if (await model.activate()) await onActivated(); }} />;
}
export function MemberActivationView({state, running, onCheck, onActivate}: {state: ActivationState; running: boolean; onCheck(): void; onActivate(): Promise<void>}) {
  const {review, busy, error, notice} = state;
  return <section className="changes-tab" aria-label="Member activation">
    <header className="changes-head"><div><span className="eyebrow">MEMBERS</span><h2>Activate committed members</h2><p>Detailed workspace inspection is temporarily disabled. Check committed configuration when you are ready to activate it.</p></div></header>
    <div className="member-activation-actions">
      <button type="button" className="secondary-button" disabled={!!busy} onClick={onCheck}>{busy === 'check' ? 'Checking…' : 'Check committed members'}</button>
      <button type="button" className="primary-button" disabled={!!busy || running || !review?.valid || review.changes?.length === 0} onClick={() => void onActivate()}>{busy === 'activate' ? 'Activating…' : 'Activate members'}</button>
    </div>
    {running && <p className="changes-note">Wait for all members to finish before activation.</p>}
    {review && <p className="changes-note">{review.valid ? review.changes?.length === 0 ? 'Members are up to date.' : `${review.changes?.length ?? 'Reviewed'} committed member changes are ready for activation.` : 'Committed member configuration cannot be activated.'}</p>}
    {review && !review.valid && <ul className="changes-error">{review.issues.map((issue,index) => <li key={index}><code>{issue.path}</code>: {issue.message}</li>)}</ul>}
    {error && <p className="changes-error" role="alert">{error} Check committed members again before retrying.</p>}
    {notice && <p className="changes-success" role="status">{notice}</p>}
  </section>;
}
