import { backendClient } from '../../shared/backend-client/index.js';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AgentRuntimeProvider } from './AssistantRuntime.js';
import type { AgentClient } from '../../shared/backend-client/index.js';
import type { ConfigClient } from '../../shared/backend-client/index.js';
import type { Discussion } from '../../shared/backend-client/index.js';
import { Conversation } from './Thread.js';
import type { SettingsControl } from './useAgentConfig.js';

/**
 * One private conversation with a solo agent. The page that owns the agent's settings gives them
 * as `control`, and may ask to be told when the agent's run starts and ends.
 */
export function ChatPage({ agentId, control, api, eyebrow, title, filesOpen, onFiles, onRunning, discussion }: {
  agentId: string; control: SettingsControl; api: ConfigClient; eyebrow: string; title: string;
  filesOpen?: boolean; onFiles?(open: boolean): void; onRunning?(running: boolean): void; discussion?: Discussion;
}) {
  const client = useMemo(() => backendClient.agent(agentId), [agentId]);
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
