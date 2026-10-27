import { WorkspaceResizeHandle } from './WorkspaceResizeHandle.js';
import { useChatRoster } from './useChatRoster.js';
import { MemberActivationPanel } from './MemberActivationPanel.js';
import { ContextTab } from './ContextTab.js';
import { backendClient } from '../../shared/backend-client/index.js';
import { WorkspaceModelsDialog } from './WorkspaceDialogs.js';
import { useEffect, useState } from 'react';
import { GroupChat } from '../chat/GroupChat.js';

export interface FilesControl { open: boolean; expanded: boolean; show(open: boolean): void; expand(expanded: boolean): void }

/** Workspace chat with lightweight, on-demand context, activation and model-settings tools. */
export function WorkspacePage({workspaceId, name, files}: {workspaceId: string; name: string | null; files: FilesControl}) {
  const {state, lead} = useChatRoster(workspaceId, backendClient.workspace);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<'context' | 'activation' | 'models'>('context');
  const [modelsOpen, setModelsOpen] = useState(false);
  const title = name ?? 'Workspace';
  useEffect(() => { setRunning(false); setSelected('context'); setModelsOpen(false); }, [workspaceId]);
  if (!lead) return <div className="conversation-page"><div className="conversation"><div className="conversation-head"><h2>{title}</h2></div>{state.error ? <div className="error-banner" role="alert">{state.error}<button type="button" onClick={() => void state.refresh()}>Retry</button></div> : <p className="sidebar-muted">Opening workspace chat…</p>}</div></div>;
  const showPanel = files.show;
  return <div className={`conversation-page ${files.open && files.expanded ? 'expanded' : ''}`}>
    <GroupChat key={workspaceId} workspaceId={workspaceId} team={state} title={title} filesOpen={files.open} onFiles={showPanel} onRunning={setRunning}
      panelLabel="Workspace tools" discussion={{reference: null, clear: () => {}, sent: () => {}}} />
    {files.open && <><button type="button" className="workspace-scrim" aria-label="Hide workspace panel" onClick={() => showPanel(false)} />
      <aside className={`workspace-panel open ${files.expanded ? 'expanded' : ''}`} aria-label="Workspace tools">
        <WorkspaceResizeHandle disabled={files.expanded} />
        <div className="workspace-bar"><div className="workspace-tabs workspace-tab-actions">
          <button type="button" className={`workspace-tab ${selected === 'context' ? 'active' : ''}`} onClick={() => setSelected('context')}>Context</button>
          <button type="button" className={`workspace-tab ${selected === 'activation' ? 'active' : ''}`} onClick={() => setSelected('activation')}>Member activation</button>
          <button type="button" className="workspace-tab" onClick={() => setModelsOpen(true)}>Workspace models</button>
        </div><div className="workspace-bar-actions"><button type="button" className="text-button" onClick={() => files.expand(!files.expanded)}>{files.expanded ? 'Restore' : 'Expand'}</button><button type="button" className="text-button" onClick={() => showPanel(false)}>Close</button></div></div>
        <div className="workspace-body"><div className="workspace-viewer">{selected === 'context' ? <ContextTab workspaceId={workspaceId} members={state.team?.members ?? []} client={backendClient.context} /> : selected === 'activation' ? <MemberActivationPanel key={workspaceId} workspaceId={workspaceId} running={running} onActivated={state.refresh} /> : null}</div></div>
      </aside></>}
    {modelsOpen && <WorkspaceModelsDialog client={backendClient.workspace} workspaceId={workspaceId} onSaved={() => setModelsOpen(false)} onClose={() => setModelsOpen(false)} />}
  </div>;
}
