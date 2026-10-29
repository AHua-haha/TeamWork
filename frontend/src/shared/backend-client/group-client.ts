import { apiFetch, apiUrl } from './transport.js';
import { BackendError, waitForRetry } from './agent-client.js';
import { ProtocolError, readSse } from './sse.js';
import type { RunState } from './protocol.js';

export interface ChatImage { id: string; name: string; mimeType: string; width: number; height: number; size: number }
export const imageUrl = (workspaceId: string, imageId: string) => apiUrl(`/workspaces/${encodeURIComponent(workspaceId)}/chat/attachments/${encodeURIComponent(imageId)}`);
export interface FinalReference { agentId: string; runId: string; messageId: string; position: number; contentIndices?: number[]; bodyOffset?: number; toolCallId?: string }
interface EntryBase { workspaceId: string; entryId: string; position: number; revision: number; exchangeId: string; time: number }
export type GroupEntry = EntryBase & (
  | { kind: 'user'; text: string; messageId: string; attachments?: ChatImage[] }
  | { kind: 'member'; memberId: string; name: string; run: RunState; working: { after: number; through: number | null }; finalRef: FinalReference | null; text: string | null }
);
export interface GroupHistoryPage {
  workspaceId: string; cursor: number; resetCursor: number; entries: GroupEntry[];
  nextBefore: number | null; hasOlder: boolean;
}
export interface GroupChange { cursor: number; entry: GroupEntry }
export interface GroupSnapshot {
  entries: readonly GroupEntry[]; cursor: number; resetCursor: number; synchronized: boolean;
  connection: 'syncing' | 'following' | 'disconnected' | 'error';
  initialized: boolean; hasOlder: boolean; nextBefore: number | null; loadingOlder: boolean; historyError: string | null;
  sending: boolean; stopping: boolean; resetting: boolean; error: string | null; commandError: string | null;
}
const id = /^[A-Za-z0-9_-]{1,64}$/;
const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
export function validateEntry(value: unknown, workspaceId: string): asserts value is GroupEntry {
  const entry = value as GroupEntry | null;
  if (!entry || entry.workspaceId !== workspaceId || !id.test(entry.entryId) || !positive(entry.position) || !positive(entry.revision)
    || !id.test(entry.exchangeId) || !Number.isFinite(entry.time)) throw new ProtocolError('Invalid group entry');
  if (entry.kind === 'user') {
    if (entry.attachments !== undefined && (!Array.isArray(entry.attachments) || entry.attachments.length > 4 || entry.attachments.some(image => !image || !id.test(image.id) || typeof image.name !== 'string' || !['image/png', 'image/jpeg'].includes(image.mimeType) || ![image.width, image.height, image.size].every(n => Number.isSafeInteger(n) && n > 0)) || new Set(entry.attachments.map(image => image.id)).size !== entry.attachments.length)) throw new ProtocolError('Invalid picture attachment');
    if (typeof entry.text !== 'string' || !id.test(entry.messageId)) throw new ProtocolError('Invalid user entry');
  } else if (entry.kind === 'member') {
    if (!id.test(entry.memberId) || typeof entry.name !== 'string' || !entry.name || !entry.run || entry.run.agentId !== entry.memberId || !id.test(entry.run.runId)
      || !['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(entry.run.status)
      || !entry.working || !Number.isSafeInteger(entry.working.after) || entry.working.after < 0
      || (entry.working.through !== null && (!Number.isSafeInteger(entry.working.through) || entry.working.through < entry.working.after))
      || (entry.text !== null && typeof entry.text !== 'string')) throw new ProtocolError('Invalid member entry');
    if (entry.finalRef && (entry.finalRef.agentId !== entry.memberId || entry.finalRef.runId !== entry.run.runId || !id.test(entry.finalRef.messageId) || !positive(entry.finalRef.position) || entry.text === null)) throw new ProtocolError('Invalid final reference');
    const indices = entry.finalRef?.contentIndices;
    if (indices !== undefined && (!Array.isArray(indices) || !indices.length || indices.some((value, index) => !Number.isSafeInteger(value) || value < 0 || (index > 0 && value <= indices[index - 1]!)) || entry.finalRef?.toolCallId !== undefined)) throw new ProtocolError('Invalid final text selection');
    const offset = entry.finalRef?.bodyOffset;
    if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0 || indices === undefined || entry.finalRef?.toolCallId !== undefined)) throw new ProtocolError('Invalid final body offset');
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
  private historyEpoch = 0;
  private olderController?: AbortController;
  private pendingOlderUpdates?: Map<string, GroupEntry>;
  private windowStart = 0;
  private disposed = false;
  private snapshot: GroupSnapshot = { entries: [], cursor: 0, resetCursor: 0, synchronized: false, connection: 'syncing', initialized: false, hasOlder: false, nextBefore: null, loadingOlder: false, historyError: null, sending: false, stopping: false, resetting: false, error: null, commandError: null };
  private readonly fetcher: typeof fetch;
  private readonly retryDelay: (attempt: number) => number;
  private readonly path: string;
  constructor(readonly workspaceId: string, options: { fetcher?: typeof fetch; retryDelayMs?: (attempt: number) => number } = {}) {
    if (!id.test(workspaceId)) throw new Error('Invalid workspace identity');
    this.fetcher = options.fetcher ?? apiFetch;
    this.retryDelay = options.retryDelayMs ?? (attempt => Math.min(500 * 2 ** Math.min(attempt, 4), 8000));
    this.path = `/workspaces/${workspaceId}/chat`;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<GroupSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...patch, entries: [...this.entries.values()].sort((a, b) => a.position - b.position) };
    for (const listener of this.listeners) listener();
  }
  private merge(entry: GroupEntry, target = this.entries) {
    validateEntry(entry, this.workspaceId);
    if (entry.revision <= this.snapshot.resetCursor) return;
    if ([...target.values()].some(item => item.position === entry.position && item.entryId !== entry.entryId)) throw new ProtocolError('Group position has conflicting entries');
    const previous = target.get(entry.entryId);
    if (previous && (previous.position !== entry.position || previous.kind !== entry.kind)) throw new ProtocolError('Group entry identity changed');
    if (!previous || previous.revision < entry.revision) target.set(entry.entryId, entry);
  }
  private inWindow(entry: GroupEntry) {
    return this.entries.has(entry.entryId) || entry.position >= this.windowStart;
  }
  private cancelOlder() {
    this.historyEpoch++;
    this.olderController?.abort(); this.olderController = undefined;
    this.pendingOlderUpdates = undefined;
  }
  private applyReset(cursor: unknown): boolean {
    if (!positive(cursor)) throw new ProtocolError('Invalid group reset cursor');
    const boundary = cursor as number;
    if (boundary <= this.snapshot.resetCursor) return false;
    this.cancelOlder();
    for (const [id, entry] of this.entries) if (entry.revision <= boundary) this.entries.delete(id);
    this.windowStart = 0;
    this.publish({ resetCursor: boundary, cursor: Math.max(this.snapshot.cursor, boundary), initialized: false,
      hasOlder: false, nextBefore: null, loadingOlder: false, historyError: null, commandError: null });
    return true;
  }
  private validatePage(value: unknown, before?: number): GroupHistoryPage {
    const page = value as GroupHistoryPage | null;
    if (!page || page.workspaceId !== this.workspaceId || !Number.isSafeInteger(page.cursor) || page.cursor < 0
      || !Number.isSafeInteger(page.resetCursor) || page.resetCursor < 0 || page.resetCursor > page.cursor
      || !Array.isArray(page.entries) || page.entries.length > 50 || typeof page.hasOlder !== 'boolean'
      || (page.hasOlder ? !positive(page.nextBefore) : page.nextBefore !== null)) throw new ProtocolError('Invalid group history page');
    const ids = new Set<string>(); let previous = 0;
    for (const entry of page.entries) {
      validateEntry(entry, this.workspaceId);
      if (ids.has(entry.entryId) || entry.position <= previous || entry.revision > page.cursor || entry.revision <= page.resetCursor
        || (before !== undefined && entry.position >= before)) throw new ProtocolError('Invalid group history order or revision');
      previous = entry.position; ids.add(entry.entryId);
    }
    if (page.hasOlder && page.nextBefore !== page.entries[0]?.position) throw new ProtocolError('Invalid older history cursor');
    return page;
  }
  private async initialize(signal: AbortSignal, generation: number) {
    const page = this.validatePage(await json(await this.fetcher(`${this.path}/history?limit=50`, {signal, cache: 'no-store'})));
    if (signal.aborted || generation !== this.generation) return;
    if (page.resetCursor < this.snapshot.resetCursor) throw new ProtocolError('Group history reset cursor moved backwards');
    const target = new Map<string, GroupEntry>();
    for (const entry of page.entries) this.merge(entry, target);
    // A POST can be acknowledged after the snapshot was read. Preserve it without skipping the feed.
    for (const entry of this.entries.values()) if (entry.revision > page.cursor) this.merge(entry, target);
    this.cancelOlder(); this.entries = target;
    this.windowStart = page.nextBefore ?? 0;
    this.publish({initialized: true, cursor: page.cursor, resetCursor: page.resetCursor,
      hasOlder: page.hasOlder, nextBefore: page.nextBefore, loadingOlder: false, historyError: null});
  }
  loadOlder = async () => {
    if (this.disposed || !this.snapshot.initialized || this.snapshot.loadingOlder || !this.snapshot.hasOlder) return;
    const before = this.snapshot.nextBefore!, resetCursor = this.snapshot.resetCursor, epoch = this.historyEpoch;
    const controller = new AbortController(); this.olderController = controller;
    const updates = new Map<string, GroupEntry>(); this.pendingOlderUpdates = updates;
    this.publish({loadingOlder: true, historyError: null});
    try {
      const page = this.validatePage(await json(await this.fetcher(`${this.path}/history?before=${before}&limit=50&resetCursor=${resetCursor}`, {signal: controller.signal, cache: 'no-store'})), before);
      if (controller.signal.aborted || epoch !== this.historyEpoch) return;
      if (page.resetCursor !== resetCursor) throw new BackendError('Chat was reset; reload the latest history', 409, 'history_reset');
      const target = new Map(this.entries), floor = page.nextBefore ?? 0;
      for (const entry of page.entries) this.merge(entry, target);
      // Include updates skipped for unloaded entries while the SQL snapshot/page was in flight.
      for (const entry of updates.values()) if (target.has(entry.entryId) || entry.position >= floor) this.merge(entry, target);
      this.entries = target; this.windowStart = floor;
      this.publish({hasOlder: page.hasOlder, nextBefore: page.nextBefore});
    } catch (error) {
      if (controller.signal.aborted || epoch !== this.historyEpoch) return;
      if (error instanceof BackendError && error.code === 'history_reset') {
        this.publish({initialized: false}); this.follow();
      } else this.publish({historyError: error instanceof Error ? error.message : 'Could not load older history'});
    } finally {
      if (epoch === this.historyEpoch) {
        this.pendingOlderUpdates = undefined; this.olderController = undefined; this.publish({loadingOlder: false});
      }
    }
  };
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
        if (!this.snapshot.initialized) await this.initialize(signal, generation);
        if (signal.aborted || generation !== this.generation) return;
        const response = await this.fetcher(`${this.path}/timeline-follow?after=${this.snapshot.cursor}`, { signal, headers: { Accept: 'text/event-stream' } });
        if (!response.ok) await json(response);
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new ProtocolError('Expected group SSE stream');
        for await (const frame of readSse(response.body)) {
          if (signal.aborted || generation !== this.generation) return;
          let event;
          try { event = JSON.parse(frame.data); } catch { throw new ProtocolError('Invalid group event JSON'); }
          if (!event || typeof event !== 'object' || event.version !== 1 || event.workspaceId !== this.workspaceId || event.type !== frame.name) throw new ProtocolError('Invalid group event envelope');
          if (event.type === 'stream_error') {
            if (event.code === 'invalid_cursor' || event.code === 'cursor_expired') throw new BackendError('Group update cursor is unavailable', 409, event.code);
            throw new Error('Group updates interrupted by backend');
          }
          if (event.type === 'entry') {
            const change = event.change as GroupChange;
            if (!change || !positive(change.cursor) || change.entry?.revision !== change.cursor) throw new ProtocolError('Invalid group change');
            if (change.cursor <= this.snapshot.cursor) continue;
            if (change.cursor !== this.snapshot.cursor + 1) throw new ProtocolError('Group changes have a gap');
            validateEntry(change.entry, this.workspaceId);
            if (this.inWindow(change.entry)) this.merge(change.entry);
            this.pendingOlderUpdates?.set(change.entry.entryId, change.entry);
            this.publish({ cursor: change.cursor });
          } else if (event.type === 'reset') {
            if (this.applyReset(event.cursor)) { this.follow(); return; }
          } else if (event.type === 'sync') {
            if (Number.isSafeInteger(event.cursor) && event.cursor < this.snapshot.resetCursor) continue;
            if (event.cursor !== this.snapshot.cursor) throw new ProtocolError('Group history did not reach synchronization cursor');
            attempt = 0; this.publish({ synchronized: true, connection: 'following', error: null });
          } else if (event.type !== 'settings') throw new ProtocolError('Unsupported group event');
        }
        throw new Error('Group connection closed');
      } catch (error) {
        if (signal.aborted || generation !== this.generation) return;
        if (error instanceof BackendError && (error.code === 'invalid_cursor' || error.code === 'cursor_expired')) {
          this.cancelOlder(); this.publish({initialized: false, loadingOlder: false});
          continue;
        }
        const fatal = error instanceof ProtocolError || (error instanceof BackendError && error.status < 500);
        this.publish({ synchronized: false, connection: fatal ? 'error' : 'disconnected', error: error instanceof Error ? error.message : 'Group connection failed' });
        if (fatal) return;
        await waitForRetry(this.retryDelay(attempt++), signal);
      }
    }
  }
  async send(text: string, images: readonly File[] = []) {
    if (this.disposed || this.snapshot.sending || this.snapshot.resetting) throw new Error('Group submission is unavailable');
    if (!text.trim() && !images.length) throw new Error('Enter a message or attach a picture');
    if (images.length > 4) throw new Error('Attach at most four pictures');
    const form = images.length ? new FormData() : null;
    if (form) { form.append('text', text); for (const image of images) form.append('images', image, image.name); }
    this.publish({ sending: true, commandError: null });
    try {
      const accepted = await json(await this.fetcher(`${this.path}/messages`, { method: 'POST', ...(form ? { body: form } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }) })) as { entries?: GroupEntry[] };
      if (!Array.isArray(accepted.entries)) throw new ProtocolError('Missing reserved group entries');
      for (const entry of accepted.entries) {
        validateEntry(entry, this.workspaceId);
        if (this.inWindow(entry)) this.merge(entry);
      }
      this.publish();
    } catch (error) { this.publish({ commandError: error instanceof Error ? error.message : 'Message refused' }); throw error; }
    finally { this.publish({ sending: false }); }
  }
  async reset() {
    if (this.disposed || this.snapshot.resetting || this.snapshot.sending || this.snapshot.stopping) throw new Error('Chat reset is unavailable');
    this.publish({ resetting: true, commandError: null });
    try {
      const result = await json(await this.fetcher(`${this.path}/reset`, { method: 'POST' })) as { workspaceId?: string; resetCursor?: number };
      if (result?.workspaceId !== this.workspaceId) throw new ProtocolError('Invalid group reset response');
      if (this.applyReset(result.resetCursor)) this.follow();
    } catch (error) { this.publish({ commandError: error instanceof Error ? error.message : 'Reset failed' }); throw error; }
    finally { this.publish({ resetting: false }); }
  }
  async stop() {
    if (this.snapshot.stopping) return;
    this.publish({ stopping: true, commandError: null });
    try { await json(await this.fetcher(`${this.path}/stop`, { method: 'POST' })); }
    catch (error) { this.publish({ commandError: error instanceof Error ? error.message : 'Stop failed' }); }
    finally { this.publish({ stopping: false }); }
  }
  dispose() { this.disposed = true; this.generation++; this.controller?.abort(); this.cancelOlder(); this.listeners.clear(); }
}
