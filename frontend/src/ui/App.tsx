import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentRuntimeProvider } from '../adapter/AssistantRuntime.js';
import { AgentClient, createAgent } from '../client/agent-client.js';
import { ConfigClient, type AgentSummary, type ConfigRecord, type ConnectionView } from '../client/config-client.js';
import { ProvidersPage } from './ProvidersPage.js';
import { Conversation } from './Thread.js';
import { useAgentConfig } from './useAgentConfig.js';

type Route = { page: 'conversations' } | { page: 'conversation'; id: string } | { page: 'providers' };
const validId = /^[A-Za-z0-9_-]{1,64}$/;
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Request failed';

function readRoute(): Route {
  const query = new URLSearchParams(window.location.search);
  const id = query.get('agent');
  if (id && validId.test(id)) return { page: 'conversation', id };
  if (query.get('page') === 'providers') return { page: 'providers' };
  return { page: 'conversations' };
}
function routeUrl(route: Route): string {
  return route.page === 'conversation' ? `?agent=${encodeURIComponent(route.id)}` : `?page=${route.page}`;
}
function ChatIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" /><path d="M8 9h8M8 13h5" /></svg>;
}
function ConfigIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="white" /><circle cx="16" cy="12" r="2" fill="white" /><circle cx="11" cy="18" r="2" fill="white" /></svg>;
}
function AgentConversation({ agentId, api, configRefresh }: { agentId: string; api: ConfigClient; configRefresh: number }) {
  const client = useMemo(() => new AgentClient(agentId), [agentId]);
  const config = useAgentConfig(agentId, api);
  const [composerReady, setComposerReady] = useState(false);
  useEffect(() => { client.follow(); return () => client.dispose(); }, [client]);
  useEffect(() => { if (configRefresh) void config.refresh(); }, [configRefresh, config.refresh]);
  const sendAllowed = composerReady && !config.loading && !config.saving && !config.error && !!config.record && config.record.issues.length === 0;
  return <AgentRuntimeProvider client={client} sendAllowed={sendAllowed}>
    <Conversation client={client} config={config} api={api} onConfigGate={setComposerReady} />
  </AgentRuntimeProvider>;
}

export function App() {
  const api = useMemo(() => new ConfigClient(), []);
  const [route, setRoute] = useState<Route>(readRoute);
  const [lastConversationId, setLastConversationId] = useState<string | null>(() => {
    const initial = readRoute();
    if (initial.page === 'conversation') return initial.id;
    try {
      const saved = window.sessionStorage.getItem('lastConversationId');
      return saved && validId.test(saved) ? saved : null;
    } catch { return null; }
  });
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 760);
  const [title, setTitle] = useState('RSI Agent');
  const [allowCreation, setAllowCreation] = useState(true);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
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
    void loadAgents(); void loadConnections(); void loadApp();
    const onFocus = () => { void loadAgents(); void loadConnections(); void loadApp(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadAgents, loadConnections, loadApp]);
  useEffect(() => { document.title = title; }, [title]);
  useEffect(() => {
    if (!lastConversationId) return;
    try { window.sessionStorage.setItem('lastConversationId', lastConversationId); } catch { /* Keep navigation usable without session storage. */ }
  }, [lastConversationId]);
  useEffect(() => {
    const onPop = () => {
      const next = readRoute();
      setRoute(next);
      if (next.page === 'conversation') setLastConversationId(next.id);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(next: Route) {
    if (window.location.search !== routeUrl(next)) window.history.pushState(null, '', routeUrl(next));
    setRoute(next); setError(null);
    if (next.page === 'conversation') setLastConversationId(next.id);
    if (window.innerWidth <= 760) setPanelOpen(false);
  }
  function chooseSection(next: 'conversations' | 'config') {
    if (section === next) { setPanelOpen(!panelOpen); return; }
    navigate(next === 'config' ? { page: 'providers' } : lastConversationId ? { page: 'conversation', id: lastConversationId } : { page: 'conversations' });
    setPanelOpen(true);
  }
  async function newConversation() {
    setCreating(true); setError(null);
    try {
      const id = await createAgent();
      try {
        await api.createAgentConfig(id, { name: '', connectionId: null, modelId: null, toolOptionIds: [], prompt: '', promptOptionIds: [], modelOptions: [] });
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

  const filteredAgents = agents.filter(agent => `${agent.name} ${agent.agentId}`.toLowerCase().includes(search.toLowerCase().trim()));

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
        <div className="context-head"><span className="eyebrow">WORKSPACE</span><h2>Conversations</h2></div>
        <button type="button" className="new-conversation" disabled={creating || !allowCreation} title={allowCreation ? undefined : 'Conversation creation is disabled by app settings'} onClick={() => void newConversation()}><span>＋</span>{creating ? 'Creating…' : 'New conversation'}</button>
        <label className="sidebar-search"><span className="sr-only">Search conversations</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search conversations" /></label>
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
      {route.page === 'conversation' && <AgentConversation key={route.id} agentId={route.id} api={api} configRefresh={configRefresh} />}
      {route.page === 'conversations' && <div className="welcome-page"><div className="welcome-mark">✳</div><div className="eyebrow">CONVERSATIONS</div><h1>What would you like to explore?</h1><p>Select a conversation from the sidebar or create a new one.</p><button type="button" className="primary-button" disabled={creating || !allowCreation} onClick={() => void newConversation()}>＋ New conversation</button></div>}
      {route.page === 'providers' && <ProvidersPage api={api} records={connections} loading={connectionsLoading} loadError={connectionsError} refresh={loadConnections} focusId={focusProviderId} clearFocus={() => setFocusProviderId(null)} />}
    </main>
  </div>;
}
