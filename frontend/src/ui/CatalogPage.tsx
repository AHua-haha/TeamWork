import { useEffect, useState } from 'react';
import { ConfigClient, type Capabilities, type CatalogOption, type ConfigRecord, type ConnectionInput, type ConnectionView, type ModelChoice, type PromptOption, type ToolOption } from '../client/config-client.js';

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Request failed';
const newId = (kind: string) => `${kind}-${crypto.randomUUID()}`;
type Reload = () => Promise<void>;

function Header() {
  return <header className="panel-head"><div className="eyebrow">AGENTS / CATALOG</div><h2>Global agent catalog</h2><p>Configure the models, prompts, and registered tools agents may select.</p></header>;
}

function ChoiceList({ title, items, selectedId, select }: { title: string; items: ConfigRecord<CatalogOption>[] | ConfigRecord<ConnectionView>[]; selectedId: string; select: (id: string) => void }) {
  return <div className="catalog-list"><button className={!selectedId ? 'selected' : ''} onClick={() => select('')}>＋ New {title}</button>
    {items.map(item => <button key={item.id} className={selectedId === item.id ? 'selected' : ''} onClick={() => select(item.id)}><strong>{item.value.label}</strong><small>{'provider' in item.value ? item.value.provider : 'toolName' in item.value ? item.value.toolName : 'Prompt template'}</small></button>)}
  </div>;
}

