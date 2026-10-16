import { MemberInspector } from './MemberInspector.js';
import { WorkspaceModelsDialog } from './WorkspaceDialogs.js';
import { WorkspaceClient } from '../client/workspace-client.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesignSummary, Member, Workspace } from '../client/workspace-client.js';
import { implementationAccess } from './design-state.js';
import { memberStatus, modelText } from './team-state.js';
import type { TeamState } from './useTeam.js';

/** Current member information and inspectable harnesses. Changes are discussed with the lead. */
export function TeamTab({ team, workspace, selected, onSelect, onDesign, onImplementation, onDiscuss, onBrowse }: {
  team: TeamState; workspace: Workspace; designs: DesignSummary[]; selected: string | null;
  onSelect(id: string | null): void; onDesign(path: string): void; onImplementation(path: string): void;
  onDiscuss(member: Member): void; onBrowse(): void;
}) {
  const members = team.team?.members ?? [];
  const client = useMemo(() => new WorkspaceClient(), []);
  const [modelsOpen, setModelsOpen] = useState(false);
  const cards = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => { if (selected) cards.current.get(selected)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [selected]);
  return <div className="team-tab">
    {modelsOpen && <WorkspaceModelsDialog client={client} workspaceId={workspace.workspaceId} onClose={() => setModelsOpen(false)} onSaved={() => { setModelsOpen(false); void team.refresh(); }} />}
    <div className="team-head">
      <div><span className="eyebrow">TEAM</span><h2>{workspace.name}</h2></div>
      <div className="team-header-actions"><button type="button" className="secondary-button" onClick={() => setModelsOpen(true)}>Workspace models</button><button type="button" className="secondary-button" onClick={onBrowse}>Browse files</button></div>
    </div>
    <p className="team-note">The lead manages the team. Select a member to inspect its harness, or discuss changes with the lead.</p>
    {team.error && <div className="sidebar-error" role="alert">{team.error}<button type="button" onClick={() => void team.refresh()}>Retry</button></div>}
    {team.loading && !members.length && <p className="sidebar-muted">Reading the team…</p>}
    <ul className="member-list">
      {members.map(member => {
        const status = memberStatus(member);
        const readonly = member.harness.implementationScope.usePaths;
        const expanded = selected === member.memberId;
        return <li key={member.memberId} ref={node => { if (node) cards.current.set(member.memberId, node); else cards.current.delete(member.memberId); }}
          className={`member-card ${status.label === 'Working' ? 'working' : ''} ${expanded ? 'selected' : ''}`}>
          <div className="member-head">
            <button type="button" className="member-name" aria-expanded={expanded} onClick={() => onSelect(expanded ? null : member.memberId)}>{member.name}</button>
            {member.lead && <span className="member-lead">Lead</span>}
            <span className="member-role">{member.role}</span>
            <span className={`member-status ${status.label.replace(' ', '-').toLowerCase()}`}><span className="status-dot" />{status.label}</span>
          </div>
          {status.reasons.length > 0 && <p className="member-reasons">{status.reasons.join(' · ')}{member.lead && status.reasons.includes('Select a provider and model') ? '. Open Workspace models to configure its initial model.' : ''}</p>}
          <p className="member-responsibility">{member.responsibility || 'No responsibility given yet.'}</p>
          <dl className="member-facts">
            <dt>Model</dt><dd>{modelText(member) ?? 'None selected'}</dd>
            <dt>Working designs</dt><dd><DesignLinks paths={member.harness.designScope.working} onDesign={onDesign} /></dd>
            <dt>Dependencies</dt><dd><DesignLinks paths={member.harness.designScope.dependencies} onDesign={onDesign} /></dd>
          </dl>
          <div className="member-actions"><button type="button" className="text-button" aria-expanded={expanded} onClick={() => onSelect(expanded ? null : member.memberId)}>{expanded ? 'Hide harness' : 'Inspect harness'}</button>
            <button type="button" className="text-button" onClick={() => onDiscuss(member)}>Discuss with lead</button></div>
          {expanded && <section className="member-harness" aria-label={`${member.name} harness`}>
            <MemberInspector workspaceId={workspace.workspaceId} member={member} />
            <h3>File-tool scope</h3>
            <p>Working designs can be edited as pending changes; only the user accepts design commits. Dependency designs are read-only.</p>
            {member.lead && <p>The lead can inspect the workspace and maintain user designs and member configuration drafts.</p>}
            <h4>Editable paths from accepted designs</h4>
            {member.harness.implementationScope.paths.length ? <ScopePaths paths={member.harness.implementationScope.paths} access={path => implementationAccess(path, readonly)} onOpen={onImplementation} /> : <p>No implementation edits assigned.</p>}
            <h4>Read-only use paths</h4>
            {readonly.length ? <ScopePaths paths={readonly} access={() => 'Read only'} onOpen={onImplementation} /> : <p>No use paths assigned.</p>}
            <p>Implementation paths are assigned explicitly. Design mappings do not grant file access. Read-only use paths take precedence on overlap.</p>
          </section>}
        </li>;
      })}
    </ul>
  </div>;
}
function DesignLinks({ paths, onDesign }: { paths: string[]; onDesign(path: string): void }) {
  return paths.length ? <ul className="member-scope">{paths.map(path => <li key={path}><button type="button" className="text-button" onClick={() => onDesign(path)}>{path}</button></li>)}</ul> : <>None</>;
}
function ScopePaths({ paths, access, onOpen }: { paths: string[]; access(path: string): string; onOpen(path: string): void }) {
  return paths.length ? <ul className="scope-paths">{paths.map(path => <li key={path}><button type="button" className="text-button" onClick={() => onOpen(path)}>{path}</button><span>{access(path)}</span></li>)}</ul> : <p>No implementation paths mapped.</p>;
}
