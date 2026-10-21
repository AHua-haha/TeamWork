import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { convertToPng, resizeImage } from '@earendil-works/pi-coding-agent';
import type { ImageContent } from '@earendil-works/pi-ai';
import { AppError, identity } from '../../foundation/types.js';
import { rawBody } from '../../api/http-helpers.js';

export const maxChatImages = 4;
export const maxImageBytes = 10 * 1024 * 1024;
export interface ChatImage { id: string; name: string; mimeType: string; width: number; height: number; size: number }
export interface PreparedChatImage { metadata: ChatImage; bytes: Buffer }
export interface ChatImageStore {
  chatImage(workspaceId: string, imageId: string): Promise<PreparedChatImage>;
}

export function validateChatImages(value: unknown): asserts value is ChatImage[] {
  if (!Array.isArray(value) || value.length > maxChatImages) throw new AppError('invalid_input', 'A message supports at most four pictures');
  const ids = new Set<string>();
  for (const image of value) {
    if (!image || typeof image !== 'object') throw new AppError('invalid_input', 'Invalid picture metadata');
    identity(image.id, 'imageId');
    if (ids.has(image.id) || typeof image.name !== 'string' || !image.name || image.name.length > 200
      || !['image/png', 'image/jpeg'].includes(image.mimeType)
      || ![image.width, image.height].every(n => Number.isInteger(n) && n > 0 && n <= 2000)
      || !Number.isInteger(image.size) || image.size <= 0 || image.size > 5 * 1024 * 1024) throw new AppError('invalid_input', 'Invalid picture metadata');
    ids.add(image.id);
  }
}

/** MIME comes from bytes. Pi decodes, converts and resizes; this adapter never captions images. */
export async function prepareChatImage(bytes: Buffer, filename: string): Promise<PreparedChatImage> {
  if (!bytes.length || bytes.length > maxImageBytes) throw new AppError('input_too_large', 'Each picture must be nonempty and at most 10 MiB', 413);
  let mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  if (!mimeType) throw new AppError('invalid_image', 'Choose a PNG, JPEG or WebP picture');
  if (mimeType === 'image/webp') {
    const converted = await convertToPng(bytes.toString('base64'), mimeType);
    if (!converted) throw new AppError('invalid_image', 'Picture could not be decoded');
    bytes = Buffer.from(converted.data, 'base64'); mimeType = converted.mimeType;
  }
  const image = await resizeImage(bytes, mimeType, { maxWidth: 2000, maxHeight: 2000, maxBytes: 4.5 * 1024 * 1024 });
  if (!image) throw new AppError('invalid_image', 'Picture could not be decoded or prepared within the image limits');
  const output = Buffer.from(image.data, 'base64');
  const metadata = { id: randomUUID(), name: filename.split(/[\\/]/).at(-1)!.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || 'Picture', mimeType: image.mimeType, width: image.width, height: image.height, size: output.length };
  validateChatImages([metadata]);
  return { metadata, bytes: output };
}

export function imageContent(image: PreparedChatImage): ImageContent {
  return { type: 'image', mimeType: image.metadata.mimeType, data: image.bytes.toString('base64') };
}

/** Bounded multipart parsing; all validation/preparation completes before publication. */
export async function readImageSubmission(request: IncomingMessage): Promise<{ text: string; images: PreparedChatImage[] }> {
  const contentType = request.headers['content-type'] ?? '';
  const bytes = await rawBody(request, maxChatImages * maxImageBytes + 128 * 1024);
  let form: FormData;
  try { form = await new Request('http://localhost/upload', { method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(bytes) }).formData(); }
  catch { throw new AppError('invalid_input', 'Invalid multipart image submission'); }
  const texts = form.getAll('text'), files = form.getAll('images');
  if ([...form.keys()].some(key => !['text', 'images'].includes(key)) || texts.length !== 1 || typeof texts[0] !== 'string'
    || !files.length || files.length > maxChatImages || files.some(file => typeof file === 'string')) throw new AppError('invalid_input', 'Submit one text field and one to four images files');
  const images: PreparedChatImage[] = [];
  for (const file of files as File[]) {
    if (!file.size || file.size > maxImageBytes) throw new AppError('input_too_large', 'Each picture must be nonempty and at most 10 MiB', 413);
    images.push(await prepareChatImage(Buffer.from(await file.arrayBuffer()), file.name));
  }
  return { text: texts[0], images };
}
