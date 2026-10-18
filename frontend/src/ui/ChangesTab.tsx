import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceClient, type ConfigurationIssue, type CurrentMemberConfiguration, type ScopeReview } from '../client/workspace-client.js';
import { FileDiff } from './FileDiff.js';
import { Glyph } from './Glyph.js';
import { pollIntervalMs } from './team-state.js';
import type { TeamState } from './useTeam.js';

interface Review { design: ScopeReview; members: ScopeReview; configuration: CurrentMemberConfiguration }
/** One pending review surface; scope approval and member activation stay independent. */
export function ChangesTab({ workspaceId, team, visible, onApproved }: { workspaceId: string; team: TeamState; visible: boolean; onApproved(): void }) {
  const client = useMemo(() => new WorkspaceClient(), []);
  const lead = team.team?.members.find(member => member.lead);
  const [view, setView] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false), [operation, setOperation] = useState<'design' | 'members' | 'activate' | null>(null);
  const [error, setError] = useState<string | null>(null), [operationError, setOperationError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const busy = useRef(false), alive = useRef(true), request = useRef(0);
  const running = team.team?.members.some(member => member.running) ?? false;
  const read = useCallback(async (): Promise<Review> => {
    if (!lead) throw new Error('Workspace lead is unavailable.');
    // Materialize active bundles before taking pending scope snapshots.
    const configuration = await client.currentMemberConfiguration(workspaceId);
    const [design, members] = await Promise.all([
      client.scopeReview(workspaceId, lead.memberId, 'design'),
      client.scopeReview(workspaceId, lead.memberId, 'member-config'),
    ]);
    return { design, members, configuration };
  }, [client, workspaceId, lead?.memberId]);
  const refresh = useCallback(async () => {
    if (busy.current || !lead) return;
    const ticket = ++request.current; setLoading(true);
    try { const next = await read(); if (alive.current && ticket === request.current) { setView(next); setError(null); } }
    catch (cause) { if (alive.current && ticket === request.current) setError(cause instanceof Error ? cause.message : 'Changes could not be read'); }
    finally { if (alive.current && ticket === request.current) setLoading(false); }
  }, [read, lead?.memberId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  useEffect(() => {
    if (!visible) return;
    void refresh();
    const focus = () => { void refresh(); }; window.addEventListener('focus', focus);
    const timer = running ? window.setInterval(focus, pollIntervalMs) : null;
    return () => { window.removeEventListener('focus', focus); if (timer !== null) window.clearInterval(timer); };
  }, [visible, running, refresh]);
  async function perform(kind: 'design' | 'members' | 'activate') {
    if (!view || !lead || busy.current) return;
    busy.current = true; request.current++; setLoading(false); setOperation(kind); setOperationError(null); setNotice(null);
    try {
      if (kind === 'design') await client.approveScope(workspaceId, lead.memberId, 'design', { revision: view.design.revision, base: view.design.base, message: 'Approve design changes' });
      else if (kind === 'members') await client.commitMemberConfiguration(workspaceId, { revision: view.members.revision, base: view.members.base, message: 'Approve member changes' });
      else await client.activateMemberConfiguration(workspaceId, { revision: view.configuration.activation.revision, digest: view.configuration.activation.digest });
      if (alive.current) { setNotice(kind === 'design' ? 'Design approved.' : kind === 'members' ? 'Member changes approved. Activate them when ready.' : 'Approved members activated.'); onApproved(); }
    } catch (cause) { if (alive.current) setOperationError(cause instanceof Error ? cause.message : 'Operation failed'); }
    finally {
      try { const next = await read(); if (alive.current) { setView(next); setError(null); } }
      catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Changes could not be refreshed'); }
      busy.current = false; if (alive.current) setOperation(null);
    }
  }
  const disabled = !!operation || loading || !!error;
  const activation = view?.configuration.activation;
  const files = view ? [...view.design.changes, ...view.members.changes] : [];
  return <section className="changes-tab" aria-label="Design and member changes">
    <header className="changes-head"><div><span className="eyebrow">CHANGES</span><h2>Review & approve</h2><p>Approve design and member files separately.</p></div><button type="button" className="text-button" disabled={!!operation || loading} onClick={() => void refresh()}><Glyph name="refresh" />Refresh</button></header>
    {(error || team.error) && <p className="changes-error" role="alert">{error ?? team.error}</p>}
    {!lead && !team.loading && <p className="changes-error" role="alert">Workspace lead is unavailable.</p>}
    {!view ? <p className="changes-note">{loading || team.loading ? 'Reading changes…' : 'Open this tab to review changes.'}</p> : <>
      <div className="change-approvals" aria-label="Approval actions">
        <div><span><strong>Design</strong><small>{view.design.changes.length} pending {view.design.changes.length === 1 ? 'file' : 'files'}</small></span><button type="button" className="secondary-button" disabled={disabled || !!lead?.running || !view.design.changes.length} onClick={() => void perform('design')}>{operation === 'design' ? 'Approving…' : 'Approve design'}</button></div>
        <div><span><strong>Members</strong><small>{view.members.changes.length} pending {view.members.changes.length === 1 ? 'file' : 'files'}</small></span><button type="button" className="secondary-button" disabled={disabled || !!lead?.running || !view.members.changes.length} onClick={() => void perform('members')}>{operation === 'members' ? 'Approving…' : 'Approve members'}</button></div>
      </div>
      <div className="member-activation"><span><strong>{activation?.hasChanges ? 'Approved members await activation' : 'Members are up to date'}</strong><small>{running ? 'Wait for all members to finish.' : view.members.changes.length ? 'Activation uses approved files; pending edits stay pending.' : 'Activation applies approved member configuration.'}</small></span><button type="button" className="primary-button" disabled={disabled || running || !activation?.valid || !activation.hasChanges} onClick={() => void perform('activate')}>{operation === 'activate' ? 'Activating…' : 'Activate members'}</button></div>
      {activation?.hasChanges && !activation.valid && <div className="changes-blockers" role="status"><strong>Member activation is blocked</strong><Issues issues={activation.issues} /></div>}
      {view.members.changes.length > 0 && !view.configuration.status.valid && <details className="changes-validation"><summary>Pending member validation issues</summary><Issues issues={view.configuration.status.issues} /></details>}
      {operationError && <p className="changes-error" role="alert">{operationError}</p>}
      {notice && <p className="changes-success" role="status">{notice}</p>}
      <FileDiff files={files} selected={selected} onSelect={setSelected} />
    </>}
  </section>;
}
function Issues({ issues }: { issues: ConfigurationIssue[] }) {
  return <ul>{issues.map((issue, index) => <li key={`${issue.path}:${index}`}><code>{issue.path}</code>: {issue.message}</li>)}</ul>;
}
