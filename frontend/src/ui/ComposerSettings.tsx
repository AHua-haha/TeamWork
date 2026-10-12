import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AgentSettings, ConfigClient, ConfigRecord, ConnectionView, ModelChoice, ReasoningLevel, SentReasoningLevel } from '../client/config-client.js';
import { clampedTo, customizedCount, effectiveReasoning, misfits, modelKey, modelSettings, selectModel, selectedModel, withModelSettings, type ModelEntry, type ModelSettings } from './model-selection.js';
import type { SettingsControl } from './useAgentConfig.js';

export type AgentConfigControl = SettingsControl;
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Request failed';
const levelLabel = (level: SentReasoningLevel) => level === 'xhigh' ? 'XHigh' : level[0]!.toUpperCase() + level.slice(1);

export function ComposerSettings({ control, api, active, onGateChange }: {
  control: AgentConfigControl; api: ConfigClient; active: boolean; onGateChange: (ready: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [connections, setConnections] = useState<ConfigRecord<ConnectionView>[]>([]);
  const [entries, setEntries] = useState<ModelEntry[]>([]);
  const [loadingChoices, setLoadingChoices] = useState(true);
  const [choicesError, setChoicesError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sliderDraft, setSliderDraft] = useState<number | null>(null);
  const [moreDirty, setMoreDirty] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const saveInFlight = useRef(false);
  const current = control.record?.value ?? null;
  const selected = useMemo(() => selectedModel(entries, current), [entries, current]);
  const modelLabel = selected?.model.label ?? (current?.modelId ? (loadingChoices ? current.modelId : `Unavailable model · ${current.modelId}`) : 'Choose model');
  const values: ModelSettings = selected && current ? modelSettings(current, selected) : {};
  const misfit = selected ? misfits(selected.model, values) : {};
  const levels = selected?.model.reasoningLevels ?? [];
  const effective = selected ? effectiveReasoning(selected.model, values) : null;
  const savedIndex = effective ? levels.indexOf(effective) : -1;
  const sliderIndex = sliderDraft ?? Math.max(0, savedIndex);
  const displayedLevel = sliderDraft !== null ? levels[sliderDraft] : effective;
  const levelText = !selected ? '' : displayedLevel ? levelLabel(displayedLevel) : 'No reasoning';
  const sentAs = selected && displayedLevel ? clampedTo(selected.model, displayedLevel) : undefined;
  const isReady = !!control.record && control.record.issues.length === 0 && !control.loading && !control.saving && sliderDraft === null && !moreDirty && !saveError && !control.error;
  const showList = listExpanded || !selected;

  useEffect(() => onGateChange(isReady), [isReady, onGateChange]);
  useEffect(() => { setSliderDraft(null); }, [control.record?.revision]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) { setOpen(false); setSliderDraft(null); }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); setSliderDraft(null); }
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);

  const loadChoices = useCallback(async () => {
    setLoadingChoices(true);
    setChoicesError(null);
    try {
      const links = await api.listConnections();
      const results = await Promise.allSettled(links.map(link => api.modelChoices(link.id)));
      const next: ModelEntry[] = [];
      const failures: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          for (const model of result.value) next.push({ connection: links[index]!, model });
        } else failures.push(links[index]!.value.label);
      });
      setConnections(links);
      setEntries(next);
      if (failures.length) setChoicesError(`Could not load models from ${failures.join(', ')}. Refresh to try again.`);
    } catch (cause) { setChoicesError(errorText(cause)); }
    finally { setLoadingChoices(false); }
  }, [api]);

  useEffect(() => { void loadChoices(); }, [loadChoices]);

  async function save(next: AgentSettings, revision: number, collapseList = false): Promise<boolean> {
    if (saveInFlight.current) return false;
    saveInFlight.current = true;
    setSaveError(null);
    try {
      const saved = await control.save(next, revision);
      if (!saved) {
        setSaveError('The change was not saved. Review the latest agent settings and try again.');
        return false;
      }
      if (collapseList) {
        setListExpanded(false);
        setSearchOpen(false);
        setQuery('');
      }
      return true;
    } finally {
      setSliderDraft(null);
      saveInFlight.current = false;
    }
  }

  function chooseModel(entry: ModelEntry) {
    if (!control.record) return;
    if (entry.connection.id === current?.connectionId && entry.model.modelId === current.modelId) {
      setListExpanded(false); setSearchOpen(false); setQuery('');
      return;
    }
    void save(selectModel(control.record.value, entry), control.record.revision, true);
  }

  function saveModelSettings(next: ModelSettings): Promise<boolean> {
    if (!control.record || !selected) return Promise.resolve(false);
    return save(withModelSettings(control.record.value, selected, next), control.record.revision);
  }

  function commitReasoning(level: ReasoningLevel | undefined) {
    if (!control.record || !selected || saveInFlight.current) return;
    if (level === values.reasoning || (level === effective && !misfit.reasoning)) { setSliderDraft(null); return; }
    void saveModelSettings({ ...values, reasoning: level });
  }

  function toggleSearch() {
    const next = !searchOpen;
    setSearchOpen(next);
    if (next) setListExpanded(true);
    else setQuery('');
  }

  const grouped = connections.map(connection => ({
    connection,
    models: entries.filter(entry => entry.connection.id === connection.id && `${entry.model.label} ${entry.model.modelId} ${connection.value.label} ${connection.value.provider}`.toLowerCase().includes(query.toLowerCase().trim())),
  })).filter(group => group.models.length > 0);

  if (!control.record && !control.loading) {
    return <div className="composer-config"><button type="button" className="model-trigger" disabled={control.saving} onClick={() => void control.initialize()}>Set up conversation</button></div>;
  }

  return <div className="composer-config" ref={container}>
    <button type="button" className="model-trigger" aria-expanded={open} aria-label={`Model and reasoning: ${modelLabel}${levelText ? `, ${levelText}` : ''}`} onClick={() => {
      const next = !open;
      setOpen(next);
      setListExpanded(false);
      setSearchOpen(false);
      setQuery('');
      setSliderDraft(null);
      if (next) void loadChoices();
    }} disabled={control.loading}>
      <span className="model-trigger-name">{modelLabel}</span>{levelText && <span className="model-trigger-level">{levelText}</span>}<span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="model-popover" role="dialog" aria-label="Model and reasoning">
      <div className="popover-top">
        <button type="button" className={`popover-icon ${searchOpen ? 'active' : ''}`} aria-label={searchOpen ? 'Hide model search' : 'Search models'} aria-expanded={searchOpen} onClick={toggleSearch}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
        </button>
        <button type="button" className="popover-model-toggle" aria-expanded={showList} onClick={() => {
          if (!selected) return;
          setListExpanded(!listExpanded);
          if (listExpanded) { setSearchOpen(false); setQuery(''); }
        }}>
          {selected && <strong className={misfit.reasoning ? 'misfit' : undefined}>{levelText}</strong>}
          <span>{modelLabel} <span aria-hidden="true">{showList ? '⌃' : '›'}</span></span>
        </button>
        <button type="button" className="popover-icon" aria-label="Close model picker" onClick={() => { setOpen(false); setSliderDraft(null); }}>×</button>
      </div>
      {searchOpen && <input autoFocus className="model-search" aria-label="Search models" placeholder="Search all models" value={query} onChange={event => setQuery(event.target.value)} />}
      {showList && <div className="model-list">
        {grouped.map(group => <div className="model-group" key={group.connection.id}>
          <div className="model-group-title">{group.connection.value.label}<small>{group.connection.value.provider}</small></div>
          {group.models.map(entry => <button type="button" key={modelKey(entry)} className={selected && modelKey(selected) === modelKey(entry) ? 'selected' : ''} disabled={control.saving} onClick={() => chooseModel(entry)}>
            <span><strong>{entry.model.label}</strong>{!entry.model.verified && <small>Unverified</small>}</span>
            {selected && modelKey(selected) === modelKey(entry) && <span aria-label="Selected">✓</span>}
          </button>)}
        </div>)}
        {loadingChoices && <p className="popover-empty">Loading models…</p>}
        {!loadingChoices && !grouped.length && <p className="popover-empty">{connections.length ? 'No matching models.' : 'No providers configured yet.'}</p>}
      </div>}
      {selected && <div hidden={showList}>
        <div className="reasoning-control">
          {levels.length > 1 ? <ReasoningSlider levels={levels} index={sliderIndex} misfit={!!misfit.reasoning && sliderDraft === null}
            drafting={sliderDraft !== null} disabled={control.saving} sentAs={sentAs}
            valueText={displayedLevel ? `${levelLabel(displayedLevel)}${sentAs ? `, sent as ${levelLabel(sentAs)}` : ''}` : ''}
            onDraft={setSliderDraft} onCommit={index => commitReasoning(levels[Math.max(0, Math.min(index, levels.length - 1))])} />
            : <p className="reasoning-unavailable">This model has no reasoning.</p>}
          {misfit.reasoning && <div className="setting-misfit" role="alert">{misfit.reasoning}.
            <button type="button" disabled={control.saving} onClick={() => commitReasoning(undefined)}>Clear the saved level</button>.</div>}
        </div>
        <MoreSettings key={modelKey(selected)} model={selected.model} values={values} disabled={control.saving}
          onSave={saveModelSettings} onDirtyChange={setMoreDirty} />
      </div>}
      {(choicesError || saveError || control.error) && <div className="form-error" role="alert">{choicesError || saveError || control.error}
        <button type="button" onClick={() => { setSaveError(null); setSliderDraft(null); void control.refresh(); void loadChoices(); }}>Review latest</button></div>}
      {active && <p className="popover-note">Saved changes apply to the next run.</p>}
    </div>}
  </div>;
}

