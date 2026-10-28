import type { JsonObject } from '@earendil-works/pi-ai';

/**
 * Utility base class for handlers that need durable state.
 * Handlers can extend this to maintain state across runs.
 * State is loaded once when the Agent initializes and persisted when updated.
 */
export class DurableHandlerState {
  private state: JsonObject;
  private revision: number;
  private persist: (revision: number, data: JsonObject) => Promise<JsonObject>;

  constructor(
    initialData: JsonObject,
    initialRevision: number,
    persist: (revision: number, data: JsonObject) => Promise<JsonObject>,
  ) {
    this.state = structuredClone(initialData);
    this.revision = initialRevision;
    this.persist = persist;
  }

  /**
   * Get the current state. Handlers should read/modify this during handle().
   */
  getState(): Readonly<JsonObject> {
    return this.state;
  }

  /**
   * Apply an update from the database after successful persistence.
   * This advances the in-memory state to match the durable record.
   */
  applyUpdate(revision: number, data: JsonObject): void {
    this.revision = revision;
    this.state = structuredClone(data);
  }

  /**
   * Persist the current state to the database.
   * Called by the handler's handle() method when state changes need to be saved.
   */
  async persistState(updates: Partial<JsonObject>): Promise<void> {
    const nextData: JsonObject = Object.assign({}, this.state);
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        nextData[key] = value;
      }
    }
    const acked = await this.persist(this.revision, nextData);
    this.revision = (acked as any).revision ?? this.revision + 1;
    this.state = structuredClone(acked);
  }
}
