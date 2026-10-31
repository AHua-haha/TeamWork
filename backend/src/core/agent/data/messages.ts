import {randomUUID} from 'node:crypto';
import type {JsonObject, Message, ToolCall, ToolResultMessage} from '@earendil-works/pi-ai';
import {AgentContextState, AgentState} from './state.js';
import {validateEntries} from './validation.js';
import {compactionAcknowledgement, type CompactionTrigger} from './compaction.js';
import {AppError, type CompletedMessage, type ContextEntry, type ContextHistory, type ContextMetadataUpdate, type ContextPatch, type ComponentMessageEffects} from './model.js';

/** Data-model persistence acknowledgements; usable with SQL hosting or an in-memory Agent. */
export interface AgentMessagePersistence {
  message?(record: CompletedMessage): Promise<CompletedMessage | void>;
  componentMessage?(record: CompletedMessage, effects: ComponentMessageEffects): Promise<CompletedMessage>;
  contextChanged?(revision: number, entries: ContextEntry[]): Promise<ContextHistory | void>;
  contextPatched?(revision: number, patch: ContextPatch,effects?:ComponentMessageEffects): Promise<void>;
  compactionMessage?(record: CompletedMessage): Promise<CompletedMessage | void>;
  compactionMetadata?(id: string, updates: ContextMetadataUpdate[]): Promise<void>;
}
interface Preparation {id: string; trigger: CompactionTrigger; context: AgentContextState}

/** Owner of acknowledged message/context operations, shared directly with React Harnesses. */
export class AgentMessageData {
  readonly trace: ContextEntry[] = [];
  readonly metadataChanges = new Map<string, ContextMetadataUpdate>();
  private readonly traceById = new Map<string, ContextEntry>();
  constructor(private readonly state: AgentState, private readonly persistence: AgentMessagePersistence = {}, private readonly changed: () => void = () => {}, private readonly preparation?: Preparation) {}
  get context(): AgentContextState {return this.preparation?.context ?? this.state.contextModel;}
  entry(id: string): ContextEntry | undefined {const entry = this.context.entry(id); return entry ? structuredClone(entry) : undefined;}
  prepare(id: string, trigger: CompactionTrigger, context: AgentContextState): AgentMessageData {
    return new AgentMessageData(this.state, this.persistence, this.changed, {id, trigger, context});
  }
  async append(entry: ContextEntry, effects?: ComponentMessageEffects): Promise<CompletedMessage> {
    validateEntries([entry]);
    const preparation = this.preparation;
    const value = preparation ? {...structuredClone(entry), metadata: {...entry.metadata, source: 'context-compaction', compactionId: preparation.id, trigger: preparation.trigger}} : entry;
    const run = this.state.run;
    const proposed = {...value, agentId: run.agentId, runId: run.runId, position: this.state.historyPosition + 1};
    if (effects && (preparation ? this.persistence.compactionMessage : this.persistence.message) && !this.persistence.componentMessage) throw new AppError('invalid_config', 'Related message/state updates require atomic persistence');
    const persist = () => effects ? this.persistence.componentMessage?.(structuredClone(proposed), effects) : preparation ? this.persistence.compactionMessage?.(structuredClone(proposed)) : this.persistence.message?.(structuredClone(proposed));
    const saved = (preparation ? await compactionAcknowledgement(persist) : await persist()) ?? proposed;
    if (preparation) {
      const retained = {messageId: saved.messageId, message: saved.message, metadata: saved.metadata};
      this.trace.push(retained); this.traceById.set(retained.messageId, retained);
      this.context.append(retained); this.state.acceptPosition(saved.position);
    } else this.state.receive(saved);
    if (effects) this.applyMetadata(effects.metadataUpdates);
    this.changed();
    return structuredClone(saved);
  }
  private applyMetadata(updates: ContextMetadataUpdate[]): void {
    this.context.updateMetadata(updates);
    if (this.preparation) for (const update of updates) {
      this.metadataChanges.set(update.messageId, structuredClone(update));
      const retained = this.traceById.get(update.messageId);
      if (retained) retained.metadata = structuredClone(update.metadata);
    }
  }
  async patch(patch: ContextPatch): Promise<void> {
    if (this.preparation) throw new AppError('context_conflict', 'Preparation supports targeted metadata changes, not arbitrary context replacement');
    const revision = this.context.history.revision;
    if (this.persistence.contextPatched) {
      await this.persistence.contextPatched(revision, patch);
      this.context.patch(revision + 1, patch);
    } else if (this.persistence.contextChanged) {
      const next = new AgentContextState(this.context.history); next.patch(revision + 1, patch);
      await this.replace(revision, next.history.entries);
    } else this.context.patch(revision + 1, patch);
  }
  async replace(revision: number, entries: ContextEntry[]): Promise<ContextHistory> {
    if (this.preparation) throw new AppError('context_conflict', 'Preparation context is replaced only at the compaction boundary');
    validateEntries(entries);
    if (revision !== this.context.history.revision) throw new AppError('context_conflict', 'Context revision changed', 409);
    const proposed = {revision: revision + 1, entries: structuredClone(entries)};
    this.context.replace(await this.persistence.contextChanged?.(revision, entries) ?? proposed);
    return structuredClone(this.context.history);
  }
  async updateMetadata(updates: ContextMetadataUpdate[]): Promise<void> {
    if (!updates.length) return;
    const ids = new Set<string>();
    for (const update of updates) {
      if (!update.messageId || ids.has(update.messageId)) throw new AppError('invalid_context_update', 'Context metadata updates require unique message identities');
      ids.add(update.messageId);
      if (!this.context.entry(update.messageId)) throw new AppError('invalid_context_update', `Context entry not found: ${update.messageId}`);
    }
    if (this.preparation) {
      if ((this.persistence.compactionMessage || this.persistence.componentMessage) && !this.persistence.compactionMetadata) throw new AppError('invalid_config', 'Durable preparation metadata requires journal persistence');
      await compactionAcknowledgement(() => this.persistence.compactionMetadata?.(this.preparation!.id, structuredClone(updates)));
      this.applyMetadata(updates);
    } else await this.patch({append: [], update: [], metadata: updates});
  }
}

