import type {ContextEntry} from '../../agent/data/index.js';

export function projectFileContextEntry(entry: ContextEntry): ContextEntry {
  // Agent passes a detached request projection; stored context/history are never mutated.
  const message = entry.message;
  if (entry.metadata.modelContextHidden === true && message.role === 'toolResult') {
    message.content = [{type:'text',text:'[File view omitted; a newer aggregate is available.]'}];
  }
  if (message.role === 'assistant' && Array.isArray(message.content) && Array.isArray(entry.metadata.suppressedToolCallArguments)) {
    const suppressed = new Set(entry.metadata.suppressedToolCallArguments.filter((id): id is string => typeof id === 'string'));
    message.content = message.content.map(part => part.type === 'toolCall' && suppressed.has(part.id)
      ? {...part,arguments:{...part.arguments,content:'[Written successfully; content omitted from future context.]'}} : part);
  }
  return {...entry,message};
}
