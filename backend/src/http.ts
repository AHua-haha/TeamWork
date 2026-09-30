import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AgentRuntime } from './runtime.js';
import { AppError, identity, position } from './types.js';

const maxInputBytes = 2 * 1024 * 1024;

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AppError('invalid_input', 'Content-Type must be application/json', 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxInputBytes) {
      request.resume();
      throw new AppError('input_too_large', 'Request exceeds 2 MiB', 413);
    }
    chunks.push(chunk);
  }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('invalid_input', 'Invalid JSON body'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('invalid_input', 'Expected a JSON object');
  return data as Record<string, unknown>;
}

function fields(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new AppError('invalid_input', `Allowed fields: ${allowed.join(', ') || 'none'}`);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

export function createAgentServer(runtime: AgentRuntime) {
  return createServer((request, response) => {
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname.split('/').filter(Boolean);
      if (path[0] !== 'agents') throw new AppError('not_found', 'Endpoint not found', 404);
      if (path.length === 1 && request.method === 'POST') {
        const input = await body(request);
        fields(input, ['agentId']);
        if (input.agentId !== undefined) identity(input.agentId, 'agentId');
        json(response, 201, await runtime.store.createAgent(input.agentId));
        return;
      }
      const agentId = path[1];
      identity(agentId, 'agentId');
      if (path.length === 3 && path[2] === 'state' && request.method === 'GET') {
        json(response, 200, await runtime.getState(agentId));
      } else if (path.length === 3 && path[2] === 'runs' && request.method === 'POST') {
        const input = await body(request);
        fields(input, ['input']);
        // The runtime validates Pi's user-content shape and assigns role/time itself.
        const run = await runtime.start(agentId, input.input as Parameters<AgentRuntime['start']>[1]);
        json(response, 202, { runId: run.runId, run, followUrl: `/agents/${agentId}/follow?runId=${run.runId}` });
      } else if (path.length === 5 && path[2] === 'runs' && path[4] === 'cancel' && request.method === 'POST') {
        const runId = path[3];
        identity(runId, 'runId');
        await runtime.cancel(agentId, runId);
        json(response, 202, { runId, cancellationRequested: true });
      } else if (path.length === 3 && path[2] === 'follow' && request.method === 'GET') {
        for (const key of url.searchParams.keys()) if (!['runId', 'after'].includes(key)) throw new AppError('invalid_input', 'Unknown follow parameter');
        const runId = url.searchParams.get('runId') ?? undefined;
        if (runId !== undefined) identity(runId, 'runId');
        const cursor = url.searchParams.get('after');
        if (cursor !== null && !/^\d+$/.test(cursor)) throw new AppError('invalid_input', 'Invalid history cursor');
        const after = cursor === null ? 0 : Number(cursor);
        position(after);
        // Read the first event before opening SSE so validation errors retain HTTP status codes.
        const stream = runtime.follow(agentId, { runId, after, signal: controller.signal });
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        try {
          let item = await stream.next();
          response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
          response.flushHeaders();
          // Transport keepalive only: no database polling and no writes behind backpressure.
          heartbeat = setInterval(() => {
            if (!response.destroyed && !response.writableNeedDrain) response.write(': keepalive\n\n');
          }, 15_000);
          heartbeat.unref();
          while (!item.done && !controller.signal.aborted) {
            const event = item.value;
            if (!response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) {
              await once(response, 'drain', { signal: controller.signal });
            }
            item = await stream.next();
          }
          response.end();
        } finally {
          clearInterval(heartbeat);
          await stream.return(undefined);
        }
      } else throw new AppError('not_found', 'Endpoint not found', 404);
    })().catch(error => {
      if (controller.signal.aborted) return;
      if (response.headersSent) {
        response.write(`event: stream_error\ndata: ${JSON.stringify({ version: 1, type: 'stream_error', code: error instanceof AppError ? error.code : 'backend_error', message: 'Stream interrupted; reconnect to synchronize' })}\n\n`);
        response.end();
      } else {
        json(response, error instanceof AppError ? error.status : 503, { error: { code: error instanceof AppError ? error.code : 'backend_error', message: error instanceof AppError ? error.message : 'Backend operation failed' } });
      }
    });
  });
}
