import { backendClient } from '../../shared/backend-client/index.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BackendError } from '../../shared/backend-client/index.js';
import { emptySettings, type AgentConfig, type AgentSettings, type ConfigClient } from '../../shared/backend-client/index.js';
import { type Member, type MemberModelConfig, type WorkspaceClient } from '../../shared/backend-client/index.js';
import { ModelSettingsPanel } from './ComposerSettings.js';
import type { SettingsControl } from './useAgentConfig.js';

const configApi = backendClient.config;
const workspaceApi = backendClient.workspace;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not load member model settings';
const pickerRecord = (record: MemberModelConfig): AgentConfig => ({ ...record, value: { ...emptySettings, ...record.value } });

/** Adapts the model-only member API to the shared picker without exposing member-file mutation. */
function useMemberModel(workspaceId: string, memberId: string, onSaved: () => Promise<void>): SettingsControl {
  const [record, setRecord] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AgentConfig | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++request.current;
    try {
      const next = pickerRecord(await workspaceApi.memberModelSettings(workspaceId, memberId));
      if (!mounted.current || generation !== request.current) return;
      current.current = next; setRecord(next); setError(null);
    } catch (cause) { if (mounted.current && generation === request.current) setError(errorText(cause)); }
    finally { if (mounted.current && generation === request.current) setLoading(false); }
  }, [workspaceId, memberId]);
  useEffect(() => {
    mounted.current = true; void refresh();
    const focus = () => { if (!busy.current) void refresh(); };
    window.addEventListener('focus', focus);
    return () => { mounted.current = false; request.current++; window.removeEventListener('focus', focus); };
  }, [refresh]);
  const save = useCallback(async (value: AgentSettings, revision?: number): Promise<AgentConfig | null> => {
    if (!current.current || busy.current) return null;
    if (revision !== undefined && current.current.revision !== revision) {
      setError('Settings changed elsewhere. Review the latest values before saving.'); return null;
    }
    busy.current = true; setSaving(true); setError(null); ++request.current;
    try {
      const { connectionId, modelId, modelOptions } = value;
      const next = pickerRecord(await workspaceApi.updateMemberModelSettings(workspaceId, memberId, current.current.revision, { connectionId, modelId, modelOptions }));
      if (mounted.current) { current.current = next; setRecord(next); }
      void onSaved();
      return next;
    } catch (cause) {
      if (cause instanceof BackendError && cause.status === 409) {
        await refresh();
        if (mounted.current) setError('Settings changed elsewhere. Review the latest values before saving.');
      } else if (mounted.current) setError(errorText(cause));
      return null;
    } finally { busy.current = false; if (mounted.current) setSaving(false); }
  }, [workspaceId, memberId, refresh, onSaved]);
  return { record, loading, saving, error, refresh, save, initialize: async () => false, clearError: () => setError(null) };
}

export function MemberModelPopover({ workspaceId, member, anchor, onClose, onEnter, onLeave, onSaved }: {
  workspaceId: string; member: Pick<Member, 'memberId' | 'name' | 'running'>; anchor: HTMLButtonElement;
  onClose(): void; onEnter(): void; onLeave(): void; onSaved(): Promise<void>;
}) {
  const control = useMemberModel(workspaceId, member.memberId, onSaved);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, visibility: 'hidden' as 'hidden' | 'visible' });
  useEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = panel.current?.offsetWidth ?? 340, height = panel.current?.offsetHeight ?? 400;
      const left = Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8));
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - height - 8));
      setPosition({ left, top, visibility: 'visible' });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    const dismiss = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { anchor.focus({ preventScroll: true }); onClose(); }
      if (event.key === 'Tab' && !event.shiftKey && event.target === anchor) {
        const first = panel.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)');
        event.preventDefault(); (first ?? panel.current)?.focus();
      }
    };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
    document.addEventListener('mousedown', dismiss); document.addEventListener('keydown', escape);
    window.addEventListener('resize', place); document.addEventListener('scroll', scroll, true);
    return () => { observer.disconnect(); document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); window.removeEventListener('resize', place); document.removeEventListener('scroll', scroll, true); };
  }, [anchor, onClose]);
  return createPortal(<div ref={panel} tabIndex={-1} className="member-model-popover" style={position}
    onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && !anchor.contains(event.relatedTarget as Node)) onLeave(); }}>
    <div className="member-model-heading">{member.name}<span>Model settings</span></div>
    <ModelSettingsPanel control={control} api={configApi} active={member.running} onClose={onClose} />
  </div>, document.body);
}
