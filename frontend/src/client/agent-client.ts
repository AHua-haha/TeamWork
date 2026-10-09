import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import { ProtocolError, readSse } from './sse.js';
import type { ClientSnapshot, CompletedRecord, FollowEvent, LiveMessage, RunState, UserInput } from './protocol.js';

const validId = /^[A-Za-z0-9_-]{1,64}$/;

export class BackendError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

async function requireJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
    throw new BackendError(payload?.error?.message ?? `Backend request failed (${response.status})`, response.status, payload?.error?.code ?? 'http_error');
  }
  return response.json();
}

export async function createAgent(fetcher: typeof fetch = fetch, basePath = '/agents'): Promise<string> {
  const response = await fetcher(basePath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const state = await requireJson(response) as { agentId?: unknown };
  if (typeof state.agentId !== 'string' || !validId.test(state.agentId)) throw new ProtocolError('Backend did not return an agent identity');
  return state.agentId;
}

interface Options {
  fetcher?: typeof fetch;
  basePath?: string;
  retryDelayMs?: (attempt: number) => number;
}

export function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function envelope(raw: string, eventName: string, agentId: string): FollowEvent {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new ProtocolError('Invalid JSON in follow stream'); }
  if (!value || typeof value !== 'object') throw new ProtocolError('Invalid follow event');
  const event = value as Partial<FollowEvent>;
  if (event.version !== 1 || event.agentId !== agentId || event.type !== eventName || !['message', 'sync', 'chunk', 'gap', 'state', 'end'].includes(String(event.type))) {
    throw new ProtocolError('Unsupported follow event');
  }
  return event as FollowEvent;
}

/** Holds backend-format conversation data. It has no React or assistant-ui dependency. */
export class AgentClient {
  readonly agentId: string;
  private readonly fetcher: typeof fetch;
  private readonly basePath: string;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly listeners = new Set<() => void>();
  private readonly records = new Map<number, CompletedRecord>();
  private readonly identities = new Map<string, number>();
  private readonly partials = new Map<string, LiveMessage>();
  private readonly gaps = new Set<string>();
  private controller: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private snapshot: ClientSnapshot;

  constructor(agentId: string, options: Options = {}) {
    if (!validId.test(agentId)) throw new Error('Invalid agent identity');
    this.agentId = agentId;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.basePath = options.basePath ?? '/agents';
    this.retryDelayMs = options.retryDelayMs ?? (attempt => Math.min(500 * 2 ** Math.min(attempt, 4), 8000));
    this.snapshot = { agentId, completed: [], live: [], historyPosition: 0, synchronized: false, connection: 'idle', run: null, sending: false, error: null };
  }

  getSnapshot = (): ClientSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(changes: Partial<ClientSnapshot> = {}): void {
    this.snapshot = {
      ...this.snapshot, ...changes,
      completed: [...this.records.values()].sort((a, b) => a.position - b.position),
      live: [...this.partials.values()],
    };
    for (const listener of this.listeners) listener();
  }

  /** Opening, refreshing and reconnecting all use the same completed-then-live flow. */
  follow(runId?: string): void {
    if (this.disposed) return;
    if (runId !== undefined && !validId.test(runId)) throw new Error('Invalid run identity');
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    this.partials.clear();
    this.gaps.clear();
    this.publish({ synchronized: false, connection: 'syncing', error: null });
    void this.followUntilEnd(runId, controller.signal, generation);
  }

  refresh(): void { this.follow(); }

  private async followUntilEnd(targetRunId: string | undefined, signal: AbortSignal, generation: number): Promise<void> {
    let attempt = 0;
    while (!signal.aborted && generation === this.generation) {
      let ended = false;
      let sawSync = false;
      try {
        const url = new URL(`${this.basePath}/${this.agentId}/follow`, globalThis.location?.origin ?? 'http://localhost');
        if (targetRunId) url.searchParams.set('runId', targetRunId);
        url.searchParams.set('after', String(this.snapshot.historyPosition));
        const response = await this.fetcher(url.pathname + url.search, { headers: { Accept: 'text/event-stream' }, signal });
        if (!response.ok) await requireJson(response);
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new ProtocolError('Backend did not return an SSE stream');
        for await (const frame of readSse(response.body)) {
          if (signal.aborted || generation !== this.generation) return;
          if (frame.name === 'stream_error') throw new Error('Follow stream interrupted by backend');
          const event = envelope(frame.data, frame.name, this.agentId);
          if (targetRunId && event.runId !== targetRunId) throw new ProtocolError('Follow switched runs');
          if (event.type === 'sync') {
            sawSync = true;
            targetRunId = event.runId ?? undefined;
          }
          if (event.type === 'chunk' && !sawSync) throw new ProtocolError('Live chunks arrived before synchronization');
          this.apply(event);
          if (event.type === 'end') { ended = true; break; }
        }
        if (ended) return;
        throw new Error('Follow connection ended before run end');
      } catch (error) {
        if (signal.aborted || generation !== this.generation) return;
        const message = error instanceof Error ? error.message : 'Follow connection failed';
        const fatal = error instanceof ProtocolError || (error instanceof BackendError && error.status >= 400 && error.status < 500);
        this.partials.clear();
        this.gaps.clear();
        this.publish({ synchronized: false, connection: fatal ? 'error' : 'disconnected', error: message });
        if (fatal) return;
        await waitForRetry(this.retryDelayMs(attempt++), signal);
        if (signal.aborted || generation !== this.generation) return;
        this.publish({ connection: 'syncing', error: null });
      }
    }
  }

