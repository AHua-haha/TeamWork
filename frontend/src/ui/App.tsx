import { useEffect, useMemo, useState } from 'react';
import { AgentRuntimeProvider } from '../adapter/AssistantRuntime.js';
import { AgentClient, createAgent } from '../client/agent-client.js';
import { ConfigClient } from '../client/config-client.js';
import { AgentConfigPage, AgentsIndex, AppSettingsPage } from './ConfigPages.js';
import { CatalogPage } from './CatalogPage.js';
import { Conversation } from './Thread.js';
import { useAgentConfig } from './useAgentConfig.js';

type Route = { page: 'agents' | 'catalog' | 'settings' } | { page: 'agent'; id: string; tab: 'chat' | 'config' };
const validId = /^[A-Za-z0-9_-]{1,64}$/;

function readRoute(): Route {
  const query = new URLSearchParams(window.location.search);
  const id = query.get('agent');
  if (id && validId.test(id)) return { page: 'agent', id, tab: query.get('tab') === 'config' ? 'config' : 'chat' };
  if (query.get('page') === 'catalog') return { page: 'catalog' };
  if (query.get('page') === 'settings') return { page: 'settings' };
  return { page: 'agents' };
}

function routeUrl(route: Route): string {
  if (route.page === 'agent') return `?agent=${encodeURIComponent(route.id)}&tab=${route.tab}`;
  return `?page=${route.page}`;
}

function AgentConversation({ agentId, config, api }: { agentId: string; config: ReturnType<typeof useAgentConfig>; api: ConfigClient }) {
  const client = useMemo(() => new AgentClient(agentId), [agentId]);
  const [composerReady, setComposerReady] = useState(true);
  useEffect(() => { client.follow(); return () => client.dispose(); }, [client]);
  const sendAllowed = composerReady && !config.loading && !config.saving && !config.error && !!config.record && config.record.issues.length === 0;
  return <AgentRuntimeProvider client={client} sendAllowed={sendAllowed}>
    <Conversation client={client} config={config} api={api} onConfigGate={setComposerReady} />
  </AgentRuntimeProvider>;
}

function AgentWorkspace({ route, api, navigate }: { route: Extract<Route, { page: 'agent' }>; api: ConfigClient; navigate: (route: Route) => void }) {
  const config = useAgentConfig(route.id, api);
  return <div className="workspace">
    <div className="workspace-tabs"><button className={route.tab === 'chat' ? 'active' : ''} onClick={() => navigate({ ...route, tab: 'chat' })}>Conversation</button>
      <button className={route.tab === 'config' ? 'active' : ''} onClick={() => navigate({ ...route, tab: 'config' })}>Configuration</button></div>
    <div className="workspace-body">{route.tab === 'chat' ? <AgentConversation key={route.id} agentId={route.id} config={config} api={api} /> : <AgentConfigPage control={config} api={api} />}</div>
  </div>;
}

export function App() {
  const api = useMemo(() => new ConfigClient(), []);
  const [route, setRoute] = useState<Route>(readRoute);
  const [title, setTitle] = useState('RSI Agent');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowCreation, setAllowCreation] = useState(true);

  function navigate(next: Route) { window.history.pushState(null, '', routeUrl(next)); setRoute(next); setError(null); }
  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    void api.getApp().then(record => { setTitle(record.value.title); setAllowCreation(record.value.allowAgentCreation); }).catch(() => {});
  }, [api, route]);
  useEffect(() => { document.title = title; }, [title]);

  async function newAgent() {
    setCreating(true); setError(null);
    try { const id = await createAgent(); navigate({ page: 'agent', id, tab: 'config' }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create agent'); }
    finally { setCreating(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">✳</span><div><strong>{title}</strong><small>Runtime console</small></div></div>
      <button className="new-agent" type="button" disabled={creating || !allowCreation} onClick={() => void newAgent()}><span>＋</span> New agent</button>
      <div className="sidebar-section">WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        <button aria-label="Agents" className={route.page === 'agents' || route.page === 'catalog' || route.page === 'agent' ? 'active' : ''} onClick={() => navigate({ page: 'agents' })}>◉ <span>Agents</span></button>
        {route.page === 'agent' && <button className="sidebar-current" onClick={() => navigate({ ...route, tab: 'chat' })}>↳ <span>{route.id}</span></button>}
        <button aria-label="App settings" className={route.page === 'settings' ? 'active' : ''} onClick={() => navigate({ page: 'settings' })}>⚙ <span>App settings</span></button>
      </nav>
      <div className="sidebar-bottom"><span className="sidebar-live" /> Backend owned runtime</div>
    </aside>
    <main className="main-area">
      {error && <div className="setup-error" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
      {route.page === 'agents' && <AgentsIndex api={api} openAgent={id => navigate({ page: 'agent', id, tab: 'chat' })} openCatalog={() => navigate({ page: 'catalog' })} />}
      {route.page === 'catalog' && <CatalogPage api={api} />}
      {route.page === 'settings' && <AppSettingsPage api={api} onTitle={setTitle} />}
      {route.page === 'agent' && <AgentWorkspace key={route.id} route={route} api={api} navigate={navigate} />}
    </main>
  </div>;
}
