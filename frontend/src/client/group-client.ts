import { BackendError, waitForRetry } from './agent-client.js';
import { ProtocolError, readSse } from './sse.js';
import type { RunState } from './protocol.js';

export interface FinalReference { agentId: string; runId: string; messageId: string; position: number }
interface EntryBase { workspaceId: string; entryId: string; position: number; revision: number; exchangeId: string; time: number }
export type GroupEntry = EntryBase & (
  | { kind: 'user'; text: string; messageId: string }
  | { kind: 'member'; memberId: string; name: string; run: RunState; working: { after: number; through: number | null }; finalRef: FinalReference | null; text: string | null }
);
export interface GroupChange { cursor: number; entry: GroupEntry }
export interface GroupSnapshot {
  entries: readonly GroupEntry[]; cursor: number; synchronized: boolean;
  connection: 'syncing' | 'following' | 'disconnected' | 'error';
  sending: boolean; stopping: boolean; error: string | null; commandError: string | null;
}
const id = /^[A-Za-z0-9_-]{1,64}$/;
const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
export function validateEntry(value: unknown, workspaceId: string): asserts value is GroupEntry {
  const entry = value as GroupEntry | null;
  if (!entry || entry.workspaceId !== workspaceId || !id.test(entry.entryId) || !positive(entry.position) || !positive(entry.revision)
    || !id.test(entry.exchangeId) || !Number.isFinite(entry.time)) throw new ProtocolError('Invalid group entry');
  if (entry.kind === 'user') {
    if (typeof entry.text !== 'string' || !id.test(entry.messageId)) throw new ProtocolError('Invalid user entry');
  } else if (entry.kind === 'member') {
    if (!id.test(entry.memberId) || typeof entry.name !== 'string' || !entry.name || !entry.run || entry.run.agentId !== entry.memberId || !id.test(entry.run.runId)
      || !['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(entry.run.status)
      || !entry.working || !Number.isSafeInteger(entry.working.after) || entry.working.after < 0
      || (entry.working.through !== null && (!Number.isSafeInteger(entry.working.through) || entry.working.through < entry.working.after))
      || (entry.text !== null && typeof entry.text !== 'string')) throw new ProtocolError('Invalid member entry');
    if (entry.finalRef && (entry.finalRef.agentId !== entry.memberId || entry.finalRef.runId !== entry.run.runId || !id.test(entry.finalRef.messageId) || !positive(entry.finalRef.position) || entry.text === null)) throw new ProtocolError('Invalid final reference');
  } else throw new ProtocolError('Unsupported group entry');
}
async function json(response: Response): Promise<unknown> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
    throw new BackendError(payload?.error?.message ?? `Request failed (${response.status})`, response.status, payload?.error?.code ?? 'http_error');
  }
  return response.json();
}

