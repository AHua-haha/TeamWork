import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { WorkspaceClient } from '../../shared/backend-client/index.js';
import { ChatRoster, type ChatTeamState } from './chat-roster.js';
export function useChatRoster(workspaceId: string, api: WorkspaceClient) {
  const model = useMemo(() => new ChatRoster(workspaceId, api), [workspaceId, api]);
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => { void model.refresh(); return model.dispose; }, [model]);
  const state: ChatTeamState = { ...snapshot, refresh: model.refresh };
  return { state, lead: snapshot.team?.members.find(member => member.lead) ?? null };
}
