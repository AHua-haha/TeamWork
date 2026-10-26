import { useEffect, useRef, useState } from 'react';
import type { Capabilities, ConfigClient, ConfigRecord, ConnectionInput, ConnectionView, ModelChoice } from '../../shared/backend-client/index.js';

type ConnectionRecord = ConfigRecord<ConnectionView>;
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Request failed';
const blank: ConnectionInput = { label: '', provider: '', baseUrl: '', api: 'openai-completions' };

function ProviderCard({ api, record, focused, edit, remove }: {
  api: ConfigClient; record: ConnectionRecord; focused: boolean;
  edit: (record: ConnectionRecord) => void; remove: (record: ConnectionRecord) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void api.modelChoices(record.id).then(items => { if (live) { setModels(items); setError(null); } })
      .catch(cause => { if (live) setError(errorText(cause)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, record.id, record.revision]);

  useEffect(() => {
    if (!focused) return;
    setExpanded(true);
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focused]);

  async function refreshModels() {
    setLoading(true); setError(null); setExpanded(true);
    try { setModels(await api.modelChoices(record.id, true)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setLoading(false); }
  }

  return <article className={`provider-card ${focused ? 'provider-card-focused' : ''}`} id={`provider-${record.id}`} ref={ref}>
    <div className="provider-card-top">
      <div className="provider-identity"><span className="provider-monogram" aria-hidden="true">{record.value.label.slice(0, 1).toUpperCase()}</span>
        <div><h3>{record.value.label}</h3><p>{record.value.provider}</p></div></div>
      <div className="provider-card-actions">
        <button type="button" className="text-button" onClick={() => edit(record)}>Edit</button>
        <button type="button" className="text-button" onClick={() => void refreshModels()} disabled={loading}>Refresh models</button>
        <button type="button" className="text-button danger-text" onClick={() => remove(record)}>Delete</button>
      </div>
    </div>
    <div className="provider-details">
      <div><span>Protocol</span><strong>{record.value.api === 'anthropic-messages' ? 'Anthropic Messages' : record.value.api === 'openai-responses' ? 'OpenAI Responses' : 'OpenAI Chat Completions'}</strong></div>
      <div><span>Endpoint</span><strong title={record.value.baseUrl}>{record.value.baseUrl}</strong></div>
      <div><span>API key</span><strong>{record.value.keyConfigured ? 'Configured' : 'Not configured'}</strong></div>
      <div><span>Models</span><strong>{loading ? 'Loading…' : error ? 'Unavailable' : `${models.length} listed`}</strong></div>
    </div>
    <button type="button" className="provider-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? 'Hide models' : 'View models'} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
    </button>
    {expanded && <div className="provider-card-models">
      {error && <div className="form-error" role="alert">{error}<button type="button" onClick={() => void refreshModels()}>Retry</button></div>}
      {!error && models.length > 0 && <div className="provider-model-grid">{models.map(model => <div className="provider-model-item" key={model.modelId}>
        <strong>{model.label}</strong><small>{model.modelId}</small><span>{model.source === 'pi' ? 'Pi model' : 'Endpoint model'} · {model.verified ? 'Verified metadata' : 'Unverified metadata'}</span>
        <span>Context {model.contextWindow.toLocaleString()} · Output {model.maxTokens.toLocaleString()} · Reasoning {model.reasoning ? 'available' : 'none'}</span>
      </div>)}</div>}
      {!loading && !error && models.length === 0 && <p className="form-hint">No models listed. Refresh from the endpoint to discover available models.</p>}
      <p className="form-hint">A listed model is a choice for agents. Credential access is confirmed when a model call succeeds.</p>
    </div>}
  </article>;
}

export function ProvidersPage({ api, records, loading, loadError, refresh, focusId, clearFocus }: {
  api: ConfigClient; records: ConnectionRecord[]; loading: boolean; loadError: string | null;
  refresh: () => Promise<void>; focusId: string | null; clearFocus: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [editing, setEditing] = useState<ConnectionRecord | null | undefined>(undefined);
  const [draft, setDraft] = useState<ConnectionInput>(blank);
  const [secret, setSecret] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => { void api.capabilities().then(setCapabilities).catch(() => setCapabilities(null)); }, [api]);
  useEffect(() => {
    if (editing === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setEditing(undefined);
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, busy]);

  function openEditor(record: ConnectionRecord | null) {
    setEditing(record);
    setDraft(record ? { label: record.value.label, provider: record.value.provider, baseUrl: record.value.baseUrl, api: record.value.api } : { ...blank });
    setSecret(''); setClearKey(false); setFormError(null);
  }

  function changeProvider(provider: string) {
    const known = capabilities?.models.find(model => model.provider === provider);
    const old = capabilities?.models.find(model => model.provider === draft.provider);
    setDraft({ ...draft, provider,
      baseUrl: known?.baseUrl && (!draft.baseUrl || draft.baseUrl === old?.baseUrl) ? known.baseUrl : draft.baseUrl,
      api: known?.api === 'anthropic-messages' || known?.api === 'openai-responses' || known?.api === 'openai-completions' ? known.api : draft.api,
    });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing === undefined) return;
    setBusy(true); setFormError(null); setNotice(null);
    try {
      const value: ConnectionInput = { ...draft, ...(clearKey ? { apiKey: null } : secret ? { apiKey: secret } : {}) };
      const saved = editing ? await api.updateConnection(editing, value) : await api.createConnection(`connection-${crypto.randomUUID()}`, value);
      setEditing(undefined); setSecret('');
      await refresh();
      if (!capabilities?.models.some(model => model.provider === saved.value.provider)) {
        try { await api.modelChoices(saved.id, true); await refresh(); }
        catch (cause) { setNotice(`Provider saved. Model discovery failed: ${errorText(cause)}`); }
      } else setNotice('Provider saved. Pi models are available.');
    } catch (cause) {
      setFormError(errorText(cause));
      await refresh();
    } finally { setBusy(false); }
  }

  async function remove(record: ConnectionRecord) {
    if (!window.confirm(`Delete “${record.value.label}”? Agents using it will need another model before their next run.`)) return;
    setBusy(true); setNotice(null); setActionError(null);
    try { await api.deleteConnection(record); await refresh(); clearFocus(); setNotice('Provider deleted.'); }
    catch (cause) { setActionError(`Could not delete provider: ${errorText(cause)}`); await refresh(); }
    finally { setBusy(false); }
  }

  const providers = [...new Set(capabilities?.models.map(model => model.provider) ?? [])].sort();

  return <div className="providers-page">
    <div className="providers-content">
      <header className="providers-header"><div><div className="eyebrow">CONFIG / PROVIDERS</div><h1>Providers</h1><p>Connections make models available to your conversations.</p></div>
        <button type="button" className="primary-button" onClick={() => openEditor(null)}>＋ Add provider</button></header>
      {notice && <div className="form-notice" role="status">{notice}</div>}
      {actionError && <div className="form-error" role="alert">{actionError}<button type="button" onClick={() => setActionError(null)}>Dismiss</button></div>}
      {loadError && <div className="form-error" role="alert">{loadError}<button type="button" onClick={() => void refresh()}>Retry</button></div>}
      {loading && !records.length && <div className="empty-panel">Loading providers…</div>}
      {!loading && !loadError && !records.length && <div className="empty-panel"><strong>No providers configured</strong><p>Add a provider connection to make its models available in the composer.</p><button type="button" className="primary-button" onClick={() => openEditor(null)}>Add provider</button></div>}
      <div className="provider-card-list">{records.map(record => <ProviderCard key={record.id} api={api} record={record} focused={focusId === record.id} edit={openEditor} remove={record => void remove(record)} />)}</div>
    </div>
    {editing !== undefined && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setEditing(undefined); }}>
      <div className="provider-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title" ref={dialogRef}>
        <div className="dialog-heading"><div><div className="eyebrow">PROVIDER CONNECTION</div><h2 id="provider-dialog-title">{editing ? 'Edit provider' : 'Add provider'}</h2></div>
          <button type="button" className="dialog-close" aria-label="Close dialog" disabled={busy} onClick={() => setEditing(undefined)}>×</button></div>
        <form onSubmit={event => void save(event)}>
          {formError && <div className="form-error" role="alert">{formError}{editing && <button type="button" onClick={() => { const latest = records.find(item => item.id === editing.id); if (latest) openEditor(latest); }}>Review latest</button>}</div>}
          <label>Connection name<input autoFocus required value={draft.label} disabled={busy} onChange={event => setDraft({ ...draft, label: event.target.value })} placeholder="DeepSeek production" /></label>
          <label>Provider<input list="provider-presets" required value={draft.provider} disabled={busy} onChange={event => changeProvider(event.target.value)} placeholder="Choose a Pi provider or enter a name" />
            <datalist id="provider-presets">{providers.map(provider => <option value={provider} key={provider} />)}</datalist></label>
          <label>Request protocol<select value={draft.api} disabled={busy} onChange={event => setDraft({ ...draft, api: event.target.value as ConnectionInput['api'] })}>
            <option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option>
          </select></label>
          <label>Endpoint URL<input type="url" required value={draft.baseUrl} disabled={busy} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} placeholder={draft.api === 'anthropic-messages' ? 'https://api.anthropic.com' : 'https://example.com/v1'} />
            <small>{draft.api === 'anthropic-messages' ? 'Use the provider root URL. Model discovery requests /v1/models.' : 'Use the API base URL for this protocol.'}</small></label>
          <label>API key<input type="password" autoComplete="new-password" value={secret} disabled={busy || clearKey} onChange={event => setSecret(event.target.value)} placeholder={editing?.value.keyConfigured ? 'Configured — enter a replacement' : 'Optional for keyless endpoints'} />
            <small>{editing?.value.keyConfigured ? 'A key is configured. Leave blank to keep it.' : 'No key is configured.'}</small></label>
          {editing?.value.keyConfigured && <label className="check-line"><input type="checkbox" checked={clearKey} disabled={busy} onChange={event => { setClearKey(event.target.checked); setSecret(''); }} />Clear the saved API key</label>}
          <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(undefined)}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add provider'}</button></div>
        </form>
      </div>
    </div>}
  </div>;
}
