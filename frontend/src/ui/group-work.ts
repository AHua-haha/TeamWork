import type { Message } from '@earendil-works/pi-ai';
import type { ClientSnapshot } from '../client/protocol.js';
import type { GroupEntry } from '../client/group-client.js';
export interface WorkItem { id: string; kind: 'text' | 'reasoning' | 'tool'; text: string; args?: string; result?: string; failed?: boolean }
function runMessages(snapshot: ClientSnapshot, entry: Extract<GroupEntry, { kind: 'member' }>): { id: string; message: Message }[] {
  const records = snapshot.completed.filter(record => record.runId === entry.run.runId && record.position > entry.working.after && (entry.working.through === null || record.position <= entry.working.through));
  return [
    ...records.map(record => ({ id: record.messageId, message: record.message })),
    ...snapshot.live.filter(live => entry.run.status === 'running' && live.runId === entry.run.runId && !records.some(record => record.messageId === live.messageId)).map(live => ({ id: live.messageId, message: live.message })),
  ];
}
/** Private text is a provisional preview; only the group final reference establishes publication. */
export function responsePreview(snapshot: ClientSnapshot, entry: Extract<GroupEntry, { kind: 'member' }>): { id: string; text: string } | null {
  if (entry.run.status !== 'running' || entry.finalRef || entry.text !== null) return null;
  if (snapshot.run && snapshot.run.status !== 'running' && snapshot.run.status !== 'completed') return null;
  const latest = runMessages(snapshot, entry).at(-1);
  if (!latest || latest.message.role !== 'assistant' || latest.message.content.some(part => part.type === 'toolCall') || ['error', 'aborted'].includes(latest.message.stopReason)) return null;
  if (snapshot.run?.activeMessageId && snapshot.run.activeMessageId !== latest.id) return null;
  const text = latest.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
  return text.trim() ? { id: latest.id, text } : null;
}
export function workingItems(snapshot: ClientSnapshot, entry: Extract<GroupEntry, { kind: 'member' }>, previewId?: string): WorkItem[] {
  const messages = runMessages(snapshot, entry);
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
      if (text.trim()) items.push({ id: record.id, kind: 'text', text }); continue;
    }
    for (const [index, part] of message.content.entries()) {
      const id = `${record.id}-${index}`;
      if (part.type === 'text') {
        if (record.id !== entry.finalRef?.messageId && record.id !== previewId && part.text.trim()) items.push({ id, kind: 'text', text: part.text });
      } else if (part.type === 'thinking' && part.thinking.trim()) items.push({ id, kind: 'reasoning', text: part.thinking });
      else if (part.type === 'toolCall') {
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

/** Short action/argument descriptions; full JSON and results remain available in the disclosure. */
export function workToolSummary(item: WorkItem): { icon: 'terminal' | 'book' | 'search' | 'pencil' | 'code'; label: string } {
  let args: Record<string, unknown> = {};
  try { const value: unknown = JSON.parse(item.args ?? '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) args = value as Record<string, unknown>; } catch { /* A partial tool call may not have complete arguments yet. */ }
  const path = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : '';
  const done = item.result !== undefined;
  if (item.text === 'run_command') return { icon: 'terminal', label: `${done ? 'Ran' : 'Run'} ${Array.isArray(args.argv) ? args.argv.join(' ') : 'command'}` };
  if (item.text === 'read') return { icon: 'book', label: `${done ? 'Read' : 'Reading'} ${path || 'file'}` };
  if (item.text === 'write' || item.text === 'edit') return { icon: 'pencil', label: `${done ? 'Updated' : 'Updating'} ${path || 'file'}` };
  if (item.text === 'ls' || item.text === 'find' || item.text === 'grep') return { icon: 'search', label: `${done ? 'Inspected' : 'Inspecting'} ${path || 'files'}` };
  return { icon: 'code', label: `${item.text}${path ? ` ${path}` : ''}` };
}
