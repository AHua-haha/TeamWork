import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react';
import type { ImageMessagePartProps, ReasoningMessagePartProps, TextMessagePartProps, ToolCallMessagePartProps } from '@assistant-ui/react';
import { useSyncExternalStore } from 'react';
import { AgentClient } from '../client/agent-client.js';
import { ConfigClient } from '../client/config-client.js';
import { ComposerSettings, type AgentConfigControl } from './ComposerSettings.js';

function TextPart({ text }: TextMessagePartProps) { return <p className="message-text">{text}</p>; }
function ImagePart({ image }: ImageMessagePartProps) { return <img className="message-image" src={image} alt="Message attachment" />; }
function ReasoningPart({ text }: ReasoningMessagePartProps) {
  return <details className="reasoning"><summary>Reasoning</summary><p>{text}</p></details>;
}
function ToolPart({ toolName, argsText, result, isError }: ToolCallMessagePartProps) {
  return <details className={`tool-card ${isError ? 'tool-error' : ''}`}>
    <summary><span className="tool-dot" /> <strong>{toolName}</strong><span className="tool-state">{result === undefined ? 'Running' : isError ? 'Failed' : 'Complete'}</span></summary>
    <div className="tool-body"><span>Arguments</span><pre>{argsText || '{}'}</pre>
      {result !== undefined && <><span>Result</span><pre>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre></>}
    </div>
  </details>;
}

const parts = { Text: TextPart, Image: ImagePart, Reasoning: ReasoningPart, tools: { Fallback: ToolPart } };

export function Conversation({ client, config, api, onConfigGate }: { client: AgentClient; config: AgentConfigControl; api: ConfigClient; onConfigGate: (ready: boolean) => void }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const active = snapshot.run?.status === 'running';
  const status = snapshot.sending ? 'Submitting'
    : snapshot.connection === 'syncing' ? 'Syncing'
    : snapshot.connection === 'disconnected' ? 'Reconnecting'
    : snapshot.connection === 'error' ? 'Connection error'
    : active ? `Running · ${snapshot.run?.phase ?? 'model'}`
    : snapshot.run ? snapshot.run.status[0]?.toUpperCase() + snapshot.run.status.slice(1) : 'Ready';

  return <div className="conversation">
    <div className="conversation-head">
      <div><div className="eyebrow">CONVERSATION</div><h2>{config.record?.value.name || `Conversation · ${client.agentId.slice(0, 8)}`}</h2></div>
      <div className="conversation-actions">
        <span className={`status-pill ${active ? 'status-active' : ''} ${snapshot.connection === 'error' ? 'status-error' : ''}`}><span className="status-dot" />{status}</span>
        <button type="button" className="icon-button" onClick={() => client.refresh()} title="Synchronize conversation" aria-label="Refresh conversation">↻</button>
      </div>
    </div>
    {snapshot.error && <div className="error-banner" role="alert">{snapshot.error}<button type="button" onClick={() => client.refresh()}>Retry</button></div>}
    {config.record?.issues.length ? <div className="error-banner" role="alert">Configure this agent before sending: {config.record.issues.join(' · ')}</div> : null}
    {config.error && <div className="error-banner" role="alert">{config.error}</div>}
    {snapshot.run?.status === 'failed' && snapshot.run.error && <div className="error-banner" role="alert">Run failed: {snapshot.run.error.message}</div>}
    <ThreadPrimitive.Root className="thread">
      <ThreadPrimitive.Viewport className="thread-viewport">
        {snapshot.completed.length === 0 && snapshot.live.length === 0 && <div className="empty-state"><div className="empty-mark">✳</div><h3>Start a conversation</h3><p>Your message starts a backend owned agent run. The response appears here as it streams.</p></div>}
        <ThreadPrimitive.Messages>{({ message }) => <MessagePrimitive.Root className={`message message-${message.role}`}>
          <div className="message-rail"><span className="message-avatar">{message.role === 'assistant' ? '✳' : message.role === 'user' ? 'Y' : 'S'}</span></div>
          <div className="message-main"><div className="message-label">{message.role === 'assistant' ? 'Agent' : message.role === 'user' ? 'You' : 'System'}</div>
            <div className="message-content"><MessagePrimitive.Parts components={parts} /></div>
          </div>
        </MessagePrimitive.Root>}</ThreadPrimitive.Messages>
        <ThreadPrimitive.ViewportFooter className="composer-footer">
          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input className="composer-input" placeholder="Send a message to the agent…" aria-label="Message the agent" />
            <div className="composer-actions"><ComposerSettings control={config} api={api} active={active} onGateChange={onConfigGate} /><span>Enter to send · Shift+Enter for a new line</span>
              {active ? <button type="button" className="cancel-button" onClick={() => void client.cancel()}>Stop run</button> : <ComposerPrimitive.Send className="send-button">Send <span aria-hidden="true">↗</span></ComposerPrimitive.Send>}
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  </div>;
}
