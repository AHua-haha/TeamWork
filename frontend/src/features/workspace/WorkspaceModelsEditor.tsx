import { backendClient } from '../../shared/backend-client/index.js';
import { useEffect, useMemo, useState } from 'react';
import { ConfigClient, type ModelOptions, type ModelChoice } from '../../shared/backend-client/index.js';
import type { WorkspaceModels } from '../../shared/backend-client/index.js';
import { addWorkspaceModel, modelReference, removeWorkspaceModel, workspaceModelKey } from './workspace-model-state.js';

interface Choice { key: string; connectionId: string; model: ModelChoice; label: string }
/** Edits only workspace model choices/default. Member configuration is inspected separately. */
export function WorkspaceModelsEditor({ value, onChange, disabled }: { value: WorkspaceModels; onChange(value: WorkspaceModels): void; disabled: boolean }) {
  const api = useMemo(() => backendClient.config, []);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true; setLoading(true); setError(null);
    void (async () => {
      try {
        const connections = await api.listConnections();
        const results = await Promise.allSettled(connections.map(c => api.modelChoices(c.id)));
        if (!current) return;
        const next: Choice[] = [], failed: string[] = [];
        results.forEach((result, i) => {
          const connection = connections[i]!;
          if (result.status === 'rejected') failed.push(connection.value.label);
          else next.push(...result.value.map(model => ({ key: workspaceModelKey({ connectionId: connection.id, modelId: model.modelId }), connectionId: connection.id, model, label: `${model.label} · ${connection.value.label}` })));
        });
        setChoices(next);
        if (failed.length) setError(`Could not load models from ${failed.join(', ')}.`);
      } catch (cause) { if (current) setError(cause instanceof Error ? cause.message : 'Models could not be loaded'); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; };
  }, [api, reload]);
  const update = (key: string, fields: Partial<ModelOptions>) => onChange({ ...value, models: value.models.map(m => workspaceModelKey(m) === key ? { ...m, ...fields } : m) });
  return <section className="workspace-model-editor" aria-label="Workspace model choices">
    <h3>Workspace models</h3>
    <p>The lead and new members start with the default. Changing it keeps existing members’ model selections.</p>
    {error && <p className="form-error" role="alert">{error} <button type="button" className="text-button" onClick={() => setReload(n => n + 1)}>Retry model discovery</button></p>}
    {loading && <p role="status">Loading provider models…</p>}
    {!loading && !choices.length && <p>Configure a provider and its models in Config, then retry model discovery.</p>}
    <div className="workspace-model-list">{value.models.map(model => {
      const key = workspaceModelKey(model), choice = choices.find(c => c.key === key);
      return <article className="workspace-model-row" key={key}>
        <div className="workspace-model-heading"><label className="check-line"><input type="radio" name="workspace-default-model" checked={!!value.defaultModel && workspaceModelKey(value.defaultModel) === key} disabled={disabled} onChange={() => onChange({ ...value, defaultModel: modelReference(model) })} />
          <span><strong>{choice?.label ?? `${model.modelId} · ${model.connectionId}`}</strong><small>{value.defaultModel && workspaceModelKey(value.defaultModel) === key ? 'Default model' : 'Available to the lead'}</small></span></label>
          <button type="button" className="text-button" disabled={disabled} aria-label={`Remove ${model.modelId}`} onClick={() => onChange(removeWorkspaceModel(value, model))}>Remove</button></div>
        {!loading && !choice && <p className="form-error">This model is unavailable in current provider discovery. Choose a replacement or repair its provider.</p>}
        <details><summary>Run options</summary><div className="workspace-model-options">
          <label>Reasoning<select value={model.reasoning ?? ''} disabled={disabled} onChange={e => update(key, { reasoning: (e.target.value || undefined) as ModelOptions['reasoning'] })}>
            <option value="">Provider default</option>{(choice?.model.reasoningLevels ?? ['off', 'low', 'medium', 'high', 'xhigh']).map(level => <option value={level} key={level}>{level}</option>)}
            {model.reasoning && choice && !choice.model.reasoningLevels.includes(model.reasoning) && <option value={model.reasoning}>Unsupported: {model.reasoning}</option>}
          </select></label>
          {(['temperature', 'maxTokens', 'contextBudget'] as const).map(field => <label key={field}>{field === 'temperature' ? 'Temperature' : field === 'maxTokens' ? 'Maximum output tokens' : 'Context budget'}<input type="number" step={field === 'temperature' ? 'any' : '1'} min={field === 'temperature' ? 0 : 1} max={field === 'temperature' ? 2 : undefined} placeholder="Default" value={model[field] ?? ''} disabled={disabled} onChange={e => update(key, { [field]: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>)}
        </div></details>
      </article>;
    })}</div>
    <label>Add a model<select aria-label="Add workspace model" value="" disabled={disabled || loading || value.models.length >= 50} onChange={e => {
      const choice = choices.find(c => c.key === e.target.value); if (choice) onChange(addWorkspaceModel(value, { connectionId: choice.connectionId, modelId: choice.model.modelId }));
    }}><option value="">Choose a provider model…</option>{choices.map(choice => <option key={choice.key} value={choice.key} disabled={value.models.some(m => workspaceModelKey(m) === choice.key)}>{choice.label}</option>)}</select></label>
  </section>;
}
