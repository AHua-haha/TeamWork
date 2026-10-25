import { randomUUID } from 'node:crypto';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { validateEntries } from './validation.js';
import { AppError, type ContextEntry, type ContextHistory, type ContextPatch } from './model.js';

export type IncomingContextChange = {patch: ContextPatch} | {replace: ContextEntry[]};

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

  /** Ordinary delivery copies only changed entries, and never rebuilds durable context. */
  async changes(reference?: GroupContextReference): Promise<IncomingContextChange | undefined> {
    const original = this.history.entries;
    const entries = repairInterruptedTools([...original]);
    // An explicitly restored malformed exchange can need repair inside the old prefix.
    const replacement = !original.every((entry, index) => entries[index] === entry);
    const updates = new Map<string, ContextEntry>();
    if (reference) {
      let after = 0;
      for (const entry of entries) if (entry.metadata.groupContextId === reference.id) {
        const value = entry.metadata.groupPosition;
        if (!Number.isSafeInteger(value) || Number(value) < 1) throw new AppError('invalid_context', 'Invalid incorporated group position');
        after = Math.max(after, Number(value));
      }
      for (const item of await reference.read(after)) {
        if (!Number.isSafeInteger(item.position) || item.position <= after) throw new AppError('invalid_context', 'Group messages must be strictly ordered after the requested position');
        const ownIndex = item.origin?.agentId === this.agentId ? entries.findIndex(entry => entry.messageId === item.origin!.messageId && entry.message.role === 'assistant') : -1;
        if (ownIndex >= 0) entries[ownIndex] = structuredClone(entries[ownIndex]!);
        incorporate(entries, this.agentId, reference.id, item);
        if (ownIndex >= 0 && ownIndex < original.length) updates.set(entries[ownIndex]!.messageId, entries[ownIndex]!);
        after = item.position;
      }
    }
    if (replacement) return {replace: entries};
    const patch = {append: entries.slice(original.length), update: [...updates.values()]};
    return patch.append.length || patch.update.length ? {patch} : undefined;
  }

  async incoming(reference?: GroupContextReference): Promise<ContextEntry[] | undefined> {
    const change = await this.changes(reference);
    if (!change) { validateEntries(this.history.entries); return undefined; }
    const updates = 'patch' in change ? new Map(change.patch.update.map(entry => [entry.messageId, entry])) : undefined;
    const entries = 'replace' in change ? change.replace
      : [...this.history.entries.map(entry => updates!.get(entry.messageId) ?? entry), ...change.patch.append];
    validateEntries(entries);
    return structuredClone(entries);
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