function ReasoningSlider({ levels, index, misfit, drafting, disabled, sentAs, valueText, onDraft, onCommit }: {
  levels: ReasoningLevel[]; index: number; misfit: boolean; drafting: boolean; disabled: boolean; sentAs?: SentReasoningLevel; valueText: string;
  onDraft: (index: number) => void; onCommit: (index: number) => void;
}) {
  const last = levels.length - 1;
  const dragging = useRef(false);
  return <>
    <div className={`pill-slider${misfit ? ' misfit' : ''}`} style={{ '--frac': index / last } as CSSProperties}>
      <div className="pill-track" aria-hidden="true">
        <div className="pill-fill" />
        {levels.map((level, stop) => stop > index && <span key={level} className="pill-stop" style={{ '--at': stop / last } as CSSProperties} />)}
        <div className="pill-thumb" />
      </div>
      <input type="range" min={0} max={last} step={1} value={index} aria-label="Reasoning level"
        aria-valuetext={misfit ? 'Unsupported level; choose a level' : valueText} disabled={disabled}
        onPointerDown={() => { dragging.current = true; }}
        onChange={event => onDraft(Number(event.currentTarget.value))}
        onPointerUp={event => { dragging.current = false; onCommit(Number(event.currentTarget.value)); }}
        onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) onCommit(Number(event.currentTarget.value)); }}
        onBlur={event => { if (drafting && !dragging.current) onCommit(Number(event.currentTarget.value)); }} />
    </div>
    <div className="reasoning-scale"><span>{levelLabel(levels[0]!)}</span>
      {sentAs && <span className="reasoning-sent" title="This model does not support the chosen level, so the nearest supported level is sent">Sent as {levelLabel(sentAs)}</span>}
      <span>{levelLabel(levels[last]!)}</span></div>
  </>;
}

