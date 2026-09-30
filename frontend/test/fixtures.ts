import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { CompletedRecord, FollowEvent, RunState } from '../src/client/protocol.js';

export const agentId = 'agent_1';
export const runId = 'run_1';
export const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

export function assistant(text: string, stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text }], api: 'openai-responses', provider: 'openai', model: 'test', usage, stopReason, timestamp: 1 };
}

export function run(status: RunState['status'] = 'running', id = runId): RunState {
  return { agentId, runId: id, status, phase: status === 'running' ? 'model' : 'finished', step: 1, startedAt: 1, endedAt: status === 'running' ? null : 2, endPosition: status === 'running' ? null : 1, activeMessageId: status === 'running' ? 'm1' : null, error: null };
}

export function record(position: number, messageId: string, text: string): CompletedRecord {
  return { agentId, runId, messageId, position, message: assistant(text), metadata: { origin: 'model' } };
}

export function event(value: FollowEvent): string {
  return `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
}

export function streamResponse(value: string | ReadableStream<Uint8Array>): Response {
  return new Response(value, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

export async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for client state');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
