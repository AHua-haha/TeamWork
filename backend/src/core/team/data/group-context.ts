import { AppError, identity, position } from '../../errors.js';
import { validateGroupContextEntry, type GroupContextEntry } from './group-chat.js';

export interface GroupContextHistory { position: number; resetPosition: number; entries: GroupContextEntry[] }
type Change = {append: GroupContextEntry; before: number} | {reset: number};

/** Team's model-facing shared transcript, independent of presentation and member context. */
export class GroupContextState {
  private value: GroupContextHistory;
  private valid = true;
  constructor(readonly workspaceId: string, history: GroupContextHistory) {
    identity(workspaceId); position(history.position); position(history.resetPosition);
    if (history.resetPosition > history.position) throw new AppError('corrupt_data', 'Invalid group reset boundary', 500);
    let after = history.resetPosition;
    const ids = new Set<string>();
    for (const entry of history.entries) {
      validateGroupContextEntry(entry);
      const order = Number(entry.metadata.groupPosition);
      if (entry.metadata.workspaceId !== workspaceId || order <= after || order > history.position || ids.has(entry.messageId))
        throw new AppError('corrupt_data', 'Invalid group context order or identity', 500);
      after = order; ids.add(entry.messageId);
    }
    this.value = structuredClone(history);
  }
  invalidate(): void { this.valid = false; }
  private assert(): void { if (!this.valid) throw new AppError('context_conflict', 'Group context acknowledgement is uncertain; restore before reading', 409); }
  read(after: number): GroupContextEntry[] {
    this.assert(); position(after);
    if (after > this.value.position) throw new AppError('invalid_cursor', 'Group consumption position is ahead of history', 409);
    const boundary = Math.max(after, this.value.resetPosition);
    let low = 0, high = this.value.entries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (Number(this.value.entries[mid]!.metadata.groupPosition) <= boundary) low = mid + 1;
      else high = mid;
    }
    return structuredClone(this.value.entries.slice(low));
  }
  apply(change: Change): void {
    this.assert();
    if ('reset' in change) {
      if (change.reset <= this.value.position) return;
      this.value = {position: change.reset, resetPosition: change.reset, entries: []};
    } else {
      const next = Number(change.append.metadata.groupPosition);
      if (next <= this.value.position) return;
      if (change.before !== this.value.position || next !== change.before + 1) throw new AppError('context_conflict', 'Group context acknowledgement is out of sequence', 409);
      validateGroupContextEntry(change.append);
      if (change.append.metadata.workspaceId !== this.workspaceId) throw new AppError('context_conflict', 'Group context workspace differs', 409);
      this.value.entries.push(structuredClone(change.append)); this.value.position = next;
    }
  }
}

interface Resident {model?: GroupContextState; pending: Change[]; invalid?: boolean; loading: Promise<GroupContextState>}
export class GroupContexts {
  private readonly residents = new Map<string, Resident>();
  get(id: string, load: () => Promise<GroupContextHistory>): Promise<GroupContextState> {
    const existing = this.residents.get(id);
    if (existing) return existing.loading;
    const resident: Resident = {pending: [], loading: undefined!};
    this.residents.set(id, resident);
    resident.loading = Promise.resolve().then(load).then(history => {
      if (resident.invalid) throw new AppError('context_conflict', 'Group context changed during uncertain acknowledgement', 409);
      const model = new GroupContextState(id, history);
      for (const change of resident.pending) model.apply(change);
      resident.model = model; resident.pending = []; return model;
    }).catch(error => {if (this.residents.get(id) === resident) this.residents.delete(id); throw error;});
    return resident.loading;
  }
  changed(id: string, change: Change): void {
    const resident = this.residents.get(id);
    if (!resident) return;
    if (!resident.model) {resident.pending.push(change); return;}
    try {resident.model.apply(change);} catch {this.invalidate(id);}
  }
  invalidate(id: string): void {
    const resident = this.residents.get(id);
    if (resident) {resident.invalid = true; resident.model?.invalidate(); this.residents.delete(id);}
  }
  clear(): void {for (const id of this.residents.keys()) this.invalidate(id);}
}
