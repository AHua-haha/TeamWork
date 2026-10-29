import type { ContextEntry } from '../../shared/backend-client/index.js';

/** Feature-owned labels describe stored messages without changing their content. */
export function ContextEntryRow({ entry, index }: { entry: ContextEntry; index: number }) {
  const { message, metadata } = entry;
  const tools = message.role === 'toolResult' ? [message.toolName]
    : message.role === 'assistant' ? [...new Set(message.content.flatMap(part => part.type === 'toolCall' ? [part.name] : []))] : [];
  const status = message.role === 'toolResult' ? message.isError ? 'failed' : 'success' : undefined;
  const hidden = metadata?.modelContextHidden === true;
  const argumentsHidden = Array.isArray(metadata?.suppressedToolCallArguments) && metadata.suppressedToolCallArguments.length > 0;
  const role = message.role === 'toolResult' ? 'tool result' : message.role;
  const visibility = hidden ? 'hidden' : argumentsHidden ? 'arguments hidden' : undefined;
  return <div className="sequence-inspector-meta" aria-label={[`Message ${index + 1}`, role, ...tools, status, visibility].filter(Boolean).join(', ')}>
    <span className="sequence-inspector-order">{String(index + 1).padStart(2, '0')}</span>
    <span className={`sequence-inspector-badge is-${message.role === 'toolResult' ? 'tool' : message.role}`}>{role}</span>
    {tools.map(tool => <span key={tool} className="sequence-inspector-badge is-tool">{tool}</span>)}
    {status && <span className={`sequence-inspector-badge is-${status}`}>{status}</span>}
    {visibility && <span className="sequence-inspector-badge is-hidden">{visibility}</span>}
  </div>;
}
