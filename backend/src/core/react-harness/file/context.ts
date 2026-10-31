import type {ContextEntry} from '../../agent/data/index.js';

export function projectFileContextEntry(entry: ContextEntry): ContextEntry | null {
  // Agent passes a detached request projection; stored context/history are never mutated.
  if(entry.metadata.modelContextHidden===true&&entry.metadata.fileContextReplacement===true)return null;
  const message = entry.message;
  if (entry.metadata.modelContextHidden === true && message.role === 'toolResult') {
    message.content = [{type:'text',text:entry.metadata.fileContextRefreshHidden===true?'[File context omitted after refresh; use the usage README context or read the file again.]':'[File view omitted; a newer aggregate is available.]'}];
  }
  if (message.role === 'assistant' && Array.isArray(message.content) && Array.isArray(entry.metadata.suppressedToolCallArguments)) {
    const suppressed = new Set(entry.metadata.suppressedToolCallArguments.filter((id): id is string => typeof id === 'string'));
    message.content = message.content.map(part => part.type === 'toolCall' && suppressed.has(part.id)
      ? {...part,arguments:{...part.arguments,content:'[Written successfully; content omitted from future context.]'}} : part);
  }
  return {...entry,message};
}