  private apply(event: FollowEvent): void {
    switch (event.type) {
      case 'message': {
        const record = event.record;
        if (!Number.isSafeInteger(record.position) || record.position < 1 || typeof record.messageId !== 'string') throw new ProtocolError('Invalid completed message position or identity');
        const existing = this.records.get(record.position);
        if (existing) {
          if (existing.messageId !== record.messageId) throw new ProtocolError('Completed-message position changed');
          return;
        }
        if (record.position !== this.snapshot.historyPosition + 1 || this.identities.has(record.messageId)) throw new ProtocolError('Completed-message history has a gap or duplicate identity');
        this.records.set(record.position, record);
        this.identities.set(record.messageId, record.position);
        this.partials.delete(record.messageId);
        this.gaps.delete(record.messageId);
        this.publish({ historyPosition: record.position });
        return;
      }
      case 'sync':
        if (event.historyPosition !== this.snapshot.historyPosition) throw new ProtocolError('Completed history did not reach the sync position');
        this.publish({ synchronized: true, connection: event.run?.status === 'running' ? 'following' : 'idle', run: event.run });
        return;
      case 'state':
        this.publish({ run: event.run });
        return;
      case 'chunk':
        this.applyChunk(event.messageId, event.runId, event.sequence, event.event);
        return;
      case 'gap':
        this.partials.delete(event.messageId);
        this.gaps.add(event.messageId);
        this.publish();
        return;
      case 'end':
        if (event.historyPosition !== this.snapshot.historyPosition) throw new ProtocolError('Run ended before completed history was delivered');
        this.partials.clear();
        this.gaps.clear();
        this.publish({ synchronized: true, connection: 'idle', run: event.run, error: null });
    }
  }

  private applyChunk(messageId: string, runId: string | null, sequence: number, event: AssistantMessageEvent): void {
    if (this.identities.has(messageId) || this.gaps.has(messageId)) return;
    const previous = this.partials.get(messageId);
    const expected = previous?.nextSequence ?? 0;
    if (sequence < expected) return;
    if (sequence !== expected || (!previous && event.type !== 'start') || !runId) {
      this.partials.delete(messageId);
      this.gaps.add(messageId);
      this.publish();
      return;
    }
    const message: AssistantMessage = event.type === 'done' ? event.message : event.type === 'error' ? event.error : event.partial;
    this.partials.set(messageId, { messageId, runId, message, nextSequence: sequence + 1, lastEvent: event });
    this.publish();
  }

  async send(input: UserInput): Promise<void> {
    if (this.disposed) throw new Error('Agent client is closed');
    if (this.snapshot.sending) throw new Error('Input submission is already in progress');
    const validInput = typeof input === 'string' ? input.trim().length > 0
      : Array.isArray(input) && input.length > 0 && input.every(block =>
        block.type === 'text' ? typeof block.text === 'string'
          : block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string')
        && input.some(block => block.type === 'image' || block.text.trim().length > 0);
    if (!validInput) throw new Error('Enter a message to send');
    this.publish({ sending: true, error: null });
    try {
      const response = await this.fetcher(`${this.basePath}/${this.agentId}/runs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }),
      });
      const accepted = await requireJson(response) as { runId?: unknown; run?: RunState };
      if (typeof accepted.runId !== 'string' || !validId.test(accepted.runId) || !accepted.run) throw new ProtocolError('Backend did not acknowledge the new run');
      this.publish({ sending: false, run: accepted.run });
      this.follow(accepted.runId);
    } catch (error) {
      this.publish({ sending: false, error: error instanceof Error ? error.message : 'Input submission failed' });
      throw error;
    }
  }

  async cancel(): Promise<void> {
    const runId = this.snapshot.run?.runId;
    if (!runId || this.snapshot.run?.status !== 'running') return;
    try {
      const response = await this.fetcher(`${this.basePath}/${this.agentId}/runs/${runId}/cancel`, { method: 'POST' });
      await requireJson(response);
    } catch (error) {
      this.publish({ error: error instanceof Error ? error.message : 'Cancellation failed' });
      throw error;
    }
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
    this.listeners.clear();
  }
}
