import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ConfigurationIssue } from '../client/workspace-client.js';
import { ChangesClient, type ChangeOperation } from '../client/changes-client.js';
import { FileDiff } from './FileDiff.js';
import { Glyph } from './Glyph.js';
import { pollIntervalMs } from './team-state.js';
import type { TeamState } from './useTeam.js';

/** Pending file review and independent committed-member activation. */
export function ChangesTab({ workspaceId, team, visible, onApproved }: { workspaceId: string; team: TeamState; visible: boolean; onApproved(): void }) {
  const client = useMemo(() => new ChangesClient(workspaceId), [workspaceId]);
  const { view, loading, error, operation, operationError, notice, activation, activationLoading, activationError } = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const lead = team.team?.members.find(member => member.lead);
  const [selected, setSelected] = useState<string | null>(null);
  const running = team.team?.members.some(member => member.running) ?? false;
  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    if (!visible) return;
    void client.refresh();
    const focus = () => { void client.refresh(); }; window.addEventListener('focus', focus);
    const timer = running ? window.setInterval(focus, pollIntervalMs) : null;
    return () => { window.removeEventListener('focus', focus); if (timer !== null) window.clearInterval(timer); };
  }, [visible, running, client]);
  async function perform(kind: ChangeOperation) {
    if (await client.perform(kind)) onApproved();
  }
  const disabled = !!operation || loading || !!error;
  const files = view ? [...view.design.changes, ...view.members.changes] : [];
  return <section className="changes-tab" aria-label="Design and member changes">
    <header className="changes-head"><div><span className="eyebrow">CHANGES</span><h2>Review & approve</h2><p>Approve design and member files separately.</p></div><button type="button" className="text-button" disabled={!!operation || loading} onClick={() => void client.refresh()}><Glyph name="refresh" />Refresh</button></header>
    {(error || team.error) && <p className="changes-error" role="alert">{error ?? team.error}</p>}
    {!lead && !team.loading && <p className="changes-error" role="alert">Workspace lead is unavailable.</p>}
    {!view ? <p className="changes-note">{loading || team.loading ? 'Reading changes…' : 'Open this tab to review changes.'}</p> : <>
      <div className="change-approvals" aria-label="Approval actions">
        <div><span><strong>Design</strong><small>{view.design.changes.length} pending {view.design.changes.length === 1 ? 'file' : 'files'}</small></span><button type="button" className="secondary-button" disabled={disabled || !!lead?.running || !view.design.changes.length} onClick={() => void perform('design')}>{operation === 'design' ? 'Approving…' : 'Approve design'}</button></div>
        <div><span><strong>Members</strong><small>{view.members.changes.length} pending {view.members.changes.length === 1 ? 'file' : 'files'}</small></span><button type="button" className="secondary-button" disabled={disabled || !!lead?.running || !view.members.changes.length} onClick={() => void perform('members')}>{operation === 'members' ? 'Approving…' : 'Approve members'}</button></div>
      </div>
      <div className="member-activation"><span><strong>{view.activation.hasChanges ? 'Approved members await activation' : 'Members are up to date'}</strong><small>{activationLoading ? 'Checking approved member configuration…' : running ? 'Wait for all members to finish.' : view.members.changes.length ? 'Activation uses approved files; pending edits stay pending.' : 'Activation applies approved member configuration.'}</small></span><button type="button" className="primary-button" disabled={disabled || running || activationLoading || !activation?.valid || !view.activation.hasChanges} onClick={() => void perform('activate')}>{operation === 'activate' ? 'Activating…' : 'Activate members'}</button></div>
      {view.activation.hasChanges && activation && !activation.valid && <div className="changes-blockers" role="status"><strong>Member activation is blocked</strong><Issues issues={activation.issues} /></div>}
      {activationError && <p className="changes-error" role="alert">{activationError}<button type="button" onClick={() => void client.refresh()}>Retry activation review</button></p>}
      {operationError && <p className="changes-error" role="alert">{operationError}</p>}
      {notice && <p className="changes-success" role="status">{notice}</p>}
      <FileDiff files={files} selected={selected} onSelect={setSelected} />
    </>}
  </section>;
}
function Issues({ issues }: { issues: ConfigurationIssue[] }) {
  return <ul>{issues.map((issue, index) => <li key={`${issue.path}:${index}`}><code>{issue.path}</code>: {issue.message}</li>)}</ul>;
}
