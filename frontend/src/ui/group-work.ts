import type { ClientSnapshot } from '../client/protocol.js';
import type { GroupEntry } from '../client/group-client.js';
export interface WorkItem { id: string; kind: 'text' | 'reasoning' | 'tool'; text: string; args?: string; result?: string; failed?: boolean }
export function workingItems(snapshot: ClientSnapshot, entry: Extract<GroupEntry, { kind: 'member' }>): WorkItem[] {
  const records = snapshot.completed.filter(record => record.runId === entry.run.runId && record.position > entry.working.after && (entry.working.through === null || record.position <= entry.working.through));
  const messages = [
    ...records.map(record => ({ id: record.messageId, message: record.message })),
    ...snapshot.live.filter(live => live.runId === entry.run.runId && !records.some(record => record.messageId === live.messageId)).map(live => ({ id: live.messageId, message: live.message })),
  ];
  const items: WorkItem[] = [];
  const pending = new Map<string, WorkItem>();
  for (const record of messages) {
    const message = record.message;
    if (message.role === 'toolResult') {
      const result = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
      const owner = pending.get(message.toolCallId);
      if (owner) { owner.result = result; owner.failed = message.isError; pending.delete(message.toolCallId); }
      else items.push({ id: record.id, kind: 'tool', text: message.toolName, result, failed: message.isError });
      continue;
    }
    if (message.role !== 'assistant') {
      const text = typeof message.content === 'string' ? message.content : message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
      items.push({ id: record.id, kind: 'text', text }); continue;
    }
    for (const [index, part] of message.content.entries()) {
      const id = `${record.id}-${index}`;
      if (part.type === 'text') {
        if (record.id !== entry.finalRef?.messageId) items.push({ id, kind: 'text', text: part.text });
      } else if (part.type === 'thinking') items.push({ id, kind: 'reasoning', text: part.thinking });
      else {
        const item: WorkItem = { id, kind: 'tool', text: part.name, args: JSON.stringify(part.arguments, null, 2) };
        items.push(item); pending.set(part.id, item);
      }
    }
  }
  return items;
}
export const memberColor = (id: string) => {
  let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ['#36734b', '#476faf', '#8960a5', '#a46535', '#367c80', '#a34f71'][hash % 6]!;
};
export function workDuration(start: number, end: number) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|[^\p{L}\p{N}_.@-])@([A-Za-z0-9_.-]*)$/u.exec(text.slice(0, caret));
  return match ? { start: caret - match[2]!.length - 1, query: match[2]! } : null;
}
export const mentionToken = (name: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) ? `@${name}` : `@{${name}}`;
