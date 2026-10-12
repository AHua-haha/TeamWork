import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAgent } from '../client/agent-client.js';
import { ConfigClient, emptySettings, type AgentSummary, type ConfigRecord, type ConnectionView } from '../client/config-client.js';
import { WorkspaceClient, type WorkspaceRecord } from '../client/workspace-client.js';
import { ProvidersPage } from './ProvidersPage.js';
import { readRoute as parseRoute, routeUrl, sameRoute, validId, type Route } from './routes.js';
import { SoloPage } from './SoloPage.js';
import { ConfirmDialog, CreateWorkspaceDialog } from './WorkspaceDialogs.js';
import { WorkspacePage } from './WorkspacePage.js';

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Request failed';
const readRoute = () => parseRoute(window.location.search);
/** The page the user last had open in this browser session, so leaving Config returns to it. */
type ChatRoute = Extract<Route, { page: 'workspace' | 'conversation' }>;
const chatRoute = (route: Route): ChatRoute | null => route.page === 'workspace' || route.page === 'conversation' ? route : null;
const saveChat = (route: ChatRoute) => `${route.page}:${route.id}`;
function loadChat(value: string | null): ChatRoute | null {
  const [page, id] = (value ?? '').split(':');
  return (page === 'workspace' || page === 'conversation') && id && validId.test(id) ? { page, id } : null;
}
function ChatIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" /><path d="M8 9h8M8 13h5" /></svg>;
}
function ConfigIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="white" /><circle cx="16" cy="12" r="2" fill="white" /><circle cx="11" cy="18" r="2" fill="white" /></svg>;
}
export function App() {
  const api = useMemo(() => new ConfigClient(), []);
  const workspaceClient = useMemo(() => new WorkspaceClient(), []);
  const [route, setRoute] = useState<Route>(readRoute);
  const [lastChat, setLastChat] = useState<ChatRoute | null>(() => {
    const initial = chatRoute(readRoute());
    if (initial) return initial;
    try { return loadChat(window.sessionStorage.getItem('lastChat')); }
    catch { return null; }
  });
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 760);
  const [filesOpen, setFilesOpen] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [leaving, setLeaving] = useState<Route | null>(null);
  const filesDirty = useRef(false);
  const routeRef = useRef(route);
  routeRef.current = route;
  const [title, setTitle] = useState('RSI Agent');
  const [allowCreation, setAllowCreation] = useState(true);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [connections, setConnections] = useState<ConfigRecord<ConnectionView>[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [focusProviderId, setFocusProviderId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [configRefresh, setConfigRefresh] = useState(0);
  const section = route.page === 'providers' ? 'config' : 'conversations';

  const loadAgents = useCallback(async () => {
    try { setAgents(await api.listAgents()); setAgentsError(null); }
    catch (cause) { setAgentsError(errorText(cause)); }
    finally { setAgentsLoading(false); }
  }, [api]);
  const loadWorkspaces = useCallback(async () => {
    try { setWorkspaces(await workspaceClient.listWorkspaces()); setWorkspacesError(null); }
    catch (cause) { setWorkspacesError(errorText(cause)); }
    finally { setWorkspacesLoading(false); }
  }, [workspaceClient]);
  const loadConnections = useCallback(async () => {
    try { setConnections(await api.listConnections()); setConnectionsError(null); }
    catch (cause) { setConnectionsError(errorText(cause)); }
    finally { setConnectionsLoading(false); }
  }, [api]);
  const loadApp = useCallback(async () => {
    try {
      const record = await api.getApp();
      setTitle(record.value.title);
      setAllowCreation(record.value.allowAgentCreation);
    } catch { /* The backend enforces creation permissions even when this read is unavailable. */ }
  }, [api]);

  useEffect(() => {
    void loadAgents(); void loadWorkspaces(); void loadConnections(); void loadApp();
    const onFocus = () => { void loadAgents(); void loadWorkspaces(); void loadConnections(); void loadApp(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadAgents, loadWorkspaces, loadConnections, loadApp]);
  useEffect(() => { document.title = title; }, [title]);
  useEffect(() => {
    if (!lastChat) return;
    try { window.sessionStorage.setItem('lastChat', saveChat(lastChat)); } catch { /* Keep navigation usable without session storage. */ }
  }, [lastChat]);
  useEffect(() => {
    const onPop = () => {
      const next = readRoute();
      // Leaving a workspace page closes its open files, so unsaved edits are confirmed first.
      if (filesDirty.current && !sameRoute(next, routeRef.current)) {
        window.history.pushState(null, '', routeUrl(routeRef.current));
        setLeaving(next);
        return;
      }
      setRoute(next);
      const chat = chatRoute(next);
      if (chat) setLastChat(chat);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const onFilesDirty = useCallback((dirty: boolean) => { filesDirty.current = dirty; }, []);

  function navigate(next: Route) {
    if (filesDirty.current && !sameRoute(next, route)) { setLeaving(next); return; }
    if (window.location.search !== routeUrl(next)) window.history.pushState(null, '', routeUrl(next));
    setRoute(next); setError(null);
    const chat = chatRoute(next);
    if (chat) setLastChat(chat);
    if (window.innerWidth <= 760) setPanelOpen(false);
  }
  function showFiles(open: boolean) {
    if (open && window.innerWidth <= 760) setPanelOpen(false);
    setFilesOpen(open);
  }
  function chooseSection(next: 'conversations' | 'config') {
    if (section === next) { setPanelOpen(!panelOpen); return; }
    navigate(next === 'config' ? { page: 'providers' } : lastChat ?? { page: 'home' });
    setPanelOpen(true);
  }
  async function newConversation() {
    setCreating(true); setError(null);
    try {
      const id = await createAgent();
      try {
        await api.createAgentConfig(id, emptySettings);
      } catch (cause) { setError(`Conversation created, but setup needs attention: ${errorText(cause)}`); }
      await loadAgents();
      navigate({ page: 'conversation', id });
    } catch (cause) { setError(errorText(cause)); }
    finally { setCreating(false); }
  }
  async function saveName() {
    if (!renamingId) return;
    setRenameBusy(true); setRenameError(null);
    try {
      const record = await api.getAgent(renamingId);
      await api.updateAgent(record, { ...record.value, name: renameDraft.trim() });
      await loadAgents();
      setConfigRefresh(value => value + 1);
      setRenamingId(null);
    } catch (cause) { setRenameError(errorText(cause)); }
    finally { setRenameBusy(false); }
  }

  const needle = search.toLowerCase().trim();
  const filteredAgents = agents.filter(agent => `${agent.name} ${agent.agentId}`.toLowerCase().includes(needle));
  const filteredWorkspaces = workspaces.filter(workspace => `${workspace.name} ${workspace.directory}`.toLowerCase().includes(needle));

  return <div className={`app-shell ${panelOpen ? 'panel-open' : 'panel-closed'}`}>
    <nav className="icon-rail" aria-label="Primary navigation">
      <div className="rail-brand" title={title} aria-label={title}>✳</div>
      <button type="button" className={section === 'conversations' ? 'active' : ''} aria-label="Conversations" title="Conversations" aria-current={section === 'conversations' ? 'page' : undefined} onClick={() => chooseSection('conversations')}><ChatIcon /></button>
      <button type="button" className={section === 'config' ? 'active' : ''} aria-label="Config" title="Config" aria-current={section === 'config' ? 'page' : undefined} onClick={() => chooseSection('config')}><ConfigIcon /></button>
      <div className="rail-spacer" />
      <button type="button" className="rail-toggle" aria-label={panelOpen ? 'Collapse sidebar' : 'Expand sidebar'} title={panelOpen ? 'Collapse sidebar' : 'Expand sidebar'} onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? '‹' : '›'}</button>
    </nav>
    {panelOpen && <button type="button" className="mobile-scrim" aria-label="Close sidebar" onClick={() => setPanelOpen(false)} />}
    <aside className="context-panel" aria-label={section === 'conversations' ? 'Conversations sidebar' : 'Config sidebar'} aria-hidden={!panelOpen} inert={!panelOpen}>
      {section === 'conversations' ? <>
        <div className="context-head"><span className="eyebrow">PROJECTS</span><h2>Conversations</h2></div>
        <label className="sidebar-search"><span className="sr-only">Search workspaces and conversations</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></label>
        <div className="context-section-label with-action"><span>WORKSPACES</span>
          <button type="button" className="section-add" title="Add workspace" aria-label="Add workspace" onClick={() => setAddingWorkspace(true)}>＋</button></div>
        {workspacesError && <div className="sidebar-error" role="alert">{workspacesError}<button type="button" onClick={() => void loadWorkspaces()}>Retry</button></div>}
        <div className="context-list" aria-label="Workspace list">
          {workspacesLoading && !workspaces.length && <p className="sidebar-muted">Loading workspaces…</p>}
          {!workspacesLoading && !workspaces.length && !workspacesError && <p className="sidebar-muted">No workspaces yet. A workspace is a project folder with its own team.</p>}
          {filteredWorkspaces.map(workspace => <div className={`conversation-nav-row ${route.page === 'workspace' && route.id === workspace.workspaceId ? 'selected' : ''}`} key={workspace.workspaceId}>
            <button type="button" className="conversation-nav-link" title={workspace.directory} onClick={() => navigate({ page: 'workspace', id: workspace.workspaceId })}><span className="conversation-nav-mark">▣</span><span>{workspace.name}</span></button>
          </div>)}
        </div>
        <div className="context-section-label with-action"><span>CONVERSATIONS</span>
          <button type="button" className="section-add" disabled={creating || !allowCreation} title={allowCreation ? 'New conversation' : 'Conversation creation is disabled by app settings'} aria-label="New conversation" onClick={() => void newConversation()}>{creating ? '…' : '＋'}</button></div>
        {agentsError && <div className="sidebar-error" role="alert">{agentsError}<button type="button" onClick={() => void loadAgents()}>Retry</button></div>}
        <div className="context-list" aria-label="Conversation list">
          {agentsLoading && !agents.length && <p className="sidebar-muted">Loading conversations…</p>}
          {!agentsLoading && !agents.length && !agentsError && <p className="sidebar-muted">No conversations yet.</p>}
          {filteredAgents.map(agent => <div className={`conversation-nav-row ${route.page === 'conversation' && route.id === agent.agentId ? 'selected' : ''}`} key={agent.agentId}>
            {renamingId === agent.agentId ? <form className="rename-form" onSubmit={event => { event.preventDefault(); void saveName(); }}>
              <input aria-label="Conversation name" autoFocus value={renameDraft} disabled={renameBusy} onChange={event => setRenameDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setRenamingId(null); }} />
              <button type="submit" disabled={renameBusy} aria-label="Save conversation name">✓</button><button type="button" aria-label="Cancel rename" onClick={() => setRenamingId(null)}>×</button>
            </form> : <>
              <button type="button" className="conversation-nav-link" onClick={() => navigate({ page: 'conversation', id: agent.agentId })}><span className="conversation-nav-mark">◌</span><span>{agent.name || `Conversation · ${agent.agentId.slice(0, 8)}`}</span></button>
              <button type="button" className="rename-trigger" title="Rename conversation" aria-label={`Rename ${agent.name || 'conversation'}`} onClick={() => { setRenamingId(agent.agentId); setRenameDraft(agent.name); setRenameError(null); }}>✎</button>
            </>}
          </div>)}
        </div>
        {renameError && <div className="sidebar-error" role="alert">{renameError}<button type="button" onClick={() => setRenameError(null)}>Dismiss</button></div>}
      </> : <>
        <div className="context-head"><span className="eyebrow">CONFIG</span><h2>Providers</h2></div>
        <button type="button" className="context-overview" onClick={() => { setFocusProviderId(null); navigate({ page: 'providers' }); }}>All providers <span>{connections.length}</span></button>
        <div className="context-section-label">CONNECTIONS</div>
        {connectionsLoading && !connections.length && <p className="sidebar-muted">Loading providers…</p>}
        {connectionsError && <div className="sidebar-error" role="alert">{connectionsError}<button type="button" onClick={() => void loadConnections()}>Retry</button></div>}
        <div className="context-list" aria-label="Provider shortcuts">{connections.map(connection => <button type="button" className={`provider-shortcut ${focusProviderId === connection.id ? 'selected' : ''}`} key={connection.id} onClick={() => { setFocusProviderId(connection.id); navigate({ page: 'providers' }); }}>
          <span className="provider-shortcut-dot" /><span>{connection.value.label}</span>
        </button>)}</div>
      </>}
    </aside>
    <main className="main-area">
      {error && <div className="setup-error" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
      {route.page === 'workspace' && <WorkspacePage key={route.id} workspaceId={route.id} name={workspaces.find(item => item.workspaceId === route.id)?.name ?? null} api={api}
        files={{ open: filesOpen, expanded: filesExpanded, show: showFiles, expand: setFilesExpanded, onDirty: onFilesDirty }} />}
      {route.page === 'conversation' && <SoloPage key={route.id} agentId={route.id} api={api} configRefresh={configRefresh} />}
      {route.page === 'home' && <div className="welcome-page"><div className="welcome-mark">✳</div><div className="eyebrow">PROJECTS</div><h1>What would you like to work on?</h1>
        <p>Add a workspace to work on a project with its team, or start a conversation with no workspace.</p>
        <div className="welcome-actions"><button type="button" className="primary-button" onClick={() => setAddingWorkspace(true)}>＋ Add workspace</button>
          <button type="button" className="secondary-button" disabled={creating || !allowCreation} onClick={() => void newConversation()}>＋ New conversation</button></div></div>}
      {route.page === 'providers' && <ProvidersPage api={api} records={connections} loading={connectionsLoading} loadError={connectionsError} refresh={loadConnections} focusId={focusProviderId} clearFocus={() => setFocusProviderId(null)} />}
    </main>
    {leaving && <ConfirmDialog eyebrow="UNSAVED CHANGES" title="Leave with unsaved changes?" action="Discard and leave"
      message="Some open workspace files have changes that are not saved. Leaving this workspace closes them and discards the changes."
      onClose={() => setLeaving(null)} onConfirm={() => { const next = leaving; setLeaving(null); filesDirty.current = false; navigate(next); }} />}
    {addingWorkspace && <CreateWorkspaceDialog client={workspaceClient} onClose={() => setAddingWorkspace(false)} onCreated={created => {
      setAddingWorkspace(false);
      setWorkspaces(list => [...list.filter(item => item.workspaceId !== created.workspaceId), created].sort((a, b) => a.name.localeCompare(b.name)));
      navigate({ page: 'workspace', id: created.workspaceId });
    }} />}
  </div>;
}
