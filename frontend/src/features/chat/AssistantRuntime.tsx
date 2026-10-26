import { AssistantRuntimeProvider, useExternalStoreRuntime } from '@assistant-ui/react';
import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react';
import { useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { AgentClient } from '../../shared/backend-client/index.js';
import { discussionInput, type Discussion } from '../../shared/backend-client/index.js';
import { projectSnapshot } from './project.js';

function inputText(message: AppendMessage): string {
  return message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
}

export function AgentRuntimeProvider({ client, sendAllowed, children, discussion }: { client: AgentClient; sendAllowed: boolean; children: ReactNode; discussion?: Discussion }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const messages = useMemo(() => projectSnapshot(snapshot), [snapshot]);
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: message => message,
    isRunning: snapshot.run?.status === 'running' || snapshot.sending,
    isLoading: !snapshot.synchronized && snapshot.connection === 'syncing',
    isSendDisabled: !sendAllowed || !snapshot.synchronized || snapshot.sending || snapshot.run?.status === 'running',
    onNew: async message => {
      const reference = discussion?.reference ?? null;
      await client.send(discussionInput(inputText(message), reference));
      if (reference) discussion?.sent(reference);
    },
    onCancel: async () => { await client.cancel(); },
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
