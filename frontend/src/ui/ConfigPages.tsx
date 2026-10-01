import { useEffect, useRef, useState } from 'react';
import { ConfigClient, type AgentConfig, type AgentSettings, type AppSettings, type CallOptions, type CatalogOption, type ConfigRecord, type ConnectionView, type ModelChoice, type ReasoningLevel } from '../client/config-client.js';
import { useAgentConfig } from './useAgentConfig.js';

const message = (error: unknown) => error instanceof Error ? error.message : 'Request failed';

function PanelHeader({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <header className="panel-head"><div className="eyebrow">{eyebrow}</div><h2>{title}</h2><p>{detail}</p></header>;
}

export function AgentsIndex({ api, openAgent, openCatalog }: { api: ConfigClient; openAgent: (id: string) => void; openCatalog: () => void }) {
  const [agents, setAgents] = useState<Awaited<ReturnType<ConfigClient['listAgents']>>>([]);
  const [error, setError] = useState<string | null>(null);
  async function load() { try { setAgents(await api.listAgents()); setError(null); } catch (cause) { setError(message(cause)); } }
  useEffect(() => { void load(); const focus = () => void load(); window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, [api]);
  return <div className="config-page"><PanelHeader eyebrow="AGENTS" title="Agents" detail="Choose an agent or manage the options available to all agents." />
    {error && <div className="form-error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>}
    <div className="page-toolbar"><button className="secondary-button" onClick={openCatalog}>Global agent catalog →</button><button className="secondary-button" onClick={() => void load()}>Refresh</button></div>
    <div className="agent-grid">{agents.map(agent => <button className="agent-card" key={agent.agentId} onClick={() => openAgent(agent.agentId)}>
      <span className="agent-card-mark">✳</span><strong>{agent.name || 'Untitled agent'}</strong><small>{agent.agentId}</small>
      <span className={`readiness ${agent.ready ? 'ready' : ''}`}>{agent.ready ? 'Ready to run' : agent.issues.join(' · ')}</span>
    </button>)}</div>
    {agents.length === 0 && !error && <div className="empty-panel">No agents yet. Create one from the sidebar, then choose its model.</div>}
  </div>;
}

export function AppSettingsPage({ api, onTitle }: { api: ConfigClient; onTitle: (title: string) => void }) {
  const [record, setRecord] = useState<ConfigRecord<AppSettings> | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [formRevision, setFormRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recordRef = useRef(record);
  const draftRef = useRef(draft);
  const busyRef = useRef(false);
  recordRef.current = record; draftRef.current = draft;
  async function load() {
    try {
      const next = await api.getApp();
      const clean = !draftRef.current || !recordRef.current || JSON.stringify(draftRef.current) === JSON.stringify(recordRef.current.value);
      setRecord(next);
      if (clean) { setDraft(next.value); setFormRevision(next.revision); }
      setError(null);
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); const focus = () => { if (!busyRef.current) void load(); }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, [api]);
  async function save() {
    if (!record || !draft) return;
    if (formRevision !== record.revision) { setError('App settings changed elsewhere. Review the latest values before saving.'); return; }
    busyRef.current = true; setBusy(true); setError(null); setNotice(null);
    try { const saved = await api.updateApp(record, draft); setRecord(saved); setDraft(saved.value); setFormRevision(saved.revision); onTitle(saved.value.title); setNotice('App settings saved.'); }
    catch (cause) { setError(message(cause)); if (cause instanceof Error && 'status' in cause && cause.status === 409) await load(); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <div className="config-page"><PanelHeader eyebrow="APP SETTINGS" title="Application settings" detail="Product-wide display and API settings shared by all agents." />
    <div className="form-panel narrow">{error && <div className="form-error" role="alert">{error}<button onClick={() => { if (record) { setDraft(record.value); setFormRevision(record.revision); setError(null); } else void load(); }}>Review latest</button></div>}{notice && <div className="form-notice" role="status">{notice}</div>}
      {!draft ? <p>Loading settings…</p> : <><label>Application title <input value={draft.title} disabled={busy} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>Maximum input size (bytes) <input type="number" min={1024} max={2097152} value={draft.maxInputBytes} disabled={busy} onChange={event => setDraft({ ...draft, maxInputBytes: Number(event.target.value) })} /></label>
        <label className="check-line"><input type="checkbox" checked={draft.allowAgentCreation} disabled={busy} onChange={event => setDraft({ ...draft, allowAgentCreation: event.target.checked })} />Allow agent creation</label>
        {record && formRevision !== record.revision && <div className="form-error" role="alert">A newer revision is available. <button onClick={() => { setDraft(record.value); setFormRevision(record.revision); setError(null); }}>Review latest</button></div>}
        <div className="form-actions"><button className="primary-button" disabled={busy || !record || formRevision !== record.revision} onClick={() => void save()}>{busy ? 'Saving…' : 'Save settings'}</button></div>
        <p className="form-hint">Database and encryption settings are configured at deployment. Provider connections are managed in the Agents catalog.</p></>}
    </div>
  </div>;
}

export type AgentConfigControl = ReturnType<typeof useAgentConfig>;

function optionIssues(value: AgentSettings, connections: ConfigRecord<ConnectionView>[], choices: ModelChoice[]): string[] {
  if (!value.connectionId || !value.modelId) return ['Select a provider and model'];
  if (!connections.some(item => item.id === value.connectionId)) return ['Selected provider is unavailable'];
  const model = choices.find(item => item.modelId === value.modelId);
  if (!model) return ['Selected model is unavailable'];
  const issues: string[] = [];
  if (value.callOptions.reasoning && !model.reasoningLevels.includes(value.callOptions.reasoning)) issues.push('Choose a supported reasoning level');
  if (value.callOptions.maxTokens !== undefined && value.callOptions.maxTokens > model.maxTokens) issues.push('Maximum output exceeds the model limit');
  if (value.callOptions.contextBudget !== undefined && value.callOptions.contextBudget > model.contextWindow) issues.push('Context budget exceeds the model context window');
  return issues;
}

function useModelChoices(api: ConfigClient, connectionId: string | null) {
  const [choices, setChoices] = useState<ModelChoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!connectionId) { setChoices([]); setError(null); return; }
    let active = true;
    setChoices([]);
    void api.modelChoices(connectionId).then(items => { if (active) { setChoices(items); setError(null); } }).catch(cause => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [api, connectionId]);
  return { choices, error, refresh: async () => { if (connectionId) { const items = await api.modelChoices(connectionId); setChoices(items); setError(null); } } };
}

export function AgentConfigPage({ control, api }: { control: AgentConfigControl; api: ConfigClient }) {
  const [catalog, setCatalog] = useState<ConfigRecord<CatalogOption>[]>([]);
  const [connections, setConnections] = useState<ConfigRecord<ConnectionView>[]>([]);
  const [draft, setDraft] = useState<AgentSettings | null>(null);
  const [formRevision, setFormRevision] = useState<number | null>(null);
  const lastSaved = useRef<AgentConfig | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const models = useModelChoices(api, draft?.connectionId ?? null);
  useEffect(() => {
    if (!control.record) return;
    const previousSaved = lastSaved.current;
    lastSaved.current = control.record;
    if (!draft || !previousSaved || JSON.stringify(draft) === JSON.stringify(previousSaved.value) || JSON.stringify(draft) === JSON.stringify(control.record.value)) {
      setFormRevision(control.record.revision);
      setDraft(structuredClone(control.record.value));
    }
  }, [control.record]);
  async function load() { try { const [options, providers] = await Promise.all([api.listCatalog(), api.listConnections()]); setCatalog(options); setConnections(providers); setLoadError(null); await control.refresh(); } catch (cause) { setLoadError(message(cause)); } }
  useEffect(() => { void load(); const focus = () => void load(); window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, [api, control.refresh]);
  async function save() { if (!draft || !control.record || formRevision !== control.record.revision) return; setNotice(null); const saved = await control.save(draft); if (saved) { lastSaved.current = saved; setDraft(structuredClone(saved.value)); setFormRevision(saved.revision); setNotice('Saved. These settings apply when the next run starts.'); } }
  const choice = models.choices.find(item => item.modelId === draft?.modelId);
  const issues = draft && models.choices.length ? optionIssues(draft, connections, models.choices) : [];
  return <div className="config-page"><PanelHeader eyebrow="AGENT / CONFIGURATION" title={control.record?.value.name || 'Agent configuration'} detail="Select a provider and model, then set this agent's instructions and call options." />
    <div className="form-panel narrow">{(loadError || models.error || (formRevision === control.record?.revision && control.error)) && <div className="form-error" role="alert">{loadError || models.error || control.error}<button onClick={() => void load()}>Refresh</button></div>}
      {notice && <div className="form-notice" role="status">{notice}</div>}
      {control.record && formRevision !== null && formRevision !== control.record.revision && <div className="form-error" role="alert">This config changed elsewhere. <button onClick={() => { setDraft(structuredClone(control.record!.value)); setFormRevision(control.record!.revision); control.clearError(); }}>Review latest</button></div>}
      {!draft ? <>{control.loading ? <p>Loading agent settings…</p> : <><p>Agent settings are missing.</p><button className="primary-button" disabled={control.saving} onClick={() => void control.initialize()}>Create agent config</button></>}</> : <>
        <label>Agent name <input value={draft.name} disabled={control.saving} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="Untitled agent" /></label>
        <label>Provider <select value={draft.connectionId ?? ''} disabled={control.saving} onChange={event => setDraft({ ...draft, connectionId: event.target.value || null, modelId: null })}>
          <option value="">Select a provider</option>{connections.map(item => <option value={item.id} key={item.id}>{item.value.label} · {item.value.provider}</option>)}
        </select></label>
        <label>Model <select value={draft.modelId ?? ''} disabled={control.saving || !draft.connectionId} onChange={event => setDraft({ ...draft, modelId: event.target.value || null })}>
          <option value="">Select a model</option>{models.choices.map(item => <option value={item.modelId} key={item.modelId}>{item.label}{item.verified ? '' : ' · unverified'}</option>)}
        </select></label>
        {choice && <p className="form-hint">Context window {choice.contextWindow.toLocaleString()} · Maximum output {choice.maxTokens.toLocaleString()} · {choice.verified ? 'Pi model metadata' : 'Conservative, unverified metadata'}</p>}
        {catalog.some(item => item.value.kind === 'tool') && <div className="field-group"><span>Tools</span><div className="check-grid">{catalog.filter(item => item.value.kind === 'tool').map(item => <label className="check-line" key={item.id}><input type="checkbox" checked={draft.toolOptionIds.includes(item.id)} disabled={control.saving} onChange={event => setDraft({ ...draft, toolOptionIds: event.target.checked ? [...draft.toolOptionIds, item.id] : draft.toolOptionIds.filter(id => id !== item.id) })} />{item.value.label}</label>)}</div></div>}
        {catalog.some(item => item.value.kind === 'prompt') && <div className="field-group"><span>Prompt templates</span><div className="check-grid">{catalog.filter(item => item.value.kind === 'prompt').map(item => <label className="check-line" key={item.id}><input type="checkbox" checked={draft.promptOptionIds.includes(item.id)} disabled={control.saving} onChange={event => setDraft({ ...draft, promptOptionIds: event.target.checked ? [...draft.promptOptionIds, item.id] : draft.promptOptionIds.filter(id => id !== item.id) })} />{item.value.label}</label>)}</div></div>}
        <label>Agent instructions <textarea rows={8} value={draft.prompt} disabled={control.saving} onChange={event => setDraft({ ...draft, prompt: event.target.value })} placeholder="Instructions for this agent" /></label>
        <ModelCallFields value={draft.callOptions} model={choice} disabled={control.saving} change={callOptions => setDraft({ ...draft, callOptions })} />
        {issues.length > 0 && <div className="form-error" role="alert">{issues.join(' · ')}</div>}
        {control.record?.issues.length ? <p className="form-hint">Current saved config: {control.record.issues.join(' · ')}</p> : null}
        <div className="form-actions"><button className="primary-button" disabled={control.saving || !!control.error || formRevision !== control.record?.revision} onClick={() => void save()}>{control.saving ? 'Saving…' : 'Save agent config'}</button></div>
        <p className="form-hint">Changes do not alter an active run. Revision {control.record?.revision ?? '—'}.</p>
      </>}
    </div>
  </div>;
}

function ModelCallFields({ value, model, disabled, change, showReasoning = true }: { value: CallOptions; model?: ModelChoice; disabled: boolean; change: (value: CallOptions) => void; showReasoning?: boolean }) {
  return <div className="model-fields"><h4>Model call options</h4>
    {showReasoning && <label>Reasoning <select value={value.reasoning ?? ''} disabled={disabled || !model} onChange={event => change({ ...value, reasoning: event.target.value ? event.target.value as ReasoningLevel : undefined })}>
      <option value="">Provider default</option>{value.reasoning && !model?.reasoningLevels.includes(value.reasoning) && <option value={value.reasoning} disabled>{value.reasoning} · unavailable</option>}{model?.reasoningLevels.map(level => <option key={level} value={level}>{level}</option>)}
    </select></label>}
    <label>Temperature <input type="number" min={0} max={2} step={0.1} placeholder="Provider default" value={value.temperature ?? ''} disabled={disabled || !model} onChange={event => change({ ...value, temperature: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
    <label>Maximum output tokens <input type="number" min={1} max={model?.maxTokens} placeholder="Model default" value={value.maxTokens ?? ''} disabled={disabled || !model} onChange={event => change({ ...value, maxTokens: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
    <label>Context budget <input type="number" min={1} max={model?.contextWindow} placeholder="Model context window" value={value.contextBudget ?? ''} disabled={disabled || !model} onChange={event => change({ ...value, contextBudget: event.target.value === '' ? undefined : Number(event.target.value) })} /><small>Saved for context management. Automatic compaction is not available yet.</small></label>
  </div>;
}

/** Compact controls live inside the composer, but edit the same persisted agent record. */
export function ComposerSettings({ control, api, active, onGateChange }: { control: AgentConfigControl; api: ConfigClient; active: boolean; onGateChange: (ready: boolean) => void }) {
  const [connections, setConnections] = useState<ConfigRecord<ConnectionView>[]>([]);
  const [draft, setDraft] = useState<AgentSettings | null>(null);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const lastSaved = useRef<AgentConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const models = useModelChoices(api, draft?.connectionId ?? control.record?.value.connectionId ?? null);
  useEffect(() => {
    if (!control.record) return;
    const previousSaved = lastSaved.current;
    lastSaved.current = control.record;
    if (!draft || !previousSaved || JSON.stringify(draft) === JSON.stringify(previousSaved.value) || JSON.stringify(draft) === JSON.stringify(control.record.value)) {
      setDraftRevision(control.record.revision);
      setDraft(structuredClone(control.record.value));
    }
  }, [control.record]);
  useEffect(() => { onGateChange(!error && !control.error && !!control.record && !!draft && JSON.stringify(draft) === JSON.stringify(control.record.value)); }, [draft, control.record, control.error, error, onGateChange]);
  async function refreshChoices() { try { setConnections(await api.listConnections()); await control.refresh(); await models.refresh(); setError(null); } catch (cause) { setError(message(cause)); } }
  useEffect(() => { void refreshChoices(); }, [api, control.refresh]);
  async function apply(next: AgentSettings) {
    setDraft(next);
    const issues = optionIssues(next, connections, models.choices);
    if (issues.length) { setError(issues.join(' · ')); return; }
    if (draftRevision !== control.record?.revision) { setError('This config changed elsewhere. Discard the draft to review the latest version.'); return; }
    setError(null);
    const saved = await control.save(next);
    if (saved) { lastSaved.current = saved; setDraft(structuredClone(saved.value)); setDraftRevision(saved.revision); setAdvanced(false); setOpen(false); }
  }
  const current = draft ?? control.record?.value;
  const model = models.choices.find(item => item.modelId === current?.modelId);
  const modelLabel = model?.label ?? (current?.modelId ? 'Unavailable model' : 'Choose model');
  return <div className="composer-config">
    <button type="button" className="model-trigger" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void refreshChoices(); }} disabled={control.loading}>{modelLabel}<span>{current?.callOptions.reasoning ?? 'default'}</span>⌄</button>
    {open && <div className="model-popover"><div className="popover-title">Model for this agent</div>
      <label>Provider <select value={current?.connectionId ?? ''} disabled={control.saving} onChange={event => { if (current) { setDraft({ ...current, connectionId: event.target.value || null, modelId: null }); setError('Select a model'); } }}>
        <option value="">Select a provider</option>{connections.map(item => <option key={item.id} value={item.id}>{item.value.label} · {item.value.provider}</option>)}
      </select></label>
      <div className="model-list">{models.choices.map(item => <button type="button" key={item.modelId} className={current?.modelId === item.modelId ? 'selected' : ''} disabled={control.saving} onClick={() => { if (current) void apply({ ...current, modelId: item.modelId }); }}>
        {item.label}{!item.verified && ' · unverified'}{current?.modelId === item.modelId && <span>✓</span>}
      </button>)}{!models.choices.length && <p>No models available for this provider yet.</p>}</div>
      {current && <label className="popover-reasoning">Reasoning <select value={current.callOptions.reasoning ?? ''} disabled={control.saving || !model} onChange={event => void apply({ ...current, callOptions: { ...current.callOptions, reasoning: event.target.value ? event.target.value as ReasoningLevel : undefined } })}>
        <option value="">Provider default</option>{current.callOptions.reasoning && !model?.reasoningLevels.includes(current.callOptions.reasoning) && <option value={current.callOptions.reasoning} disabled>{current.callOptions.reasoning} · unavailable</option>}{model?.reasoningLevels.map(level => <option key={level} value={level}>{level}</option>)}
      </select></label>}
      <button type="button" className="popover-advanced" onClick={() => setAdvanced(!advanced)}>Call options {advanced ? '▴' : '▾'}</button>
      {advanced && current && <><ModelCallFields value={current.callOptions} model={model} disabled={control.saving} showReasoning={false} change={callOptions => setDraft({ ...current, callOptions })} />
        <button type="button" className="primary-button" disabled={control.saving || !current.modelId} onClick={() => void apply(current)}>Apply options</button></>}
      {(error || models.error || control.error) && <div className="form-error" role="alert">{error || models.error || control.error}</div>}
      {current && control.record && JSON.stringify(current) !== JSON.stringify(control.record.value) && <button type="button" className="popover-advanced" onClick={() => { setDraft(structuredClone(control.record!.value)); setDraftRevision(control.record!.revision); setError(null); control.clearError(); }}>Discard unsaved changes</button>}
      {active && <p className="form-hint">Saved changes apply to the next run.</p>}
    </div>}
  </div>;
}
