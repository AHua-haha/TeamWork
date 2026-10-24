import type { AssistantMessage, AssistantMessageFrame } from '@earendil-works/pi-ai';
import { Changes } from '../../changes.js';
import { position } from './model.js';

/** Pi compact frames; start carries an empty-content header, never a mutable partial. */
export type ProgressEvent = Exclude<AssistantMessageFrame, { type: 'start' }> | { type: 'start'; message: AssistantMessage };
export interface ProgressChunk { messageId: string; runId: string; sequence: number; historyPositionBeforeMessage: number; event: ProgressEvent }
interface Active { messageId: string; runId: string; historyPositionBeforeMessage: number; next: number }
interface Lane { changes: Changes; durable: number; ring: (ProgressChunk | undefined)[]; head: number; length: number; active?: Active }

/** Count-bounded per-agent FIFO. SQL notifications and progress notifications are distinct. */
export class ProgressStore {
  private readonly lanes = new Map<string, Lane>();
  constructor(readonly capacity = 1024) { position(capacity); }
  lane(id: string): Lane {
    let lane = this.lanes.get(id);
    if (!lane) { lane = { changes: new Changes(), durable: 0, ring: [], head: 0, length: 0 }; this.lanes.set(id, lane); }
    return lane;
  }
  changed(id: string): void { const lane = this.lane(id); lane.durable++; lane.changes.publish(); }
  begin(id: string, runId: string, messageId: string, historyPositionBeforeMessage: number): void {
    this.lane(id).active = { runId, messageId, historyPositionBeforeMessage, next: 0 };
    this.changed(id);
  }
  append(id: string, event: ProgressEvent): void {
    const lane = this.lane(id), active = lane.active;
    if (!active) throw new Error('Progress has no active message');
    const chunk: ProgressChunk = { messageId: active.messageId, runId: active.runId, historyPositionBeforeMessage: active.historyPositionBeforeMessage, sequence: active.next++, event };
    if (this.capacity) {
      if (lane.length === this.capacity) { lane.ring[lane.head] = chunk; lane.head = (lane.head + 1) % this.capacity; }
      else { lane.ring[(lane.head + lane.length++) % this.capacity] = chunk; }
    }
    lane.changes.publish();
  }
  settle(id: string, runId: string, messageId?: string): void {
    const lane = this.lane(id);
    if (lane.active?.runId === runId && (messageId === undefined || lane.active.messageId === messageId)) lane.active = undefined;
    this.changed(id);
  }
  read(id: string, runId: string, messageId: string, after = 0) {
    const lane = this.lane(id), retained: ProgressChunk[] = [];
    for (let index = 0; index < lane.length; index++) {
      const chunk = lane.ring[(lane.head + index) % this.capacity]!;
      if (chunk.runId === runId && chunk.messageId === messageId) retained.push(chunk);
    }
    const active = lane.active?.messageId === messageId && lane.active.runId === runId ? lane.active : undefined;
    if (!active && !retained.length) return undefined;
    return { firstAvailable: retained[0]?.sequence ?? active!.next, nextSequence: active?.next ?? retained.at(-1)!.sequence + 1,
      historyPositionBeforeMessage: active?.historyPositionBeforeMessage ?? retained[0]!.historyPositionBeforeMessage,
      chunks: retained.filter(chunk => chunk.sequence >= after) };
  }
  clear(id: string): void { const lane = this.lane(id); lane.ring = []; lane.head = 0; lane.length = 0; lane.active = undefined; this.changed(id); }
  close(): void { for (const id of this.lanes.keys()) this.clear(id); }
}
