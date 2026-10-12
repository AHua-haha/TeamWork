import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackendError } from '../client/agent-client.js';
import type { AgentSettings } from '../client/config-client.js';
import type { Member, Team, WorkspaceClient } from '../client/workspace-client.js';
import { findLead, leadConfig, leadFields, pollIntervalMs, shouldPoll } from './team-state.js';
import type { SettingsControl } from './useAgentConfig.js';

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Request failed';

/** A workspace's team as the page and its panel see it. */
export interface TeamState {
  team: Team | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/**
 * Reads a workspace's team, and again every few seconds while the lead's run is active and once more when it ends, so
 * the Team tab's Working status follows who is being called. `control` presents the lead's record to the composer
 * controls, which save its run settings through the lead's member record.
 */
export function useTeam(workspaceId: string, client: WorkspaceClient, leadRunning: boolean): { state: TeamState; lead: Member | null; control: SettingsControl } {
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Team | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const apply = useCallback((next: Team) => { current.current = next; setTeam(next); }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await client.team(workspaceId);
      if (!alive.current) return;
      apply(next);
      setError(null);
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally { if (alive.current) setLoading(false); }
  }, [client, workspaceId, apply]);

  useEffect(() => {
    current.current = null;
    setTeam(null);
    setLoading(true);
    void refresh();
    const onFocus = () => { if (!busy.current) void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  useEffect(() => {
    if (!shouldPoll(leadRunning)) return;
    const timer = window.setInterval(() => { void refresh(); }, pollIntervalMs);
    // The run ended, or the page is going away: one last read shows the final state.
    return () => { window.clearInterval(timer); void refresh(); };
  }, [leadRunning, refresh]);

  const lead = findLead(team);
  const save = useCallback(async (value: AgentSettings, expectedRevision?: number) => {
    const member = findLead(current.current);
    if (!member || busy.current) return null;
    if (expectedRevision !== undefined && member.revision !== expectedRevision) {
      setError('These settings changed elsewhere. Review the latest values before saving again.');
      return null;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = await client.updateMember(workspaceId, member.memberId, member.revision, leadFields(member, value));
      if (current.current) apply({ ...current.current, members: current.current.members.map(item => item.memberId === saved.memberId ? saved : item) });
      return leadConfig(saved);
    } catch (cause) {
      if (cause instanceof BackendError && cause.status === 409) {
        await refresh();
        setError('These settings changed elsewhere. Review the latest values before saving again.');
      } else setError(errorText(cause));
      return null;
    } finally { busy.current = false; setSaving(false); }
  }, [client, workspaceId, apply, refresh]);

  const state = useMemo<TeamState>(() => ({ team, loading, error, refresh }), [team, loading, error, refresh]);
  const control = useMemo<SettingsControl>(() => ({
    record: lead ? leadConfig(lead) : null, loading, saving, error, refresh, save,
    // A lead always has a record; there is nothing to set up.
    initialize: async () => false,
    clearError: () => setError(null),
  }), [lead, loading, saving, error, refresh, save]);
  return { state, lead, control };
}
