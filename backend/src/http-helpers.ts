import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { AppError } from './types.js';

export const maxInputBytes = 2 * 1024 * 1024;

/** One request: its URL, path segments, and a signal that aborts when the client goes away. */
export interface Route { request: IncomingMessage; response: ServerResponse; url: URL; path: string[]; signal: AbortSignal }

export async function body(request: IncomingMessage, limit = maxInputBytes): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AppError('invalid_input', 'Content-Type must be application/json', 415);
  const bytes = await rawBody(request, limit);
  let data: unknown;
  try { data = JSON.parse(bytes.toString('utf8')); }
  catch { throw new AppError('invalid_input', 'Invalid JSON body'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('invalid_input', 'Expected a JSON object');
  return data as Record<string, unknown>;
}

export async function rawBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      throw new AppError('input_too_large', `Request exceeds ${limit} bytes`, 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function fields(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new AppError('invalid_input', `Allowed fields: ${allowed.join(', ') || 'none'}`);
}

export function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

/** Rejects unknown and repeated query parameters. */
export function query(url: URL, allowed: string[]): void {
  const keys = [...url.searchParams.keys()];
  if (keys.some(key => !allowed.includes(key))) throw new AppError('invalid_input', `Allowed parameters: ${allowed.join(', ') || 'none'}`);
  if (new Set(keys).size !== keys.length) throw new AppError('invalid_input', 'A parameter appears more than once');
}

export function text(url: URL, name: string, fallback?: string): string {
  const value = url.searchParams.get(name) ?? fallback;
  if (value === undefined) throw new AppError('invalid_input', `${name} is required`);
  return value;
}

/** A nonnegative integer parameter. */
export function count(url: URL, name: string, fallback: number): number;
export function count(url: URL, name: string, fallback: null): number | null;
export function count(url: URL, name: string, fallback: number | null): number | null {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (!/^\d{1,15}$/.test(value)) throw new AppError('invalid_input', `${name} must be a nonnegative integer`);
  return Number(value);
}

export function optionalString(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AppError('invalid_input', `${name} must be a string`);
  return value;
}

/** Errors before the response starts keep their HTTP status; later ones end the response. */
export function respond(handle: (route: Route) => Promise<void>): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname.split('/').filter(Boolean);
    handle({ request, response, url, path, signal: controller.signal }).catch(error => {
      if (controller.signal.aborted) return;
      // The client gets only a short message for these, so the log is where their cause can be found.
      if (!(error instanceof AppError) || error.status >= 500) console.error(`${request.method} ${url.pathname} failed:`, error);
      if (response.headersSent) {
        response.end();
        return;
      }
      json(response, error instanceof AppError ? error.status : 503, { error: { code: error instanceof AppError ? error.code : 'backend_error', message: error instanceof AppError ? error.message : 'Backend operation failed' } });
    });
  };
}

/**
 * Sends a stream as server-sent events. The first event is read before the headers, so validation
 * errors keep their HTTP status; a later failure sends `stream_error` with `errorFields` and ends.
 */
export async function sse(response: ServerResponse, stream: AsyncGenerator<{ type: string }>, signal: AbortSignal, errorFields: Record<string, unknown> = {}): Promise<void> {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    let item = await stream.next();
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    // Transport keepalive only: no polling and no writes behind backpressure.
    heartbeat = setInterval(() => {
      if (!response.destroyed && !response.writableNeedDrain) response.write(': keepalive\n\n');
    }, 15_000);
    heartbeat.unref();
    try {
      while (!item.done && !signal.aborted) {
        const event = item.value;
        if (!response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) await once(response, 'drain', { signal });
        item = await stream.next();
      }
    } catch (error) {
      if (signal.aborted) return;
      const code = error instanceof AppError ? error.code : 'backend_error';
      response.write(`event: stream_error\ndata: ${JSON.stringify({ version: 1, type: 'stream_error', ...errorFields, code, message: 'Stream interrupted; reconnect to synchronize' })}\n\n`);
    }
    response.end();
  } finally {
    clearInterval(heartbeat);
    await stream.return(undefined);
  }
}
