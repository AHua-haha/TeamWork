import type { IncomingMessage } from 'node:http';
import { AppError } from '../core/agent/data/model.js';
import { maxChatImages, maxImageBytes, prepareChatImage, type PreparedChatImage } from '../core/team/data/chat-images.js';
import { rawBody } from './http-helpers.js';

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
