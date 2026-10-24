import { randomUUID } from 'node:crypto';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { validateEntries } from './message-validation.js';
import { AppError, type ContextEntry, type ContextHistory } from './types.js';

/** Team supplies content, never an activation/retention boundary. */
export interface GroupContextMessage {
  position: number;
  entry: ContextEntry;
  sender: string;
  origin?: { agentId: string; messageId: string };
}
export interface GroupContextReference {
  id: string;
  read(after: number): Promise<GroupContextMessage[]>;
}

/** Incorporation state lives with the entries, so content and consumption acknowledge atomically. */
export class AgentMessageContext {
  constructor(private readonly agentId: string, private readonly history: ContextHistory) {}

  async incoming(reference?: GroupContextReference): Promise<ContextEntry[] | undefined> {
    const entries = repairInterruptedTools(structuredClone(this.history.entries));
    if (reference) {
      let after = 0;
      for (const entry of entries) {
        if (entry.metadata.groupContextId !== reference.id) continue;
        const value = entry.metadata.groupPosition;
        if (!Number.isSafeInteger(value) || Number(value) < 1) throw new AppError('invalid_context', 'Invalid incorporated group position');
        after = Math.max(after, Number(value));
      }
      const messages = await reference.read(after);
      for (const message of messages) {
        if (!Number.isSafeInteger(message.position) || message.position <= after) throw new AppError('invalid_context', 'Group messages must be strictly ordered after the requested position');
        incorporate(entries, this.agentId, reference.id, message);
        after = message.position;
      }
    }
    validateEntries(entries);
    return JSON.stringify(entries) === JSON.stringify(this.history.entries) ? undefined : entries;
  }
}

function incorporate(entries: ContextEntry[], agentId: string, groupId: string, item: GroupContextMessage): void {
  validateEntries([item.entry]);
  if (typeof item.sender !== 'string' || !item.sender.trim()) throw new AppError('invalid_context', 'Group sender attribution is required');
  const metadata = { groupContextId: groupId, groupPosition: item.position, groupMessageId: item.entry.messageId,
    groupAuthor: item.entry.metadata.author ?? null, groupRecipients: item.entry.metadata.recipients ?? [] };
  const own = item.origin?.agentId === agentId ? entries.find(entry => entry.messageId === item.origin!.messageId && entry.message.role === 'assistant') : undefined;
  if (own && own.message.role === 'assistant') {
    // Keep original signed blocks intact. One extra attribution block, no second answer body.
    const firstVisible = own.message.content.findIndex(part => part.type !== 'thinking');
    own.message.content.splice(firstVisible < 0 ? own.message.content.length : firstVisible, 0, { type: 'text', text: `[Group message ${item.position}]\n${item.sender}\n` });
    own.metadata = { ...own.metadata, ...metadata };
  } else {
    if (entries.some(entry => entry.messageId === item.entry.messageId)) throw new AppError('invalid_context', 'Group identity already exists without incorporation state');
    entries.push({ ...structuredClone(item.entry), metadata: { ...item.entry.metadata, ...metadata } });
  }
}

/** One-time transition of legacy member context; stable records are never modified. */
export function adoptRecordedContext(agentId: string, groupId: string, existing: ContextEntry[], recorded: ContextEntry[], groups: GroupContextMessage[]): ContextEntry[] {
  const privateEntries = new Map<string, ContextEntry>();
  for (const entry of [...recorded, ...existing]) {
    if (entry.metadata.source === 'group-chat' || entry.metadata.source === 'member-context' || entry.metadata.source === 'member-context-error' || entry.metadata.source === 'interrupted-tool-result') continue;
    privateEntries.set(entry.messageId, structuredClone(entry));
  }
  // Merge in original private order, keeping a complete call/result exchange indivisible.
  const entries: ContextEntry[] = [], work = [...privateEntries.values()];
  let nextGroup = 0;
  const appendGroups = (through: number) => {
    while (nextGroup < groups.length) {
      const group = groups[nextGroup]!;
      if (group.entry.message.timestamp > through) break;
      if (group.origin?.agentId === agentId && privateEntries.has(group.origin.messageId) && !entries.some(entry => entry.messageId === group.origin!.messageId)) break;
      incorporate(entries, agentId, groupId, group); nextGroup++;
    }
  };
  for (let index = 0; index < work.length; index++) {
    const entry = work[index]!;
    appendGroups(entry.message.timestamp);
    entries.push(entry);
    if (entry.message.role === 'assistant' && entry.message.content.some(part => part.type === 'toolCall')) {
      while (work[index + 1]?.message.role === 'toolResult') entries.push(work[++index]!);
    }
  }
  appendGroups(Infinity);
  validateEntries(entries);
  return repairInterruptedTools(entries);
}

/** Missing results are context-only errors. Durable history and external effects are untouched. */
export function repairInterruptedTools(entries: ContextEntry[]): ContextEntry[] {
  const output: ContextEntry[] = [];
  let pending: { id: string; name: string }[] = [];
  const flush = () => {
    for (const call of pending) {
      const message: ToolResultMessage = { role: 'toolResult', toolCallId: call.id, toolName: call.name, isError: true, content: [{ type: 'text', text: 'Previous execution stopped before a result was recorded. The command may have had effects; inspect current state before deciding what to do. It was not replayed.' }], timestamp: Date.now() };
      output.push({ messageId: randomUUID(), message, metadata: { source: 'interrupted-tool-result' } });
    }
    pending = [];
  };
  for (const entry of entries) {
    if (entry.message.role === 'toolResult') {
      const callId = entry.message.toolCallId;
      pending = pending.filter(call => call.id !== callId);
      output.push(entry);
      continue;
    }
    flush();
    output.push(entry);
    if (entry.message.role === 'assistant') pending = entry.message.content.flatMap(part => part.type === 'toolCall' ? [{ id: part.id, name: part.name }] : []);
  }
  flush();
  return output;
}
