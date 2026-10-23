import { createHash } from 'node:crypto';
import { AppError } from './agent/types.js';

/** Text files served by the context base and the project-file API. */
export const maxFileBytes = 1024 * 1024;
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Exact text of the bytes, keeping a byte-order mark, or null for binary or non-UTF-8 data. */
export function decodeText(bytes: Uint8Array): string | null {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return null; }
  return text.includes('\0') ? null : text;
}

/** Bytes to store for caller-supplied content. */
export function encodeText(content: string): Buffer {
  if (content.includes('\0') || loneSurrogate.test(content)) throw new AppError('invalid_input', 'Content must be text without NUL characters or unpaired surrogates');
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > maxFileBytes) throw new AppError('input_too_large', `Content exceeds ${maxFileBytes} bytes`, 413);
  return bytes;
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Error codes from the file system that mean the entry is not there. */
export function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}