function ConnectionsTab({ api, records, capabilities, reload }: { api: ConfigClient; records: ConfigRecord<ConnectionView>[]; capabilities: Capabilities; reload: Reload }) {
  const [selectedId, setSelectedId] = useState('');
  const [revision, setRevision] = useState<number | null>(null);
  const [draft, setDraft] = useState<ConnectionInput>({ label: '', provider: '', baseUrl: '', api: 'openai-completions' });
  const [secret, setSecret] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [choices, setChoices] = useState<ModelChoice[]>([]);
  const [search, setSearch] = useState('');
  const selected = records.find(item => item.id === selectedId);
  useEffect(() => { if (!selectedId) { setChoices([]); return; } let live = true; void api.modelChoices(selectedId).then(items => { if (live) setChoices(items); }).catch(cause => { if (live) setError(errorText(cause)); }); return () => { live = false; }; }, [api, selectedId, selected?.revision]);
  const providers = [...new Set(capabilities.models.map(item => item.provider))].sort();

  function select(id: string) {
    const record = records.find(item => item.id === id);
    setSelectedId(id); setRevision(record?.revision ?? null);
    setDraft(record ? { label: record.value.label, provider: record.value.provider, baseUrl: record.value.baseUrl, api: record.value.api } : { label: '', provider: '', baseUrl: '', api: 'openai-completions' });
    setSecret(''); setClearKey(false); setError(null); setNotice(null);
  }
  async function save() {
    if (selected && revision !== selected.revision) { setError('This connection changed elsewhere. Review its latest version.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const value: ConnectionInput = { ...draft, ...(clearKey ? { apiKey: null } : secret ? { apiKey: secret } : {}) };
      const saved = selected ? await api.updateConnection(selected, value) : await api.createConnection(newId('connection'), value);
      await reload(); setSelectedId(saved.id); setRevision(saved.revision); setSecret(''); setClearKey(false);
      if (capabilities.models.some(item => item.provider === saved.value.provider)) {
        setChoices(await api.modelChoices(saved.id)); setNotice('Connection saved. Pi models are available below.');
      } else {
        try { setChoices(await api.modelChoices(saved.id, true)); setNotice('Saved connection and discovered available models.'); }
        catch (cause) { setChoices(await api.modelChoices(saved.id)); setNotice(`Connection saved. Model discovery failed: ${errorText(cause)}`); }
      }
    } catch (cause) { setError(errorText(cause)); await reload(); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || !window.confirm(`Delete connection “${selected.value.label}”? Agents using it will need another provider for later runs.`)) return;
    setBusy(true); setError(null);
    try { await api.deleteConnection(selected); await reload(); select(''); setNotice('Connection deleted.'); }
    catch (cause) { setError(errorText(cause)); await reload(); }
    finally { setBusy(false); }
  }
  async function discover() { if (!selectedId) return; setBusy(true); setError(null); try { setChoices(await api.modelChoices(selectedId, true)); setNotice('Available models refreshed.'); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }
  return <div className="catalog-layout"><ChoiceList title="provider" items={records} selectedId={selectedId} select={select} />
    <div className="form-panel"><h3>{selected ? `Edit ${selected.value.label}` : 'New provider connection'}</h3>
      {error && <div className="form-error" role="alert">{error}{selected && <button onClick={() => select(selectedId)}>Review latest</button>}</div>}
      {notice && <div className="form-notice" role="status">{notice}</div>}
      <label>Connection name <input value={draft.label} disabled={busy} onChange={event => setDraft({ ...draft, label: event.target.value })} placeholder="OpenAI production" /></label>
      <label>Provider <input list="pi-providers" value={draft.provider} disabled={busy} onChange={event => {
        const provider = event.target.value;
        const known = capabilities.models.find(item => item.provider === provider);
        setDraft({ ...draft, provider, baseUrl: known?.baseUrl && (!draft.baseUrl || draft.baseUrl === capabilities.models.find(item => item.provider === draft.provider)?.baseUrl) ? known.baseUrl : draft.baseUrl,
          api: known?.api === 'anthropic-messages' ? 'anthropic-messages' : known?.api === 'openai-responses' ? 'openai-responses' : known?.api === 'openai-completions' ? 'openai-completions' : draft.api });
      }} placeholder="Choose a Pi provider or name a custom one" />
        <datalist id="pi-providers">{providers.map(provider => <option value={provider} key={provider} />)}</datalist></label>
      <label>Base URL <input type="url" value={draft.baseUrl} disabled={busy} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} placeholder={draft.api === 'anthropic-messages' ? 'https://api.anthropic.com' : 'https://example.com/v1'} />
        {draft.api === 'anthropic-messages' && <small>Use the provider root URL. Discovery requests /v1/models; model calls use Pi's Anthropic Messages adapter.</small>}</label>
      <label>Custom endpoint protocol <select value={draft.api} disabled={busy} onChange={event => setDraft({ ...draft, api: event.target.value as ConnectionInput['api'] })}>
        <option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option>
      </select><small>This protocol is used for calls to every model on this connection. Pi suggests a default when you choose a known provider.</small></label>
      <label>API key <input type="password" autoComplete="new-password" value={secret} disabled={busy || clearKey} onChange={event => setSecret(event.target.value)} placeholder={selected?.value.keyConfigured ? 'Configured — enter a replacement' : 'Optional for keyless local endpoints'} />
        <small>{selected?.value.keyConfigured ? 'A key is configured. Its value cannot be read back.' : 'No key is configured.'}</small></label>
      {selected?.value.keyConfigured && <label className="check-line"><input type="checkbox" checked={clearKey} disabled={busy} onChange={event => { setClearKey(event.target.checked); setSecret(''); }} />Clear saved API key</label>}
      <div className="form-actions"><button className="primary-button" disabled={busy || !draft.label || !draft.provider || !draft.baseUrl} onClick={() => void save()}>{busy ? 'Saving…' : 'Save connection'}</button>
        {selected && <button className="danger-button" disabled={busy} onClick={() => void remove()}>Delete</button>}</div>
      {selected && <section className="provider-models"><div className="provider-models-head"><h4>Selectable models <span>{choices.length}</span></h4><button type="button" className="secondary-button" disabled={busy} onClick={() => void discover()}>Refresh from endpoint</button></div>
        <input aria-label="Search available models" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search model names" />
        <div className="provider-model-list">{choices.filter(item => `${item.label} ${item.modelId}`.toLowerCase().includes(search.toLowerCase())).map(item => <div key={item.modelId} className="provider-model-row"><strong>{item.label}</strong><small>{item.modelId} · {item.verified ? 'Pi verified' : 'Unverified'} · Context {item.contextWindow.toLocaleString()} · Output {item.maxTokens.toLocaleString()} · Reasoning {item.reasoning ? 'yes' : 'no'}</small></div>)}
          {!choices.length && <p className="form-hint">No models listed. Refresh from the endpoint to discover models.</p>}</div>
        <p className="form-hint">Pi lists known model definitions; endpoint refresh lists advertised models. Access is confirmed when a model call succeeds.</p></section>}
    </div></div>;
}

function PromptsTab({ api, records, reload }: { api: ConfigClient; records: ConfigRecord<PromptOption>[]; reload: Reload }) {
  const [selectedId, setSelectedId] = useState(''); const [revision, setRevision] = useState<number | null>(null);
  const [label, setLabel] = useState(''); const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const selected = records.find(item => item.id === selectedId);
  function select(id: string) { const record = records.find(item => item.id === id); setSelectedId(id); setRevision(record?.revision ?? null); setLabel(record?.value.label ?? ''); setContent(record?.value.text ?? ''); setError(null); }
  async function save() { if (selected && revision !== selected.revision) { setError('Prompt changed elsewhere. Review its latest version.'); return; } setBusy(true); setError(null);
    try { const value: PromptOption = { kind: 'prompt', label, text: content }; const saved = selected ? await api.updateCatalog(selected, value) : await api.createCatalog(newId('prompt'), value); await reload(); setSelectedId(saved.id); setRevision(saved.revision); }
    catch (cause) { setError(errorText(cause)); await reload(); } finally { setBusy(false); } }
  async function remove() { if (!selected || !window.confirm(`Delete prompt “${selected.value.label}”?`)) return; setBusy(true); try { await api.deleteCatalog(selected); await reload(); select(''); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }
  return <div className="catalog-layout"><ChoiceList title="prompt" items={records} selectedId={selectedId} select={select} /><div className="form-panel"><h3>{selected ? `Edit ${selected.value.label}` : 'New prompt template'}</h3>
    {error && <div className="form-error" role="alert">{error}<button onClick={() => select(selectedId)}>Review latest</button></div>}
    <label>Name <input value={label} disabled={busy} onChange={event => setLabel(event.target.value)} placeholder="Prompt name" /></label>
    <label>Prompt text <textarea rows={12} value={content} disabled={busy} onChange={event => setContent(event.target.value)} placeholder="Instructions an agent may include" /></label>
    <div className="form-actions"><button className="primary-button" disabled={busy || !label} onClick={() => void save()}>Save prompt</button>{selected && <button className="danger-button" disabled={busy} onClick={() => void remove()}>Delete</button>}</div>
  </div></div>;
}

function ToolsTab({ api, records, capabilities, reload }: { api: ConfigClient; records: ConfigRecord<ToolOption>[]; capabilities: Capabilities; reload: Reload }) {
  const [selectedId, setSelectedId] = useState(''); const [revision, setRevision] = useState<number | null>(null);
  const [label, setLabel] = useState(''); const [toolName, setToolName] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const selected = records.find(item => item.id === selectedId);
  function select(id: string) { const record = records.find(item => item.id === id); setSelectedId(id); setRevision(record?.revision ?? null); setLabel(record?.value.label ?? ''); setToolName(record?.value.toolName ?? ''); setError(null); }
  async function save() { if (selected && revision !== selected.revision) { setError('Tool option changed elsewhere. Review its latest version.'); return; } setBusy(true); setError(null);
    try { const value: ToolOption = { kind: 'tool', label, toolName }; const saved = selected ? await api.updateCatalog(selected, value) : await api.createCatalog(newId('tool'), value); await reload(); setSelectedId(saved.id); setRevision(saved.revision); }
    catch (cause) { setError(errorText(cause)); await reload(); } finally { setBusy(false); } }
  async function remove() { if (!selected || !window.confirm(`Delete tool option “${selected.value.label}”?`)) return; setBusy(true); try { await api.deleteCatalog(selected); await reload(); select(''); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }
  return <div className="catalog-layout"><ChoiceList title="tool option" items={records} selectedId={selectedId} select={select} /><div className="form-panel"><h3>{selected ? `Edit ${selected.value.label}` : 'Expose a registered tool'}</h3>
    {error && <div className="form-error" role="alert">{error}<button onClick={() => select(selectedId)}>Review latest</button></div>}
    <label>Name <input value={label} disabled={busy} onChange={event => setLabel(event.target.value)} placeholder="Name shown to agents" /></label>
    <label>Registered handler <select value={toolName} disabled={busy} onChange={event => setToolName(event.target.value)}><option value="">Choose a backend tool</option>{capabilities.tools.map(tool => <option key={tool.name} value={tool.name}>{tool.name} · {tool.description}</option>)}</select></label>
    {capabilities.tools.length === 0 && <p className="form-hint">This backend has no registered tool handlers yet.</p>}
    <div className="form-actions"><button className="primary-button" disabled={busy || !label || !toolName} onClick={() => void save()}>Save tool option</button>{selected && <button className="danger-button" disabled={busy} onClick={() => void remove()}>Delete</button>}</div>
  </div></div>;
}

export function CatalogPage({ api }: { api: ConfigClient }) {
  const [tab, setTab] = useState<'models' | 'prompts' | 'tools'>('models');
  const [records, setRecords] = useState<ConfigRecord<CatalogOption>[]>([]);
  const [connections, setConnections] = useState<ConfigRecord<ConnectionView>[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({ models: [], tools: [] });
  const [error, setError] = useState<string | null>(null);
  async function load() {
    try { const [catalog, links, available] = await Promise.all([api.listCatalog(), api.listConnections(), api.capabilities()]); setRecords(catalog); setConnections(links); setCapabilities(available); setError(null); }
    catch (cause) { setError(errorText(cause)); }
  }
  useEffect(() => { void load(); const focus = () => void load(); window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, [api]);
  const prompts = records.filter((record): record is ConfigRecord<PromptOption> => record.value.kind === 'prompt');
  const tools = records.filter((record): record is ConfigRecord<ToolOption> => record.value.kind === 'tool');
  return <div className="config-page"><Header />
    <div className="catalog-tabs" role="tablist" aria-label="Catalog type">
      <button role="tab" aria-selected={tab === 'models'} className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>Models <span>{connections.length}</span></button>
      <button role="tab" aria-selected={tab === 'prompts'} className={tab === 'prompts' ? 'active' : ''} onClick={() => setTab('prompts')}>Prompts <span>{prompts.length}</span></button>
      <button role="tab" aria-selected={tab === 'tools'} className={tab === 'tools' ? 'active' : ''} onClick={() => setTab('tools')}>Tools <span>{tools.length}</span></button>
      <button className="catalog-refresh" onClick={() => void load()}>Refresh</button>
    </div>
    {error && <div className="form-error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>}
    {tab === 'models' && <ConnectionsTab api={api} records={connections} capabilities={capabilities} reload={load} />}
    {tab === 'prompts' && <PromptsTab api={api} records={prompts} reload={load} />}
    {tab === 'tools' && <ToolsTab api={api} records={tools} capabilities={capabilities} reload={load} />}
  </div>;
}
