import type { JsonObject } from '@earendil-works/pi-ai';
import type { ReactHarness } from '../contracts.js';
import { AppError } from './model.js';

export interface ReactHarnessUpdate {
  baseRevision: number;
  revision: number;
  harnessId: string;
  data: JsonObject;
}

interface Resident {
  harnesses?: ReactHarness[];
  loading: Promise<ReactHarness[]>;
  pending: ReactHarnessUpdate[];
  invalidated?: boolean;
}

/** Agent-owned memory for harness instances, shared by activations. One resident per agent. */
export class ResidentHarnesses {
  private readonly entries = new Map<string, Resident>();

  /**
   * Get or load harness instances for an agent.
   * React Harnesses are loaded once and reused across runs.
   * @param id Agent ID
   * @param load Async function to load and initialize harness instances
   * @returns Promise resolving to the cached harness instances
   */
  get(id: string, load: () => Promise<ReactHarness[]>): Promise<ReactHarness[]> {
    const existing = this.entries.get(id);
    if (existing) return existing.loading;

    const resident: Resident = { pending: [], loading: undefined! };
    this.entries.set(id, resident);

    resident.loading = Promise.resolve()
      .then(load)
      .then((harnesses) => {
        if (resident.invalidated) {
          throw new AppError('context_conflict', 'React Harnesses changed during an uncertain commit; restore before running', 409);
        }
        // Apply any pending updates accumulated while loading
        for (const update of resident.pending) {
          const harness = harnesses.find((h) => h.harnessId === update.harnessId);
          if (harness && typeof harness.applyUpdate === 'function') {
            harness.applyUpdate(update.revision, update.data);
          }
        }
        resident.pending = [];
        resident.harnesses = harnesses;
        return harnesses;
      })
      .catch((error) => {
        if (this.entries.get(id) === resident) this.entries.delete(id);
        throw error;
      });

    return resident.loading;
  }

  /**
   * Signal that harness state has been updated.
   * Updates the resident harnesses if already loaded, or queues for later application.
   */
  changed(id: string, update: ReactHarnessUpdate): void {
    const resident = this.entries.get(id);
    if (!resident) return;

    if (!resident.harnesses) {
      resident.pending.push(update);
      return;
    }

    // Update is already loaded; apply to the harness instance
    try {
      const harness = resident.harnesses.find((h) => h.harnessId === update.harnessId);
      if (harness && typeof harness.applyUpdate === 'function') {
        harness.applyUpdate(update.revision, update.data);
      }
    } catch {
      this.invalidate(id);
    }
  }

  /**
   * Invalidate resident harnesses due to persistence failure or conflict.
   * The next activation will reload harnesses from the database.
   */
  invalidate(id: string): void {
    const resident = this.entries.get(id);
    if (resident) {
      resident.invalidated = true;
      this.entries.delete(id);
    }
  }

  /** Clear all resident harnesses. Used during runtime shutdown. */
  clear(): void {
    this.entries.clear();
  }
}
