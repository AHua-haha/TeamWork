import {countedMessage,userInput} from './input.js';
import { validateEntries, validateRun } from './validation.js';
import { AppError, position, type CompletedMessage, type ContextEntry, type ContextHistory, type ContextPatch, type ContextMetadataUpdate, type RunState } from './model.js';

/** One mutable context per loaded agent, independent of any activation. */
export class AgentContextState {
    private value: ContextHistory;
    private invalid = false;
    private readonly indices = new Map<string, number>();
    private readonly inputs=new Set<string>();
    constructor(context: ContextHistory) { this.value = {revision: 0, entries: []}; this.replace(context); }
    get history(): ContextHistory {
        if (this.invalid) throw new AppError('context_conflict', 'Resident context acknowledgement is out of sequence; restore context before running', 409);
        return this.value;
    }
    invalidate(): void { this.invalid = true; }
    replace(context: ContextHistory): void {
        validateEntries(context.entries);
        position(context.revision);
        const previous=this.value;
        const count=context.messageCount ?? ((previous?.messageCount??0)+context.entries.filter(entry=>!this.indices.has(entry.messageId)).reduce((sum,entry)=>sum+countedMessage(entry),0));
        position(count);
        this.value = {...structuredClone(context),messageCount:count};
        this.invalid = false;
        this.indices.clear();
        this.inputs.clear();
        this.value.entries.forEach((entry,index)=>{this.indices.set(entry.messageId,index);if(userInput(entry)&&entry.metadata.reactInputHandled!==true)this.inputs.add(entry.messageId);});
    }
    append(entry: ContextEntry): void {
        void this.history;
        if (this.indices.has(entry.messageId)) return; // A durable observer may already have acknowledged it.
        validateEntries([entry]);
        this.indices.set(entry.messageId, this.value.entries.length);
        this.value.entries.push(structuredClone(entry));
        this.value.messageCount=(this.value.messageCount??0)+countedMessage(entry);
        if(userInput(entry)&&entry.metadata.reactInputHandled!==true)this.inputs.add(entry.messageId);
        this.value.revision++;
    }
    entry(messageId: string): ContextEntry | undefined {
        void this.history;
        const index = this.indices.get(messageId);
        return index === undefined ? undefined : this.value.entries[index];
    }
    pendingInputs():ContextEntry[]{return [...this.inputs].flatMap(id=>this.entry(id)??[]);}
    updateMetadata(updates: ContextMetadataUpdate[]): void {
        for (const update of updates) {
            const entry = this.entry(update.messageId);
            if (!entry) throw new AppError('context_conflict', 'Context entry no longer exists', 409);
            entry.metadata = structuredClone(update.metadata);
            if(userInput(entry)&&entry.metadata.reactInputHandled!==true)this.inputs.add(entry.messageId);else this.inputs.delete(entry.messageId);
        }
    }
    patch(revision: number, patch: ContextPatch): void {
        void this.history;
        this.updateMetadata(patch.metadata ?? []);
        for (const entry of patch.update) {
            const index = this.indices.get(entry.messageId);
            if (index === undefined) throw new AppError('context_conflict', 'Context entry no longer exists', 409);
            this.value.entries[index] = structuredClone(entry);
            if(userInput(entry)&&entry.metadata.reactInputHandled!==true)this.inputs.add(entry.messageId);else this.inputs.delete(entry.messageId);
        }
        for (const entry of patch.append) this.append(entry);
        this.value.revision = revision;
    }
}
/** Mutable execution model. Durable records use the same owner-defined values. */
export class AgentState {
    private currentContext: AgentContextState;
    private currentRun: RunState;
    private currentPosition: number;
    constructor(run: RunState, context: ContextHistory | AgentContextState, historyPosition: number) {
        validateRun(run);
        position(historyPosition);
        this.currentRun = structuredClone(run);
        this.currentContext = context instanceof AgentContextState ? context : new AgentContextState(context);
        this.currentPosition = historyPosition;
    }
    get contextModel() { return this.currentContext; }
    get context() { return this.currentContext.history; }
    get run() { return this.currentRun; }
    get historyPosition() { return this.currentPosition; }
    attachContext(context: AgentContextState): void { this.currentContext = context; }
    patchContext(revision: number, patch: ContextPatch): void { this.currentContext.patch(revision, patch); }
    acceptContext(context: ContextHistory): void { this.currentContext.replace(context); }
    acceptRun(run: RunState): void { validateRun(run); this.currentRun = structuredClone(run); }
    acceptPosition(value: number): void { position(value); this.currentPosition = value; }
    receive(record: CompletedMessage): void {
        if (record.agentId !== this.currentRun.agentId || record.runId !== this.currentRun.runId)
            throw new AppError('invalid_input', 'Message belongs to another execution');
        validateEntries([record]);
        this.currentContext.append({ messageId: record.messageId, message: record.message, metadata: record.metadata });
        this.currentPosition = record.position;
        if (record.messageId === this.currentRun.activeMessageId)
            this.currentRun = { ...this.currentRun, activeMessageId: null, phase: 'tools' };
    }
    snapshot() { return structuredClone({ run: this.currentRun, context: this.context, historyPosition: this.currentPosition }); }
}
