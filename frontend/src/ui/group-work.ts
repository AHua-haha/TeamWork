import type { Message } from '@earendil-works/pi-ai';
import type { ClientSnapshot } from '../client/protocol.js';
import type { GroupEntry } from '../client/group-client.js';

export interface ToolActivity { id: string; kind: 'tool'; text: string; args?: string; result?: string; failed?: boolean }
export type ActivityItem = { id: string; kind: 'text'; text: string } | { id: string; kind: 'tools'; tools: ToolActivity[] };

/** One ordered visible flow; final acceptance partitions it, independently of disclosure. */
export function runActivity(snapshot: ClientSnapshot, entry: Extract<GroupEntry, { kind: 'member' }>): ActivityItem[] {
  const records = snapshot.completed.filter(record => record.runId === entry.run.runId && record.position > entry.working.after && (entry.working.through === null || record.position <= entry.working.through));
  const messages: { id: string; message: Message }[] = [
    ...records.map(record => ({ id: record.messageId, message: record.message })),
    ...snapshot.live.filter(live => entry.run.status === 'running' && live.runId === entry.run.runId && !records.some(record => record.messageId === live.messageId)).map(live => ({ id: live.messageId, message: live.message })),
  ];
  const final = entry.finalRef;
  const finalIndex = messages.findIndex(record => record.id === final?.messageId);
  const items: ActivityItem[] = [];
  const pending = new Map<string, ToolActivity>();
  const addTool = (tool: ToolActivity) => {
    const last = items.at(-1);
    if (last?.kind === 'tools') last.tools.push(tool);
    else items.push({ id: tool.id, kind: 'tools', tools: [tool] });
  };
  for (const [recordIndex, record] of messages.entries()) {
    const message = record.message;
    if (message.role === 'toolResult') {
      // Historical accepted tool-based finals retain their immutable reference, never a new execution path.
      if (final?.toolCallId && recordIndex === finalIndex + 1 && message.toolCallId === final.toolCallId) continue;
      const result = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
      const owner = pending.get(message.toolCallId);
      if (owner) { owner.result = result; owner.failed = message.isError; pending.delete(message.toolCallId); }
      else addTool({ id: record.id, kind: 'tool', text: message.toolName, result, failed: message.isError });
      continue;
    }
    if (message.role !== 'assistant') {
      const text = typeof message.content === 'string' ? message.content : message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
      if (text.trim()) items.push({ id: record.id, kind: 'text', text });
      continue;
    }
    for (const [index, part] of message.content.entries()) {
      const id = `${record.id}-${index}`;
      if (part.type === 'text' && part.text.trim()) {
        const accepted = record.id === final?.messageId && !final.toolCallId && (final.contentIndices === undefined || final.contentIndices.includes(index));
        if (!accepted) items.push({ id, kind: 'text', text: part.text });
      } else if (part.type === 'toolCall') {
        if (record.id === final?.messageId && part.id === final.toolCallId) continue;
        const item: ToolActivity = { id, kind: 'tool', text: part.name, args: JSON.stringify(part.arguments, null, 2) };
        addTool(item); pending.set(part.id, item);
      }
    }
  }
  return items;
}

export function toolSetSummary(tools: ToolActivity[]): string {
  const labels: Record<string, [string, string]> = { terminal: ['command', 'commands'], book: ['read', 'reads'], search: ['search', 'searches'], pencil: ['edit', 'edits'], code: ['tool', 'tools'] };
  const counts = new Map<string, number>();
  for (const tool of tools) { const key = workToolSummary(tool).icon; counts.set(key, (counts.get(key) ?? 0) + 1); }
  return [...counts].map(([key, count]) => `${count} ${labels[key]![count === 1 ? 0 : 1]}`).join(' · ');
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
export function workToolSummary(item: ToolActivity): { icon: 'terminal' | 'book' | 'search' | 'pencil' | 'code'; label: string } {
  let args: Record<string, unknown> = {};
  try { const value: unknown = JSON.parse(item.args ?? '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) args = value as Record<string, unknown>; } catch { /* A partial tool call may not have complete arguments yet. */ }
  const path = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : '';
  const done = item.result !== undefined;
  if (item.text === 'bash') return { icon: 'terminal', label: `${done ? 'Ran' : 'Run'} ${typeof args.command === 'string' ? args.command : 'command'}` };
  if (item.text === 'run_command') return { icon: 'terminal', label: `${done ? 'Ran' : 'Run'} ${Array.isArray(args.argv) ? args.argv.join(' ') : 'command'}` };
  if (item.text === 'read') return { icon: 'book', label: `${done ? 'Read' : 'Reading'} ${path || 'file'}` };
  if (item.text === 'write' || item.text === 'edit') return { icon: 'pencil', label: `${done ? 'Updated' : 'Updating'} ${path || 'file'}` };
  if (item.text === 'ls' || item.text === 'find' || item.text === 'grep') return { icon: 'search', label: `${done ? 'Inspected' : 'Inspecting'} ${path || 'files'}` };
  return { icon: 'code', label: `${item.text}${path ? ` ${path}` : ''}` };
}
