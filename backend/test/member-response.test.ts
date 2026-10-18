import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMemberResponse } from '../src/member-response.js';

test('omitted and empty headers select nobody while all body @ text stays ordinary', () => {
  const body = '# Report\n\n@Backend @joplin/lib @{unfinished\n<mentions>not routing here</mentions>';
  assert.deepEqual(parseMemberResponse(body), { body, names: [], bodyOffset: 0 });
  for (const header of ['<mentions></mentions>', '<mentions> \n </mentions>', '<mentions>[]</mentions>']) {
    const raw = header + '\n\n' + body;
    assert.deepEqual(parseMemberResponse(raw), { body, names: [], bodyOffset: raw.length - body.length });
  }
});

test('only the first leading header routes, using exact case-insensitively unique names', () => {
  const body = 'Report @Nobody\n<mentions>["Ignored"]</mentions>';
  const raw = ' \n<mentions>\r\n["Backend", "backend", "Frontend Worker", "设计"]\r\n</mentions>\r\n\r\n' + body;
  const parsed = parseMemberResponse(raw);
  assert.deepEqual(parsed.names, ['Backend', 'Frontend Worker', '设计']);
  assert.equal(parsed.body, body);
  assert.equal(raw.slice(parsed.bodyOffset), body);
});

test('header separator removal preserves body indentation and trailing bytes', () => {
  const body = '    code block\n\nText.  \n';
  const raw = '<mentions>[]</mentions>\n \t\n' + body;
  assert.equal(parseMemberResponse(raw).body, body);
  assert.equal(parseMemberResponse('  Plain response  \n').body, '  Plain response  \n');
});

test('malformed leading headers and invalid names fail explicitly without scanning the body', () => {
  for (const raw of [
    '<mentions', '<mentions >[]</mentions>\nBody', '<mentions>["Backend"]\nBody',
    '<mentions>Backend</mentions>\nBody', '<mentions>{"members":[]}</mentions>\nBody',
    '<mentions>null</mentions>\nBody', '<mentions>[1]</mentions>\nBody',
    '<mentions>[""]</mentions>\nBody', '<mentions>[" Backend"]</mentions>\nBody',
    '<mentions>["Backend "]</mentions>\nBody', '<mentions>[["Backend"]]</mentions>\nBody',
  ]) assert.throws(() => parseMemberResponse(raw), (error: unknown) => (error as { code: string }).code === 'invalid_mentions');
  for (const raw of ['', '  ', '<mentions>[]</mentions>\n\n']) assert.throws(() => parseMemberResponse(raw), (error: unknown) => (error as { code: string }).code === 'invalid_input');
  assert.deepEqual(parseMemberResponse('Example:\n<mentions>bad</mentions>').names, []);
});
