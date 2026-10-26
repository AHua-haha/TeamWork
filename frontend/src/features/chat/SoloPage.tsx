import { useEffect } from 'react';
import type { ConfigClient } from '../../shared/backend-client/index.js';
import { ChatPage } from './ChatPage.js';
import { useAgentConfig } from './useAgentConfig.js';

/** A conversation with an agent that belongs to no workspace: the chat, with no team and no files. */
export function SoloPage({ agentId, api, configRefresh }: { agentId: string; api: ConfigClient; configRefresh: number }) {
  const config = useAgentConfig(agentId, api);
  useEffect(() => { if (configRefresh) void config.refresh(); }, [configRefresh, config.refresh]);
  return <div className="conversation-page">
    <ChatPage agentId={agentId} control={config} api={api} eyebrow="CONVERSATION" title={config.record?.value.name || `Conversation · ${agentId.slice(0, 8)}`} />
  </div>;
}
