import { useEffect, useMemo, useRef, useState } from 'react';
import { MemberInspector } from './MemberInspector.js';
import { MemberTree } from './MemberTree.js';
import { WorkspaceModelsDialog } from './WorkspaceDialogs.js';
import { WorkspaceClient, type DesignSummary, type Member, type Workspace } from '../client/workspace-client.js';
import { Glyph } from './Glyph.js';
import type { TeamState } from './useTeam.js';

/** Active ownership and details are separate from configuration file review. */
export function TeamTab({ team, workspace, designs, designsError, designsTruncated, selected, onSelect, onDesign, onImplementation, onDiscuss, onBrowse }: {
  team: TeamState; workspace: Workspace; designs: DesignSummary[]; designsError?: string | null; designsTruncated?: boolean; selected: string | null;
  onSelect(id: string | null): void; onDesign(path: string): void; onImplementation(path: string): void;
  onDiscuss(member: Member): void; onBrowse(): void;
}) {
  const members = team.team?.members ?? [];
  const client = useMemo(() => new WorkspaceClient(), []);
  const [modelsOpen, setModelsOpen] = useState(false);
  const member = members.find(member => member.memberId === selected);
  const detail = useRef<HTMLElement>(null);
  useEffect(() => { if (selected && detail.current && (detail.current.parentElement?.getBoundingClientRect().width ?? 0) <= 680) detail.current.scrollIntoView({ block: 'start' }); }, [selected]);
  return <div className="team-tab">
    {modelsOpen && <WorkspaceModelsDialog client={client} workspaceId={workspace.workspaceId} onClose={() => setModelsOpen(false)} onSaved={() => { setModelsOpen(false); void team.refresh(); }} />}
    <div className="team-head"><div><span className="eyebrow">TEAM</span><h2>{workspace.name}</h2></div><div className="team-header-actions"><button type="button" className="secondary-button" onClick={() => setModelsOpen(true)}>Workspace models</button><button type="button" className="secondary-button" onClick={onBrowse}>Browse files</button></div></div>
      {team.error && <div className="sidebar-error" role="alert">{team.error}<button type="button" onClick={() => void team.refresh()}>Retry</button></div>}
      {designsError && <p className="member-reasons" role="alert">Design catalog: {designsError}. Assigned references remain visible.</p>}
      {designsTruncated && <p className="team-note">Design discovery is truncated. Assigned designs are included; other designs may be missing.</p>}
      {team.loading && !members.length && <p className="sidebar-muted">Reading the team…</p>}
      <div className={`team-active-layout ${member ? 'with-detail' : ''}`}><MemberTree name={workspace.name} designs={designs} members={members} selected={selected} onSelect={onSelect} onDesign={onDesign} />
        {member && <aside ref={detail} className="team-member-detail" aria-label={`${member.name} active information`}><div className="team-detail-head"><h3>Active member</h3><button type="button" className="tree-action" aria-label="Close active member details" onClick={() => onSelect(null)}><Glyph name="close" /></button></div>
          <MemberInspector key={member.memberId} workspaceId={workspace.workspaceId} member={member} onDesign={onDesign} onImplementation={onImplementation} />
          <button type="button" className="text-button" onClick={() => onDiscuss(member)}>Discuss with lead</button>
        </aside>}
      </div>
  </div>;
}
