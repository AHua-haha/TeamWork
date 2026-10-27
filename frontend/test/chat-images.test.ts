import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GroupClient, imageUrl, validateEntry } from '../src/shared/backend-client/group-client.js';
import { imageInputError } from '../src/features/chat/useImageDraft.js';

const image = { id: 'picture1', name: 'screen.png', mimeType: 'image/png', width: 8, height: 6, size: 100 };
const entry = { kind: 'user', workspaceId: 'w', entryId: 'm', messageId: 'm', position: 1, revision: 1, exchangeId: 'e', time: 1, text: '', attachments: [image] };

test('image-only send uses binary multipart, and stable timeline retains only image references', async () => {
  const file = new File(['image'], 'screen.png', { type: 'image/png' });
  const client = new GroupClient('w', { fetcher: async (url, init) => {
    assert.equal(url, '/workspaces/w/chat/messages');
    assert.equal(init?.headers, undefined); assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get('text'), '');
    const upload = init.body.get('images'); assert.ok(upload instanceof File); assert.equal(upload.name, file.name); assert.equal(await upload.text(), 'image');
    return new Response(JSON.stringify({ entries: [entry] }), { status: 202 });
  } });
  await client.send('', [file]);
  assert.deepEqual(client.getSnapshot().entries, [entry]);
  assert.equal(imageUrl('w', 'picture1'), '/workspaces/w/chat/attachments/picture1');
  client.dispose();
});

test('image submission refusal remains explicit and does not create timeline entries', async () => {
  const client = new GroupClient('w', { fetcher: async () => new Response(JSON.stringify({ error: { code: 'image_not_supported', message: 'Select an image-capable model' } }), { status: 409 }) });
  await assert.rejects(client.send('', [new File(['png'], 'screen.png')]), /image-capable/);
  assert.equal(client.getSnapshot().entries.length, 0); assert.match(client.getSnapshot().commandError!, /image-capable/); client.dispose();
});

test('composer image validation and history validation reject unsupported or malformed attachments', () => {
  const file = new File(['png'], 'screen.png', { type: 'image/png' });
  assert.equal(imageInputError([file], 0), null);
  assert.match(imageInputError([file], 4)!, /four/);
  assert.match(imageInputError([new File(['svg'], 'vector.svg', { type: 'image/svg+xml' })], 0)!, /PNG/);
  validateEntry(entry, 'w');
  assert.throws(() => validateEntry({ ...entry, attachments: [image, image] }, 'w'), /picture/);
  assert.throws(() => validateEntry({ ...entry, attachments: [null] }, 'w'), /picture/);
  assert.throws(() => validateEntry({ ...entry, attachments: [{ ...image, id: '../wrong' }] }, 'w'), /picture/);
});
