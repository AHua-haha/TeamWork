import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { prepareChatImage, readImageSubmission, maxImageBytes, imageContent } from '../src/domain/chat-images.js';
import { chatText, groupEntry } from '../src/domain/group-chat.js';
import { png } from './image-fixture.js';

async function multipart(form: FormData): Promise<IncomingMessage> {
  const request = new Request('http://localhost', { method: 'POST', body: form });
  return Object.assign(Readable.from([Buffer.from(await request.arrayBuffer())]), { headers: { 'content-type': request.headers.get('content-type') } }) as unknown as IncomingMessage;
}

test('Pi public preparation decodes and resizes pictures and native blocks contain image bytes', async () => {
  const image = await prepareChatImage(png(2400, 24), '../screen.png');
  assert.equal(image.metadata.name, 'screen.png');
  assert.equal(image.metadata.width, 2000); assert.equal(image.metadata.height, 20);
  assert.ok(image.metadata.size < 5 * 1024 * 1024);
  const content = imageContent(image);
  assert.equal(content.type, 'image'); assert.deepEqual(Buffer.from(content.data, 'base64'), image.bytes);
  assert.equal(chatText('', [image.metadata]), '');
  const entry = groupEntry({ workspaceId: 'w', messageId: 'm', position: 1, exchangeId: 'e', author: { type: 'user' }, text: '', attachments: [image.metadata], recipients: ['lead'], time: 1 }, [content]);
  assert.ok(Array.isArray(entry.message.content));
  assert.deepEqual(entry.message.content[1], content);
  assert.throws(() => chatText(''), /group message/);
});

test('image preparation rejects corrupt bytes, unsupported content and oversized inputs', async () => {
  await assert.rejects(prepareChatImage(Buffer.from('<svg/>'), 'image.png'), /PNG, JPEG or WebP/);
  await assert.rejects(prepareChatImage(png().subarray(0, 18), 'broken.png'), /decoded|prepared/);
  await assert.rejects(prepareChatImage(Buffer.alloc(maxImageBytes + 1), 'large.png'), /10 MiB/);
});

test('multipart image-only input preserves order and ignores a false browser MIME declaration', async () => {
  const form = new FormData(); form.set('text', '');
  form.append('images', new Blob([new Uint8Array(png())], { type: 'text/plain' }), 'one.png');
  form.append('images', new Blob([new Uint8Array(png(9, 7))]), 'two.png');
  const input = await readImageSubmission(await multipart(form));
  assert.equal(input.text, ''); assert.deepEqual(input.images.map(image => image.metadata.name), ['one.png', 'two.png']);
  assert.deepEqual(input.images.map(image => image.metadata.width), [8, 9]);
});

test('malformed multipart fields and a corrupt second picture fail the whole preparation', async () => {
  const form = new FormData(); form.set('text', 'hello');
  form.append('images', new Blob([new Uint8Array(png())]), 'good.png');
  form.append('images', new Blob(['invalid']), 'bad.png');
  await assert.rejects(readImageSubmission(await multipart(form)), /PNG, JPEG or WebP/);
  form.delete('images'); form.append('images', 'not a file');
  await assert.rejects(readImageSubmission(await multipart(form)), /text field/);
  form.delete('images'); form.append('images', new Blob([new Uint8Array(png())]), 'good.png'); form.append('text', 'duplicate');
  await assert.rejects(readImageSubmission(await multipart(form)), /text field/);
});