type Field = 'maxTokens' | 'temperature' | 'contextBudget';
type Draft = Record<Field, string>;
const fields: Field[] = ['maxTokens', 'temperature', 'contextBudget'];
const textOf = (values: ModelSettings): Draft => ({
  maxTokens: values.maxTokens?.toString() ?? '', temperature: values.temperature?.toString() ?? '', contextBudget: values.contextBudget?.toString() ?? '',
});

function parseDraft(draft: Draft, model: ModelChoice): { values: Pick<ModelSettings, Field>; errors: Partial<Record<Field, string>> } {
  const values: Pick<ModelSettings, Field> = {};
  const errors: Partial<Record<Field, string>> = {};
  const integer = (field: 'maxTokens' | 'contextBudget', limit: number, limitName: string) => {
    const text = draft[field].trim();
    if (!text) return;
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < 1) errors[field] = 'Enter a whole number above 0';
    else if (value > limit) errors[field] = `Exceeds this model's ${limit.toLocaleString()} ${limitName}`;
    else values[field] = value;
  };
  integer('maxTokens', model.maxTokens, 'output limit');
  integer('contextBudget', model.contextWindow, 'context window');
  const temperature = draft.temperature.trim();
  if (temperature) {
    const value = Number(temperature);
    if (!Number.isFinite(value) || value < 0 || value > 2) errors.temperature = 'Enter a number from 0 to 2';
    else values.temperature = value;
  }
  return { values, errors };
}

