import type { Workspace } from '../client/workspace-client.js';
import { memberStatus, modelText } from './team-state.js';
import type { TeamState } from './useTeam.js';

/** The team as read-only member cards. The lead manages the team; the user asks the lead for changes. */
export function TeamTab({ team, workspace, note, onOpenScope, onBrowse }: {
  team: TeamState; workspace: Workspace; note: string | null; onOpenScope(path: string): void; onBrowse(): void;
}) {
  const members = team.team?.members ?? [];
  return <div className="team-tab">
    <div className="team-head">
      <div><span className="eyebrow">TEAM</span><h2>{workspace.name}</h2></div>
      <button type="button" className="secondary-button" onClick={onBrowse}>Browse files</button>
    </div>
    <p className="team-note">The lead manages the team. Ask the lead to add or change members.</p>
    {team.error && <div className="sidebar-error" role="alert">{team.error}<button type="button" onClick={() => void team.refresh()}>Retry</button></div>}
    {note && <div className="sidebar-error" role="status">{note}</div>}
    {team.loading && !members.length && <p className="sidebar-muted">Reading the team…</p>}
    <ul className="member-list">
      {members.map(member => {
        const status = memberStatus(member);
        const model = modelText(member);
        return <li key={member.memberId} className={`member-card ${status.label === 'Working' ? 'working' : ''}`}>
          <div className="member-head">
            <strong>{member.name}</strong>
            {member.lead && <span className="member-lead">Lead</span>}
            <span className="member-role">{member.role}</span>
            <span className={`member-status ${status.label.replace(' ', '-').toLowerCase()}`}><span className="status-dot" />{status.label}</span>
          </div>
          {status.reasons.length > 0 && <p className="member-reasons">{status.reasons.join(' · ')}{member.lead ? '. Choose a model in the composer.' : ''}</p>}
          <p className="member-responsibility">{member.responsibility || 'No responsibility given yet.'}</p>
          <dl className="member-facts">
            <dt>Model</dt><dd>{model ?? 'None selected'}</dd>
            <dt>Scope</dt>
            <dd>{member.scope.length ? <ul className="member-scope">{member.scope.map(path => <li key={path}>
              <button type="button" className="text-button" title={`Show .context/${path}`} onClick={() => onOpenScope(path)}>{path}</button>
            </li>)}</ul> : member.lead ? 'All agent context' : 'None'}</dd>
          </dl>
        </li>;
      })}
    </ul>
  </div>;
}
