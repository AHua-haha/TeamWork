import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Team, WorkspaceClient } from '../../shared/backend-client/index.js';
import { findLead, pollIntervalMs } from './team-state.js';
export interface TeamState { team: Team | null; loading: boolean; error: string | null; refresh(): Promise<void> }

/** Read current members on focus, timeline updates and while any team member works. */
export function useTeam(workspaceId: string, client: WorkspaceClient, running: boolean) {
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const epoch = generation.current; const ticket = ++request.current;
    try {
      const next = await client.team(workspaceId);
      if (epoch !== generation.current || ticket !== request.current) return;
      setTeam(next); setError(null);
    } catch (cause) {
      if (epoch === generation.current && ticket === request.current) setError(cause instanceof Error ? cause.message : 'Team could not be read');
    } finally { if (epoch === generation.current && ticket === request.current) setLoading(false); }
  }, [client, workspaceId]);
  useEffect(() => {
    generation.current++; setTeam(null); setLoading(true); void refresh();
    const focus = () => { void refresh(); }; window.addEventListener('focus', focus);
    return () => { generation.current++; window.removeEventListener('focus', focus); };
  }, [refresh]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void refresh(); }, pollIntervalMs);
    return () => { window.clearInterval(timer); void refresh(); };
  }, [running, refresh]);
  const state = useMemo<TeamState>(() => ({ team, loading, error, refresh }), [team, loading, error, refresh]);
  return { state, lead: findLead(team) };
}
