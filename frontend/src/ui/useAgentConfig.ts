import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendError } from '../client/agent-client.js';
import { ConfigClient, emptySettings, type AgentConfig, type AgentSettings } from '../client/config-client.js';

/**
 * What the composer controls and the chat page need of the settings of the agent they talk to: a solo agent's config, or the
 * lead's member record presented in the same shape.
 */
export interface SettingsControl {
  record: AgentConfig | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh(): Promise<void>;
  save(value: AgentSettings, expectedRevision?: number): Promise<AgentConfig | null>;
  initialize(settings?: Partial<AgentSettings>): Promise<boolean>;
  clearError(): void;
}

export function useAgentConfig(agentId: string, api: ConfigClient): SettingsControl {
  const [record, setRecord] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AgentConfig | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const latest = await api.getAgent(agentId);
      current.current = latest;
      setRecord(latest);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load agent settings');
    } finally { setLoading(false); }
  }, [agentId, api]);

  useEffect(() => {
    current.current = null;
    setRecord(null);
    setLoading(true);
    void refresh();
    const onFocus = () => { if (!busy.current) void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const save = useCallback(async (value: AgentSettings, expectedRevision?: number): Promise<AgentConfig | null> => {
    if (!current.current || busy.current) return null;
    if (expectedRevision !== undefined && current.current.revision !== expectedRevision) {
      setError('These settings changed elsewhere. Review the latest values before saving again.');
      return null;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateAgent(current.current, value);
      current.current = saved;
      setRecord(saved);
      return saved;
    } catch (cause) {
      if (cause instanceof BackendError && cause.status === 409) {
        await refresh();
        setError('These settings changed elsewhere. Review the latest values before saving again.');
      } else setError(cause instanceof Error ? cause.message : 'Could not save agent settings');
      return null;
    } finally { busy.current = false; setSaving(false); }
  }, [api, refresh]);

  /** Creates the agent's settings when it has none yet; `settings` replaces some of the empty defaults. */
  const initialize = useCallback(async (settings: Partial<AgentSettings> = {}): Promise<boolean> => {
    if (busy.current || current.current) return false;
    busy.current = true;
    setSaving(true);
    try {
      const created = await api.createAgentConfig(agentId, { ...emptySettings, ...settings });
      current.current = created;
      setRecord(created);
      setError(null);
      return true;
    } catch (cause) {
      if (cause instanceof BackendError && cause.status === 409) await refresh();
      else setError(cause instanceof Error ? cause.message : 'Could not create agent settings');
      return false;
    } finally { busy.current = false; setSaving(false); }
  }, [agentId, api, refresh]);

  return { record, loading, saving, error, refresh, save, initialize, clearError: () => setError(null) };
}
