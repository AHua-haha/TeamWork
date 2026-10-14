import { useEffect, useMemo, useState } from 'react';
import { WorkspaceClient } from '../client/workspace-client.js';
import type { DiscussionReference } from '../client/discussion-reference.js';
import { GroupChat } from './GroupChat.js';
import { useTeam } from './useTeam.js';
import { WorkspacePanel } from './WorkspacePanel.js';

export interface FilesControl { open: boolean; expanded: boolean; show(open: boolean): void; expand(expanded: boolean): void; onDirty(dirty: boolean): void; showConversation(): void }

/**
 * A workspace page: the shared group chat, and the panel with the team and the files on its right. The workspace comes from
 * the address. The lead is found in the team, so the page waits for the team before it shows the chat.
 */
export function WorkspacePage({ workspaceId, name, files }: { workspaceId: string; name: string | null; files: FilesControl }) {
  const client = useMemo(() => new WorkspaceClient(), []);
  const [reference, setReference] = useState<DiscussionReference | null>(null);
  useEffect(() => { setReference(null); }, [workspaceId]);
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
      filesOpen={files.open} onFiles={files.show} onRunning={setTeamRunning} discussion={{ reference, clear: () => setReference(null), sent: referenceSent }} />
    {files.open && <button type="button" className="workspace-scrim" aria-label="Hide workspace panel" onClick={() => files.show(false)} />}
    <WorkspacePanel open={files.open} expanded={files.expanded} workspaceId={workspaceId} team={state}
      onExpand={files.expand} onClose={() => files.show(false)} onDirty={files.onDirty} onDiscuss={discuss} />
  </div>;
}
