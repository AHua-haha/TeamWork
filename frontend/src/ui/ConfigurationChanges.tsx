import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceClient, type CurrentMemberConfiguration, type ConfigurationIssue } from '../client/workspace-client.js';
import { ConfigurationDiff } from './ConfigurationDiff.js';
import { Glyph } from './Glyph.js';
import { pollIntervalMs } from './team-state.js';
import type { TeamState } from './useTeam.js';

/** Status, user operations and file review are independent parts of one inspected state. */
export function ConfigurationChanges({ workspaceId, team, visible }: { workspaceId: string; team: TeamState; visible: boolean }) {
  const client = useMemo(() => new WorkspaceClient(), []);
  const [view, setView] = useState<CurrentMemberConfiguration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<'commit' | 'activate' | null>(null);
  const [message, setMessage] = useState('Accept member configuration');
  const [selected, setSelected] = useState<string | null>(null);
  const alive = useRef(true), busy = useRef(false), request = useRef(0);
  const running = team.team?.members.some(member => member.running) ?? false;
  const refresh = useCallback(async () => {
    if (busy.current) return;
    const ticket = ++request.current; setLoading(true);
    try {
      const next = await client.currentMemberConfiguration(workspaceId);
      if (alive.current && ticket === request.current) { setView(next); setError(null); }
    } catch (cause) { if (alive.current && ticket === request.current) setError(cause instanceof Error ? cause.message : 'Configuration could not be read'); }
    finally { if (alive.current && ticket === request.current) setLoading(false); }
  }, [client, workspaceId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  useEffect(() => {
    if (!visible) return;
    void refresh();
    const focus = () => { void refresh(); }; window.addEventListener('focus', focus);
    const timer = running ? window.setInterval(focus, pollIntervalMs) : null;
    return () => { window.removeEventListener('focus', focus); if (timer !== null) window.clearInterval(timer); };
  }, [visible, running, refresh]);
  const perform = async (kind: 'commit' | 'activate') => {
    if (!view || busy.current) return;
    busy.current = true; request.current++; setLoading(false); setOperation(kind); setOperationError(null); setNotice(null);
    try {
      if (kind === 'commit') await client.commitMemberConfiguration(workspaceId, { ...view.commit, message: message.trim() });
      else await client.activateMemberConfiguration(workspaceId, { revision: view.activation.revision, digest: view.activation.digest });
      if (alive.current) setNotice(kind === 'commit' ? 'Files committed. Active members are unchanged.' : 'Committed configuration activated. Pending edits remain pending.');
      if (kind === 'activate') await team.refresh();
    } catch (cause) { if (alive.current) setOperationError(cause instanceof Error ? cause.message : 'Operation failed'); }
    finally {
      // A failed/stale operation also needs fresh review, without hiding its reason.
      try { const next = await client.currentMemberConfiguration(workspaceId); if (alive.current) { setView(next); setError(null); } }
      catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Review could not be refreshed'); }
      busy.current = false; if (alive.current) setOperation(null);
    }
  };
  const disabled = !!operation || loading || !!error;
  const leadBusy = team.team?.members.some(member => member.lead && member.running) ?? false;
  return <div className="configuration-changes">
    <div className="configuration-view-head"><div><h3>Configuration changes</h3><p>Current member files compared with active configuration.</p></div><button type="button" className="text-button" disabled={!!operation || loading} onClick={() => void refresh()}><Glyph name="refresh" />Refresh</button></div>
    {error && <div className="sidebar-error" role="alert">{error}<button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {!view ? <p className="sidebar-muted">{loading ? 'Reading configuration…' : 'Open this view to inspect configuration.'}</p> : <>
      <div className="configuration-overview">
        <section className="configuration-status" aria-label="Configuration status"><h4>Configuration status</h4>
          <div className="configuration-status-row"><span className={`configuration-pending ${view.status.hasPending ? 'pending' : ''}`}>{view.status.hasPending ? `${view.status.pendingPaths.length} pending ${view.status.pendingPaths.length === 1 ? 'file' : 'files'}` : 'No pending edits'}</span><span>{view.status.commits.length}{view.status.more ? '+' : ''} {view.status.commits.length === 1 && !view.status.more ? 'commit' : 'commits'} {view.status.historyKnown ? 'since activation' : 'available'}</span></div>
          <p className={view.status.valid ? 'configuration-valid' : 'configuration-invalid'}><Glyph name={view.status.valid ? 'check' : 'close'} />{view.status.valid ? 'Current configuration is valid' : 'Current configuration has validation issues'}</p>
          <Issues issues={view.status.issues} />
          <details className="configuration-history" open><summary><Glyph name="history" />Commit history</summary>
            {!view.status.historyKnown && <p className="configuration-preview-note">The previous backend did not record this team's activation revision. Available commits are shown; its active member snapshots are preserved.</p>}
            <ol>{view.status.commits.map(commit => <li key={commit.revision}><span>{commit.message}</span><small>{commit.revision.slice(0, 8)} · {new Date(commit.time).toLocaleString()}</small></li>)}<li><span>{view.active.revision ? 'Last activation' : 'Active snapshot'}</span><small>{view.active.time ? new Date(view.active.time).toLocaleString() : 'Existing active member configuration'}</small></li></ol>
            {view.status.more && <p className="configuration-preview-note">Showing the latest 100 commits.</p>}
          </details>
        </section>
        <section className="configuration-operations" aria-label="Configuration operations"><h4>Operations</h4>
          <label className="configuration-message">Commit message<input value={message} maxLength={1000} disabled={!!operation} onChange={event => setMessage(event.target.value)} /></label>
          <div className="configuration-operation"><div><strong>Commit pending files</strong><p>Accept files; active members stay unchanged.</p></div><button type="button" className="secondary-button" disabled={disabled || leadBusy || !view.status.hasPending || !message.trim()} onClick={() => void perform('commit')}><Glyph name="commit" />{operation === 'commit' ? 'Committing…' : 'Commit'}</button></div>
          <div className="configuration-operation"><div><strong>Activate committed configuration</strong><p>{view.status.hasPending ? 'Pending files will stay pending.' : 'Apply the reviewed committed files.'}</p></div><button type="button" className="primary-button" disabled={disabled || running || !view.activation.valid || !view.activation.hasChanges} onClick={() => void perform('activate')}><Glyph name="check" />{operation === 'activate' ? 'Activating…' : 'Activate'}</button></div>
          <p className="configuration-preview-note">{running ? 'Wait for all workspace members to finish before activation.' : 'Activation requires the entire workspace to be idle and starts no runs.'}</p>
          {!view.activation.valid && <details className="configuration-activation-issues"><summary>Committed configuration is not ready to activate</summary><Issues issues={view.activation.issues} /></details>}
          {operationError && <p role="alert" className="configuration-invalid">{operationError}</p>}
          {notice && <p role="status" className="configuration-valid">{notice}</p>}
        </section>
      </div>
      <ConfigurationDiff files={view.changes} selected={selected} onSelect={setSelected} />
    </>}
  </div>;
}
function Issues({ issues }: { issues: ConfigurationIssue[] }) {
  return issues.length ? <ul className="configuration-issues">{issues.map((issue, index) => <li key={`${issue.path}:${index}`}><code>{issue.path}</code>: {issue.message}</li>)}</ul> : null;
}
