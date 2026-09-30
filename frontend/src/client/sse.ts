export class ProtocolError extends Error {}

export interface SseFrame {
  name: string;
  data: string;
}

/** Handles split UTF-8, CRLF, comment heartbeats and multi-line SSE data. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let name = 'message';
  const line = (raw: string): SseFrame | null => {
    const value = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (value === '') {
      const frame = data.length ? { name, data: data.join('\n') } : null;
      data = [];
      name = 'message';
      return frame;
    }
    if (value.startsWith(':')) return null;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? '' : value.slice(colon + (value[colon + 1] === ' ' ? 2 : 1));
    if (field === 'event') name = content;
    if (field === 'data') data.push(content);
    return null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let split: number;
      while ((split = buffer.indexOf('\n')) >= 0) {
        const frame = line(buffer.slice(0, split));
        buffer = buffer.slice(split + 1);
        if (frame) yield frame;
      }
      if (done) break;
    }
    if (buffer || data.length) throw new ProtocolError('Follow stream ended inside an SSE event');
  } finally {
    reader.releaseLock();
  }
}