/** One assistant turn's paired results and deferred private instructions are Agent-owned data. */
export class AgentTurnData {
  readonly calls: ToolCall[];
  private readonly results = new Map<string, ToolResultMessage>();
  private readonly instructions: Array<{message: Message; metadata: JsonObject}> = [];
  constructor(readonly messages: AgentMessageData, readonly assistant: CompletedMessage, private readonly metadata: (message: Message) => JsonObject = () => ({})) {
    this.calls = assistant.message.role === 'assistant' ? assistant.message.content.filter(part => part.type === 'toolCall') : [];
    if (new Set(this.calls.map(call => call.id)).size !== this.calls.length) throw new AppError('invalid_tool_calls', 'Duplicate tool-call identity');
  }
  entry(id: string): ContextEntry | undefined {return this.messages.entry(id);}
  hasResult(id: string): boolean {return this.results.has(id);}
  result(id: string): ToolResultMessage | undefined {const value = this.results.get(id); return value ? structuredClone(value) : undefined;}
  async recordToolResult(call: ToolCall, output: Pick<ToolResultMessage, 'content'|'isError'|'details'>, metadata: JsonObject = {}, commit?: {messageId?: string; effects?: ComponentMessageEffects}): Promise<ToolResultMessage> {
    const known = this.calls.find(candidate => candidate.id === call.id);
    if (!known || known.name !== call.name) throw new AppError('invalid_tool_calls', `Unknown tool-call identity: ${call.id}`);
    const existing = this.result(call.id); if (existing) return existing;
    const result: ToolResultMessage = {...output, role: 'toolResult', toolCallId: call.id, toolName: call.name, timestamp: Date.now()};
    await this.messages.append({messageId: commit?.messageId ?? randomUUID(), message: result, metadata: {...this.metadata(result), ...metadata}}, commit?.effects);
    this.results.set(call.id, result);
    return structuredClone(result);
  }
  appendInstruction(message: Message, metadata: JsonObject = {}): void {this.instructions.push({message: structuredClone(message), metadata: {...structuredClone(metadata),runtimeGenerated:true}});}
  updateMetadata(updates: ContextMetadataUpdate[]): Promise<void> {return this.messages.updateMetadata(updates);}
  orderedResults(): ToolResultMessage[] {return this.calls.flatMap(call => this.result(call.id) ?? []);}
  async flushInstructions(): Promise<void> {
    if (this.results.size !== this.calls.length) throw new AppError('invalid_tool_calls', 'Every tool call requires a result before private instructions');
    for (const instruction of this.instructions) await this.messages.append({messageId: randomUUID(), ...instruction});
    this.instructions.length = 0;
  }
}
