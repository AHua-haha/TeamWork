import type { AssistantResponseHandler } from '../contracts.js';
import { AppError } from './model.js';

export interface HandlerUpdate {
  baseRevision: number;
  revision: number;
  handlerId: string;
  data: Record<string, unknown>;
}

interface Resident {
  handlers?: AssistantResponseHandler[];
  loading: Promise<AssistantResponseHandler[]>;
  pending: HandlerUpdate[];
  invalidated?: boolean;
}

/** Agent-owned memory for handler instances, shared by activations. One resident per agent. */
export class ResidentHandlers {
  private readonly entries = new Map<string, Resident>();

  /**
   * Get or load handler instances for an agent.
   * Handlers are loaded once and reused across runs.
   * @param id Agent ID
   * @param load Async function to load and initialize handler instances
   * @returns Promise resolving to the cached handler instances
   */
  get(id: string, load: () => Promise<AssistantResponseHandler[]>): Promise<AssistantResponseHandler[]> {
    const existing = this.entries.get(id);
    if (existing) return existing.loading;

    const resident: Resident = { pending: [], loading: undefined! };
    this.entries.set(id, resident);

    resident.loading = Promise.resolve()
      .then(load)
      .then((handlers) => {
        if (resident.invalidated) {
          throw new AppError('context_conflict', 'Handlers changed during an uncertain commit; restore before running', 409);
        }
        // Apply any pending updates accumulated while loading
        for (const update of resident.pending) {
          const handler = handlers.find((h) => (h as any).handlerId === update.handlerId);
          if (handler && typeof (handler as any).applyUpdate === 'function') {
            (handler as any).applyUpdate(update.revision, update.data);
          }
        }
        resident.pending = [];
        resident.handlers = handlers;
        return handlers;
      })
      .catch((error) => {
        if (this.entries.get(id) === resident) this.entries.delete(id);
        throw error;
      });

    return resident.loading;
  }

  /**
   * Signal that handler state has been updated.
   * Updates the resident handlers if already loaded, or queues for later application.
   */
  changed(id: string, update: HandlerUpdate): void {
    const resident = this.entries.get(id);
    if (!resident) return;

    if (!resident.handlers) {
      resident.pending.push(update);
      return;
    }

    // Update is already loaded; apply to the handler instance
    try {
      const handler = resident.handlers.find((h) => (h as any).handlerId === update.handlerId);
      if (handler && typeof (handler as any).applyUpdate === 'function') {
        (handler as any).applyUpdate(update.revision, update.data);
      }
    } catch {
      this.invalidate(id);
    }
  }

  /**
   * Invalidate resident handlers due to persistence failure or conflict.
   * The next activation will reload handlers from the database.
   */
  invalidate(id: string): void {
    const resident = this.entries.get(id);
    if (resident) {
      resident.invalidated = true;
      this.entries.delete(id);
    }
  }

  /** Clear all resident handlers. Used during runtime shutdown. */
  clear(): void {
    this.entries.clear();
  }
}
