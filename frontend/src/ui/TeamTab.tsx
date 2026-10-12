import { useEffect, useRef } from 'react';
import type { DesignSummary, Member, Workspace } from '../client/workspace-client.js';
import { implementationAccess, memberDesigns } from './design-state.js';
import { memberStatus, modelText } from './team-state.js';
import type { TeamState } from './useTeam.js';

/** Current member information and inspectable harnesses. Changes are discussed with the lead. */
export function TeamTab({ team, workspace, designs, selected, onSelect, onDesign, onImplementation, onDiscuss, onBrowse }: {
  team: TeamState; workspace: Workspace; designs: DesignSummary[]; selected: string | null;
  onSelect(id: string | null): void; onDesign(path: string): void; onImplementation(path: string): void;
  onDiscuss(member: Member): void; onBrowse(): void;
}) {
  const members = team.team?.members ?? [];
  const cards = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => { if (selected) cards.current.get(selected)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [selected]);
  return <div className="team-tab">
    <div className="team-head">
      <div><span className="eyebrow">TEAM</span><h2>{workspace.name}</h2></div>
      <button type="button" className="secondary-button" onClick={onBrowse}>Browse files</button>
    </div>
    <p className="team-note">The lead manages the team. Select a member to inspect its harness, or discuss changes with the lead.</p>
    {team.error && <div className="sidebar-error" role="alert">{team.error}<button type="button" onClick={() => void team.refresh()}>Retry</button></div>}
    {team.loading && !members.length && <p className="sidebar-muted">Reading the team…</p>}
    <ul className="member-list">
      {members.map(member => {
        const status = memberStatus(member);
        const scopes = memberDesigns(member, designs);
        const readonly = scopes.dependencies.flatMap(item => item.design?.implementation ?? []);
        const expanded = selected === member.memberId;
        return <li key={member.memberId} ref={node => { if (node) cards.current.set(member.memberId, node); else cards.current.delete(member.memberId); }}
          className={`member-card ${status.label === 'Working' ? 'working' : ''} ${expanded ? 'selected' : ''}`}>
          <div className="member-head">
            <button type="button" className="member-name" aria-expanded={expanded} onClick={() => onSelect(expanded ? null : member.memberId)}>{member.name}</button>
            {member.lead && <span className="member-lead">Lead</span>}
            <span className="member-role">{member.role}</span>
            <span className={`member-status ${status.label.replace(' ', '-').toLowerCase()}`}><span className="status-dot" />{status.label}</span>
          </div>
          {status.reasons.length > 0 && <p className="member-reasons">{status.reasons.join(' · ')}{member.lead && status.reasons.includes('Select a provider and model') ? '. Choose a model in the composer.' : ''}</p>}
          <p className="member-responsibility">{member.responsibility || 'No responsibility given yet.'}</p>
          <dl className="member-facts">
            <dt>Model</dt><dd>{modelText(member) ?? 'None selected'}</dd>
            <dt>Working designs</dt><dd><DesignLinks paths={member.harness.designScope.working} onDesign={onDesign} /></dd>
            <dt>Dependencies</dt><dd><DesignLinks paths={member.harness.designScope.dependencies} onDesign={onDesign} /></dd>
          </dl>
          <div className="member-actions"><button type="button" className="text-button" aria-expanded={expanded} onClick={() => onSelect(expanded ? null : member.memberId)}>{expanded ? 'Hide harness' : 'Inspect harness'}</button>
            <button type="button" className="text-button" onClick={() => onDiscuss(member)}>Discuss with lead</button></div>
          {expanded && <section className="member-harness" aria-label={`${member.name} harness`}>
            <h3>File-tool scope</h3>
            <p>Working designs are read and followed. Dependency designs and implementation are read-only.</p>
            {member.lead && <p>The lead can inspect the workspace and context. Implementation edits follow its working designs.</p>}
            <h4>Working implementation</h4>
            {scopes.working.length ? scopes.working.map(item => <div key={item.path} className="member-mapping">
              <button type="button" className="text-button" onClick={() => onDesign(item.path)}>{item.path}</button>
              {item.design ? <ScopePaths paths={item.design.implementation} access={path => implementationAccess(path, readonly)} onOpen={onImplementation} /> : <p className="scope-unavailable">Design mapping unavailable.</p>}
            </div>) : <p>No working design configured.</p>}
            <h4>Dependency implementation</h4>
            {scopes.dependencies.length ? scopes.dependencies.map(item => <div key={item.path} className="member-mapping">
              <button type="button" className="text-button" onClick={() => onDesign(item.path)}>{item.path}</button>
              {item.design ? <ScopePaths paths={item.design.implementation} access={() => 'Read only'} onOpen={onImplementation} /> : <p className="scope-unavailable">Design mapping unavailable.</p>}
            </div>) : <p>No dependency design configured.</p>}
            {readonly.length > 0 && <p>Dependency read-only paths take precedence wherever they overlap working implementation.</p>}
            <h4>Allowed commands</h4>
            {member.harness.allowedCommands.length ? <ul className="command-rules">{member.harness.allowedCommands.map((rule, index) => <li key={index}>
              <span>{rule.kind === 'exact' ? 'Exact command' : 'Executable with arguments'}</span><code>{rule.kind === 'exact' ? JSON.stringify(rule.argv) : rule.executable}</code>
            </li>)}</ul> : <p>None allowed.</p>}
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
