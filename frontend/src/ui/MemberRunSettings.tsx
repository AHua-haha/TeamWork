import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfigClient } from '../client/config-client.js';
import { WorkspaceClient, type Member } from '../client/workspace-client.js';
import { memberConfig, memberFields } from './team-state.js';
import { ComposerSettings } from './ComposerSettings.js';
import type { SettingsControl } from './useAgentConfig.js';
import type { TeamState } from './useTeam.js';

/** Settings are saved through this member's revision; role, name and harness are preserved. */
export function MemberRunSettings({ workspaceId, member, team }: { workspaceId: string; member: Member; team: TeamState }) {
  const api = useMemo(() => new ConfigClient(), []);
  const client = useMemo(() => new WorkspaceClient(), []);
  const [current, setCurrent] = useState(member);
  const latest = useRef(member); latest.current = current;
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setCurrent(member); }, [member]);
  const control: SettingsControl = {
    record: memberConfig(current), loading: false, saving, error,
    refresh: team.refresh, clearError: () => setError(null), initialize: async () => false,
    save: async (value, revision) => {
      if (busy.current || (revision !== undefined && latest.current.revision !== revision)) return null;
      busy.current = true; setSaving(true); setError(null);
      try {
        const saved = await client.updateMember(workspaceId, member.memberId, latest.current.revision, memberFields(latest.current, value));
        setCurrent(saved); await team.refresh(); return memberConfig(saved);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Settings could not be saved'); await team.refresh(); return null; }
      finally { busy.current = false; setSaving(false); }
    },
  };
  return <div className="member-settings"><h3>{member.name} model settings</h3><ComposerSettings control={control} api={api} active={member.running} onGateChange={() => {}} />{error && <p role="alert">{error}</p>}</div>;
}
