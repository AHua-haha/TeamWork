import type { ContextEntry, ContextHistory, ContextPatch } from './model.js';
import { AgentContextState } from './state.js';
import { AppError } from './model.js';

export type ContextChange = {baseRevision: number; revision: number; messageCount?:number} & (
    | {replace: ContextEntry[]}
    | {patch: ContextPatch}
);
interface Resident {
    model?: AgentContextState;
    loading: Promise<AgentContextState>;
    pending: ContextChange[];
    invalidated?: boolean;
}

/** Agent-owned memory, shared by transaction-scoped repository views. */
export class ResidentContexts {
    private readonly entries = new Map<string, Resident>();
    get(id: string, load: () => Promise<ContextHistory>): Promise<AgentContextState> {
        const existing = this.entries.get(id);
        if (existing) return existing.loading;
        const resident: Resident = {pending: [], loading: undefined!};
        this.entries.set(id, resident);
        resident.loading = Promise.resolve().then(load).then(history => {
            if (resident.invalidated) throw new AppError('context_conflict', 'Context changed during an uncertain commit; restore before running', 409);
            const model = new AgentContextState(history);
            for (const change of resident.pending) this.apply(model, change);
            resident.pending = [];
            resident.model = model;
            return model;
        }).catch(error => {
            if (this.entries.get(id) === resident) this.entries.delete(id);
            throw error;
        });
        return resident.loading;
    }
    changed(id: string, change: ContextChange): void {
        const resident = this.entries.get(id);
        if (!resident) return;
        if (!resident.model) { resident.pending.push(change); return; }
        // Invalid/missed acknowledgement is an exceptional reload, never speculative state.
        try { this.apply(resident.model, change); }
        catch { this.invalidate(id); }
    }
    invalidate(id: string): void {
        const resident = this.entries.get(id);
        if (resident) { resident.invalidated = true; resident.model?.invalidate(); this.entries.delete(id); }
    }
    private apply(model: AgentContextState, change: ContextChange): void {
        if (change.revision <= model.history.revision) return;
        if (change.baseRevision !== model.history.revision) throw new Error('Resident context revision gap');
        if ('replace' in change) model.replace({revision: change.revision, entries: change.replace,messageCount:change.messageCount});
        else model.patch(change.revision, change.patch);
    }
    clear(): void { this.entries.clear(); }
}