/** Display order and contiguous update cursor are independent. POST acknowledgements never advance the cursor. */
export class GroupClient {
  private entries = new Map<string, GroupEntry>();
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private generation = 0;
  private disposed = false;
  private snapshot: GroupSnapshot = { entries: [], cursor: 0, synchronized: false, connection: 'syncing', sending: false, stopping: false, error: null, commandError: null };
  private readonly fetcher: typeof fetch;
  private readonly retryDelay: (attempt: number) => number;
  private readonly path: string;
  constructor(readonly workspaceId: string, options: { fetcher?: typeof fetch; retryDelayMs?: (attempt: number) => number } = {}) {
    if (!id.test(workspaceId)) throw new Error('Invalid workspace identity');
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.retryDelay = options.retryDelayMs ?? (attempt => Math.min(500 * 2 ** Math.min(attempt, 4), 8000));
    this.path = `/workspaces/${workspaceId}/team/chat`;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<GroupSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...patch, entries: [...this.entries.values()].sort((a, b) => a.position - b.position) };
    for (const listener of this.listeners) listener();
  }
  private merge(entry: GroupEntry) {
    validateEntry(entry, this.workspaceId);
    if ([...this.entries.values()].some(item => item.position === entry.position && item.entryId !== entry.entryId)) throw new ProtocolError('Group position has conflicting entries');
    const previous = this.entries.get(entry.entryId);
    if (previous && (previous.position !== entry.position || previous.kind !== entry.kind)) throw new ProtocolError('Group entry identity changed');
    if (!previous || previous.revision < entry.revision) this.entries.set(entry.entryId, entry);
  }
  follow() {
    if (this.disposed) return;
    this.controller?.abort();
    const controller = new AbortController(); this.controller = controller;
    const generation = ++this.generation;
    this.publish({ connection: 'syncing', synchronized: false, error: null });
    void this.listen(controller.signal, generation);
  }
  refresh = () => this.follow();
  private async listen(signal: AbortSignal, generation: number) {
    let attempt = 0;
    while (!signal.aborted && generation === this.generation) {
      try {
        const response = await this.fetcher(`${this.path}/timeline-follow?after=${this.snapshot.cursor}`, { signal, headers: { Accept: 'text/event-stream' } });
        if (!response.ok) await json(response);
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new ProtocolError('Expected group SSE stream');
        for await (const frame of readSse(response.body)) {
          if (signal.aborted || generation !== this.generation) return;
          if (frame.name === 'stream_error') throw new Error('Group updates interrupted by backend');
          let event;
          try { event = JSON.parse(frame.data); } catch { throw new ProtocolError('Invalid group event JSON'); }
          if (!event || typeof event !== 'object' || event.version !== 1 || event.workspaceId !== this.workspaceId || event.type !== frame.name) throw new ProtocolError('Invalid group event envelope');
          if (event.type === 'entry') {
            const change = event.change as GroupChange;
            if (!change || !positive(change.cursor) || change.entry?.revision !== change.cursor) throw new ProtocolError('Invalid group change');
            if (change.cursor <= this.snapshot.cursor) continue;
            if (change.cursor !== this.snapshot.cursor + 1) throw new ProtocolError('Group changes have a gap');
            this.merge(change.entry); this.publish({ cursor: change.cursor });
          } else if (event.type === 'sync') {
            if (event.cursor !== this.snapshot.cursor) throw new ProtocolError('Group history did not reach synchronization cursor');
            attempt = 0; this.publish({ synchronized: true, connection: 'following', error: null });
          } else if (event.type !== 'settings') throw new ProtocolError('Unsupported group event');
        }
        throw new Error('Group connection closed');
      } catch (error) {
        if (signal.aborted || generation !== this.generation) return;
        const fatal = error instanceof ProtocolError || (error instanceof BackendError && error.status < 500);
        this.publish({ synchronized: false, connection: fatal ? 'error' : 'disconnected', error: error instanceof Error ? error.message : 'Group connection failed' });
        if (fatal) return;
        await waitForRetry(this.retryDelay(attempt++), signal);
      }
    }
  }
  async send(text: string) {
    if (this.disposed || this.snapshot.sending) throw new Error('Group submission is unavailable');
    if (!text.trim()) throw new Error('Enter a message');
    this.publish({ sending: true, commandError: null });
    try {
      const accepted = await json(await this.fetcher(`${this.path}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })) as { entries?: GroupEntry[] };
      if (!Array.isArray(accepted.entries)) throw new ProtocolError('Missing reserved group entries');
      for (const entry of accepted.entries) this.merge(entry);
      this.publish();
    } catch (error) { this.publish({ commandError: error instanceof Error ? error.message : 'Message refused' }); throw error; }
    finally { this.publish({ sending: false }); }
  }
  async stop() {
    if (this.snapshot.stopping) return;
    this.publish({ stopping: true, commandError: null });
    try { await json(await this.fetcher(`${this.path}/stop`, { method: 'POST' })); }
    catch (error) { this.publish({ commandError: error instanceof Error ? error.message : 'Stop failed' }); }
    finally { this.publish({ stopping: false }); }
  }
  dispose() { this.disposed = true; this.generation++; this.controller?.abort(); this.listeners.clear(); }
}
