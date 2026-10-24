import { validateEntries, validateRun } from './validation.js';
import { AppError, position, type CompletedMessage, type ContextHistory, type RunState } from './model.js';
/** Mutable execution model. Durable records use the same owner-defined values. */
export class AgentState {
    private currentContext: ContextHistory;
    private currentRun: RunState;
    private currentPosition: number;
    constructor(run: RunState, context: ContextHistory, historyPosition: number) {
        validateRun(run);
        validateEntries(context.entries);
        position(historyPosition);
        this.currentRun = structuredClone(run);
        this.currentContext = structuredClone(context);
        this.currentPosition = historyPosition;
    }
    get context() { return this.currentContext; }
    get run() { return this.currentRun; }
    get historyPosition() { return this.currentPosition; }
    acceptContext(context: ContextHistory): void { validateEntries(context.entries); this.currentContext = structuredClone(context); }
    acceptRun(run: RunState): void { validateRun(run); this.currentRun = structuredClone(run); }
    acceptPosition(value: number): void { position(value); this.currentPosition = value; }
    receive(record: CompletedMessage): void {
        if (record.agentId !== this.currentRun.agentId || record.runId !== this.currentRun.runId)
            throw new AppError('invalid_input', 'Message belongs to another execution');
        validateEntries([record]);
        this.currentContext.entries.push(structuredClone({ messageId: record.messageId, message: record.message, metadata: record.metadata }));
        this.currentContext.revision++;
        this.currentPosition = record.position;
        if (record.messageId === this.currentRun.activeMessageId)
            this.currentRun = { ...this.currentRun, activeMessageId: null, phase: 'tools' };
    }
    snapshot() { return structuredClone({ run: this.currentRun, context: this.currentContext, historyPosition: this.currentPosition }); }
}
