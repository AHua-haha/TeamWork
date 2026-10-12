import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AgentRuntimeProvider } from '../adapter/AssistantRuntime.js';
import { AgentClient } from '../client/agent-client.js';
import type { ConfigClient } from '../client/config-client.js';
import type { Discussion } from '../client/discussion-reference.js';
import { Conversation } from './Thread.js';
import type { SettingsControl } from './useAgentConfig.js';

/**
 * One conversation with one agent: a solo agent, or a workspace's lead. The page that owns the agent's settings gives them
 * as `control`, and may ask to be told when the agent's run starts and ends.
 */
export function ChatPage({ agentId, control, api, eyebrow, title, filesOpen, onFiles, onRunning, discussion }: {
  agentId: string; control: SettingsControl; api: ConfigClient; eyebrow: string; title: string;
  filesOpen?: boolean; onFiles?(open: boolean): void; onRunning?(running: boolean): void; discussion?: Discussion;
}) {
  const client = useMemo(() => new AgentClient(agentId), [agentId]);
  const [composerReady, setComposerReady] = useState(false);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const running = snapshot.run?.status === 'running';
  useEffect(() => { client.follow(); return () => client.dispose(); }, [client]);
  useEffect(() => { onRunning?.(running); }, [running, onRunning]);
  const sendAllowed = composerReady && !control.loading && !control.saving && !control.error && !!control.record && control.record.issues.length === 0;
  return <AgentRuntimeProvider client={client} sendAllowed={sendAllowed} discussion={discussion}>
    <Conversation client={client} config={control} api={api} eyebrow={eyebrow} title={title} onConfigGate={setComposerReady} filesOpen={filesOpen ?? false} onFiles={onFiles} discussion={discussion} />
  </AgentRuntimeProvider>;
}