function MoreSettings({ model, values, disabled, onSave, onDirtyChange }: {
  model: ModelChoice; values: ModelSettings; disabled: boolean;
  onSave: (values: ModelSettings) => Promise<boolean>; onDirtyChange: (dirty: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => textOf(values));
  const saved = textOf(values);
  const dirty = fields.some(field => draft[field] !== saved[field]);
  const { values: parsed, errors } = parseDraft(draft, model);
  const savedMisfit = misfits(model, values);
  const attention = !!(savedMisfit.maxTokens || savedMisfit.contextBudget || savedMisfit.temperature);
  const count = customizedCount(values);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function apply() {
    const next = { ...values, ...parsed };
    for (const field of fields) if (parsed[field] === undefined) delete next[field];
    if (await onSave(next)) setDraft(textOf(next));
  }

  const field = (key: Field, label: string, hint: string, inputMode: 'numeric' | 'decimal') => <div className="setting-field">
    <label htmlFor={`setting-${key}`}>{label}</label>
    <div className={`setting-input${errors[key] ? ' invalid' : ''}`}>
      <input id={`setting-${key}`} inputMode={inputMode} placeholder="Default" value={draft[key]} disabled={disabled}
        aria-invalid={!!errors[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} />
      {draft[key] && <button type="button" disabled={disabled} onClick={() => setDraft({ ...draft, [key]: '' })}>Default</button>}
    </div>
    <small className={errors[key] ? 'invalid' : undefined}>{errors[key] ?? hint}</small>
  </div>;

  return <div className="more-settings">
    <button type="button" className="more-settings-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <span>More settings{count > 0 && <span className="more-settings-count"> · {count} custom</span>}
        {attention && <span className="more-settings-attention"> · needs attention</span>}</span>
      <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
    </button>
    {expanded && <div className="more-settings-body">
      {field('maxTokens', 'Max output tokens', `Default · model limit ${model.maxTokens.toLocaleString()}`, 'numeric')}
      {field('temperature', 'Temperature', 'Default · range 0–2', 'decimal')}
      {field('contextBudget', 'Context budget', `Default · up to ${model.contextWindow.toLocaleString()} · saved for future context management`, 'numeric')}
      {dirty && <div className="more-settings-actions">
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => setDraft(saved)}>Discard</button>
        <button type="button" className="primary-button" disabled={disabled || Object.keys(errors).length > 0} onClick={() => void apply()}>Save</button>
      </div>}
    </div>}
  </div>;
}
