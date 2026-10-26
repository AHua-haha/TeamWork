import { WorkspaceResizeHandle } from './WorkspaceResizeHandle.js';
import { workspaceDetailsEnabled } from './workspace-features.js';
import { useChatRoster } from './useChatRoster.js';
import { MemberActivationPanel } from './MemberActivationPanel.js';
import { CommitReviewTab } from '../chat/CommitApproval.js';
import { ContextTab } from './ContextTab.js';
import { backendClient } from '../../shared/backend-client/index.js';
import { useEffect, useMemo, useState } from 'react';
import { WorkspaceClient } from '../../shared/backend-client/index.js';
import type { DiscussionReference } from '../../shared/backend-client/index.js';
import { GroupChat } from '../chat/GroupChat.js';
import { useTeam } from './useTeam.js';
import { WorkspacePanel } from './WorkspacePanel.js';

export interface FilesControl { open: boolean; expanded: boolean; show(open: boolean): void; expand(expanded: boolean): void; onDirty(dirty: boolean): void; showConversation(): void }

/**
 * A workspace page: the shared group chat, and the panel with the team and the files on its right. The workspace comes from
 * the address. The lead is found in the team, so the page waits for the team before it shows the chat.
 */
function DetailedWorkspacePage({ workspaceId, name, files }: { workspaceId: string; name: string | null; files: FilesControl }) {
  const client = useMemo(() => backendClient.workspace, []);
  const [commitReview,setCommitReview]=useState<{id:string;request:number}|null>(null);
  const [reference, setReference] = useState<DiscussionReference | null>(null);
  useEffect(() => { setReference(null);setCommitReview(null); }, [workspaceId]);
  const discuss = (next: DiscussionReference) => {
    setReference(next); files.showConversation();
  };
  const referenceSent = (sent: DiscussionReference) => setReference(current => current === sent ? null : current);
  const [teamRunning, setTeamRunning] = useState(false);
  const { state, lead } = useTeam(workspaceId, client, teamRunning);
  const title = name ?? 'Workspace';

  if (!lead) {
    return <div className="conversation-page"><div className="conversation">
      <div className="conversation-head"><div><div className="eyebrow">WORKSPACE</div><h2>{title}</h2></div></div>
      {state.error
        ? <div className="error-banner" role="alert">{state.error}<button type="button" onClick={() => void state.refresh()}>Retry</button></div>
        : <p className="sidebar-muted workspace-opening">Opening the workspace…</p>}
    </div></div>;
  }
  return <div className={`conversation-page ${files.open && files.expanded ? 'expanded' : ''}`}>
    <GroupChat key={workspaceId} workspaceId={workspaceId} team={state} title={title}
      filesOpen={files.open} onFiles={files.show} onCommitReview={id=>{setCommitReview({id,request:Date.now()});files.show(true);}} onRunning={setTeamRunning} discussion={{ reference, clear: () => setReference(null), sent: referenceSent }} />
    {files.open && <button type="button" className="workspace-scrim" aria-label="Hide workspace panel" onClick={() => files.show(false)} />}
    <WorkspacePanel open={files.open} expanded={files.expanded} workspaceId={workspaceId} team={state}
      commitReview={commitReview} onExpand={files.expand} onClose={() => files.show(false)} onDirty={files.onDirty} onDiscuss={discuss} />
  </div>;
}


/** The detailed screen is retained, but never mounted while the temporary switch is off. */
export function WorkspacePage(props: Parameters<typeof DetailedWorkspacePage>[0]) {
  return workspaceDetailsEnabled ? <DetailedWorkspacePage {...props} /> : <ChatWorkspacePage {...props} />;
}
function ChatWorkspacePage({workspaceId, name, files}: Parameters<typeof DetailedWorkspacePage>[0]) {
  const {state, lead} = useChatRoster(workspaceId, backendClient.workspace);
  const [running, setRunning] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(true);
  const title = name ?? 'Workspace';
  useEffect(() => { setReview(null); setRunning(false); setContextOpen(true); }, [workspaceId]);
  if (!lead) return <div className="conversation-page"><div className="conversation"><div className="conversation-head"><h2>{title}</h2></div>{state.error ? <div className="error-banner" role="alert">{state.error}<button type="button" onClick={() => void state.refresh()}>Retry</button></div> : <p className="sidebar-muted">Opening workspace chat…</p>}</div></div>;
  // Opening/closing the panel must not overwrite the selected tab.
  const showPanel = files.show;
  const panelActions = <div className="workspace-tab-actions"><button type="button" className={`workspace-tab ${contextOpen && !review ? 'active' : ''}`} onClick={() => { setReview(null); setContextOpen(true); showPanel(true); }} aria-current={contextOpen && !review ? 'true' : undefined}>Context</button><button type="button" className={`workspace-tab ${!contextOpen && !review ? 'active' : ''}`} onClick={() => { setReview(null); setContextOpen(false); showPanel(true); }} aria-current={!contextOpen && !review ? 'true' : undefined}>Member activation</button>{review && <button type="button" className="workspace-tab active">Commit review</button>}</div>;
  return <div className={`conversation-page ${files.open && files.expanded ? 'expanded' : ''}`}>
    <GroupChat key={workspaceId} workspaceId={workspaceId} team={state} title={title} filesOpen={files.open} onFiles={showPanel} onRunning={setRunning}
      panelLabel="Workspace tools" discussion={{reference: null, clear: () => {}, sent: () => {}}} onCommitReview={id => {setReview(id); showPanel(true);}} />
    {files.open && <><button type="button" className="workspace-scrim" aria-label="Hide workspace panel" onClick={() => showPanel(false)} />
      <aside className={`workspace-panel open ${files.expanded ? 'expanded' : ''}`} aria-label="Workspace context and activation">
        <WorkspaceResizeHandle disabled={files.expanded} />
        <div className="workspace-bar"><div className="workspace-tabs">{panelActions}</div><div className="workspace-bar-actions"><button type="button" className="text-button" onClick={() => files.expand(!files.expanded)}>{files.expanded ? 'Restore' : 'Expand'}</button><button type="button" className="text-button" onClick={() => showPanel(false)}>Close</button></div></div>
        <div className="workspace-body"><div className="workspace-viewer">{review ? <CommitReviewTab key={review} workspaceId={workspaceId} id={review} /> : contextOpen ? <ContextTab workspaceId={workspaceId} members={state.team?.members ?? []} client={backendClient.context} /> : <MemberActivationPanel key={workspaceId} workspaceId={workspaceId} running={running} onActivated={state.refresh} />}</div></div>
      </aside></>}
  </div>;
}
