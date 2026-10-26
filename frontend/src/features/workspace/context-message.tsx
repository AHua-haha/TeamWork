import type { Message } from '@earendil-works/pi-ai';
import { useState } from 'react';
import type { ContextEntry } from '../../shared/backend-client/context-client.js';
import { AssistantRuntimeProvider, MessageByIndexProvider, MessagePrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ImageMessagePartProps, ReasoningMessagePartProps, TextMessagePartProps, ToolCallMessagePartProps, ThreadMessageLike } from '@assistant-ui/react';

// Context inspection maps Pi content only at the feature boundary; stored messages are not mutated.
type Part = Exclude<ThreadMessageLike['content'], string>[number];
function contentParts(message: Message): Part[] {
  if (message.role === 'system') return [{ type: 'text', text: typeof message.content === 'string' ? message.content : message.content.map(part => part.text).join('\n') }];
  if (message.role === 'user') return typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content.map(part => part.type === 'image' ? { type: 'image', image: `data:${part.mimeType};base64,${part.data}` } : { type: 'text', text: part.text });
  if (message.role === 'toolResult') return message.content.map<Part>(part => part.type === 'image'
    ? { type: 'image', image: `data:${part.mimeType};base64,${part.data}` }
    : { type: 'text', text: part.text }).concat(message.details === undefined ? [] : [{ type: 'text', text: `Tool details:\n${JSON.stringify(message.details, null, 2)}` }]);
  return message.content.map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'thinking') return { type: 'reasoning', text: part.thinking };
    return { type: 'tool-call', toolCallId: part.id, toolName: part.name, args: part.arguments, argsText: JSON.stringify(part.arguments) };
  });
}
function TextPart({ text }: TextMessagePartProps) { return <p className="context-rendered-text">{text}</p>; }
function ReasoningPart({ text }: ReasoningMessagePartProps) { return <details className="context-thinking"><summary>Thinking</summary><p>{text}</p></details>; }
function ImagePart({ image }: ImageMessagePartProps) { return <img className="context-image" src={image} alt="Context message image" />; }
function ToolPart({ toolName, argsText, result, isError }: ToolCallMessagePartProps) { return <details className={`context-tool${isError ? ' is-error' : ''}`}><summary>{toolName}{isError ? ' · error' : ''}</summary><pre>{argsText || '{}'}</pre>{result !== undefined && <pre>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>}</details>; }
const partComponents = { Text: TextPart, Reasoning: ReasoningPart, Image: ImagePart, tools: { Fallback: ToolPart } };

/** Status belongs only to assistant messages; group/user/system input must remain input. */
export function contextThreadMessage(message: Message): ThreadMessageLike {
  const role = message.role === 'toolResult' ? 'assistant' : message.role;
  const base = { id: 'context-message', createdAt: new Date(message.timestamp), role, content: contentParts(message) };
  return role === 'assistant' ? { ...base, status: { type: 'complete', reason: 'stop' } } : base;
}
function ReadOnlyMessage({ message }: { message: Message }) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({ messages: [contextThreadMessage(message)], convertMessage: value => value, onNew: async () => {} });
  return <AssistantRuntimeProvider runtime={runtime}><MessageByIndexProvider index={0}><MessagePrimitive.Root className="context-assistant-message"><MessagePrimitive.Parts components={partComponents} /></MessagePrimitive.Root></MessageByIndexProvider></AssistantRuntimeProvider>;
}

function ThinkingSignature({ signature, block }: { signature: string; block: number }) {
  const [open, setOpen] = useState(false);
  let content = signature;
  if (open) {
    try { content = JSON.stringify(JSON.parse(signature), null, 2); } catch { /* Other providers may return an opaque signature rather than JSON. */ }
  }
  return <details className="context-thinking-signature" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Thinking signature · block {block}</summary>
    {open && <pre>{content}</pre>}
  </details>;
}

export function ContextMessageDetail({ entry, index }: { entry: ContextEntry; index: number }) {
  const message = entry.message;
  const [raw, setRaw] = useState(false);
  const kind = roleLabel(message);
  return <article className="context-message-detail"><div className="eyebrow">ENTRY {String(index + 1).padStart(3, '0')} · {kind}</div><h3>{contextMessageLabel(message)}</h3><p className="context-entry-id">{entry.messageId}</p>
    {entry.metadata && <details className="context-message-metadata"><summary>Message metadata</summary><pre>{JSON.stringify(entry.metadata, null, 2)}</pre></details>}
    <div className="context-detail-actions"><button type="button" className="text-button" aria-expanded={raw} onClick={() => setRaw(value => !value)}>{raw ? 'Hide raw data' : 'Show raw data'}</button></div>
    {raw ? <pre className="context-raw">{JSON.stringify(message, null, 2)}</pre> : <>
      <ReadOnlyMessage key={`${entry.messageId}:${entry.metadata?.source ?? ''}`} message={message} />
      {message.role === 'assistant' && message.content.map((part, block) => part.type === 'thinking' && part.thinkingSignature
        ? <ThinkingSignature key={`${entry.messageId}:${block}`} signature={part.thinkingSignature} block={block + 1} /> : null)}
    </>}
  </article>;
}

function roleLabel(message: Message) { return message.role === 'toolResult' ? `Tool result · ${message.toolName}` : message.role; }
export function contextMessageRole(message: Message) { return roleLabel(message); }
export function contextMessageLabel(message: Message) {
  if (message.role === 'assistant') {
    const text = message.content.find(part => part.type === 'text');
    if (text?.type === 'text' && text.text.trim()) return text.text.trim().slice(0, 100);
    const call = message.content.find(part => part.type === 'toolCall');
    if (call?.type === 'toolCall') return `Tool call · ${call.name}`;
    return 'Assistant message';
  }
  if (message.role === 'toolResult') return `${message.toolName}${message.isError ? ' · error' : ' · result'}`;
  const text = typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.type === 'text' ? part.text : '').join(' ');
  return text.trim().slice(0, 100) || (message.role === 'system' ? 'System instructions' : 'User message');
}
