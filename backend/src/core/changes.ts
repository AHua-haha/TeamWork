/** A versioned in-process notification. Waiters compare the version they read before checking state, so no publish is lost. */
export class Changes {
  version = 0;
  private listeners = new Set<() => void>();
  publish(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
  wait(version: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || version !== this.version) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => {
        this.listeners.delete(done);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      this.listeners.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}
