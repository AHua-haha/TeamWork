import { useEffect, useState } from 'react';
import { AgentRuntimeProvider } from '../adapter/AssistantRuntime.js';
import { AgentClient, createAgent } from '../client/agent-client.js';
import { Conversation } from './Thread.js';

const validId = /^[A-Za-z0-9_-]{1,64}$/;
function routeAgentId(): string | null {
  const value = new URLSearchParams(window.location.search).get('agent');
  return value && validId.test(value) ? value : null;
}

export function App() {
  const [client, setClient] = useState<AgentClient | null>(() => {
    const id = routeAgentId();
    return id ? new AgentClient(id) : null;
  });
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (client) return;
    let cancelled = false;
    void createAgent().then(id => {
      if (cancelled) return;
      window.history.replaceState(null, '', `?agent=${encodeURIComponent(id)}`);
      setClient(new AgentClient(id));
    }).catch(error => { if (!cancelled) setSetupError(error instanceof Error ? error.message : 'Could not create agent'); });
    return () => { cancelled = true; };
  }, [client, setupAttempt]);

  useEffect(() => {
    if (!client) return;
    client.follow();
    return () => client.dispose();
  }, [client]);

  useEffect(() => {
    const onPopState = () => {
      const id = routeAgentId();
      if (id) setClient(current => current?.agentId === id ? current : new AgentClient(id));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  async function newAgent() {
    setCreating(true);
    setSetupError(null);
    try {
      const id = await createAgent();
      window.history.pushState(null, '', `?agent=${encodeURIComponent(id)}`);
      setClient(new AgentClient(id));
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Could not create agent');
    } finally { setCreating(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">✳</span><div><strong>RSI Agent</strong><small>Runtime console</small></div></div>
      <button className="new-agent" type="button" disabled={creating} onClick={() => void newAgent()}><span>＋</span> New agent</button>
      <div className="sidebar-section">WORKSPACE</div>
      {client && <div className="sidebar-agent"><span className="sidebar-agent-icon">◉</span><span><strong>Agent session</strong><small>{client.agentId}</small></span></div>}
      <div className="sidebar-bottom"><span className="sidebar-live" /> Backend owned runtime</div>
    </aside>
    <main className="main-area">
      {setupError && <div className="setup-error" role="alert">{setupError}<button type="button" onClick={() => { setSetupError(null); setSetupAttempt(value => value + 1); }}>Retry</button></div>}
      {client ? <AgentRuntimeProvider key={client.agentId} client={client}><Conversation client={client} /></AgentRuntimeProvider>
        : <div className="loading-state">Connecting to your agent…</div>}
    </main>
  </div>;
}
