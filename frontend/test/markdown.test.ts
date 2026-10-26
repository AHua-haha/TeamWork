import assert from 'node:assert/strict';
import test from 'node:test';
import { externalHref, parseInline, parseMarkdown, resolveLink } from '../src/features/chat/markdown-parser.js';

const text = (value: string) => ({ type: 'text', text: value });

test('markdown blocks cover headings, fences, quotes, rules, tables and paragraphs', () => {
  assert.deepEqual(parseMarkdown([
    '# Title #',
    '',
    '```ts',
    'const a = 1;',
    '',
    '# not a heading',
    '```',
    '> quoted',
    '> # inner',
    '***',
    '| Name | Size |',
    '| :--- | ---: |',
    '| a \\| b | 2 |',
    '',
    'one',
    'two',
  ].join('\r\n')), [
    { type: 'heading', level: 1, children: [text('Title')] },
    { type: 'code', language: 'ts', text: 'const a = 1;\n\n# not a heading' },
    { type: 'quote', children: [{ type: 'paragraph', children: [text('quoted')] }, { type: 'heading', level: 1, children: [text('inner')] }] },
    { type: 'rule' },
    { type: 'table', align: ['left', 'right'], head: [[text('Name')], [text('Size')]], rows: [[[text('a | b')], [text('2')]]] },
    { type: 'paragraph', children: [text('one\ntwo')] },
  ]);
});

test('markdown lists keep item numbering, nesting and loose continuation', () => {
  assert.deepEqual(parseMarkdown('3. first\n   more\n4. second\n   - nested\n\n   after\n\n- other list'), [
    { type: 'list', ordered: true, start: 3, items: [
      [{ type: 'paragraph', children: [text('first\nmore')] }],
      [{ type: 'paragraph', children: [text('second')] }, { type: 'list', ordered: false, start: 1, items: [[{ type: 'paragraph', children: [text('nested')] }]] }, { type: 'paragraph', children: [text('after')] }],
    ] },
    { type: 'list', ordered: false, start: 1, items: [[{ type: 'paragraph', children: [text('other list')] }]] },
  ]);
});

test('markdown inline handles emphasis, code, links, escapes and raw HTML as text', () => {
  assert.deepEqual(parseInline('**bold _em_** ~~gone~~ `a*b` [see **this**](notes/a.md) <https://x.dev> \\*kept\\* snake_case_name <b>raw</b> ![alt](i.png)'), [
    { type: 'strong', children: [text('bold '), { type: 'em', children: [text('em')] }] },
    text(' '),
    { type: 'del', children: [text('gone')] },
    text(' '),
    { type: 'code', text: 'a*b' },
    text(' '),
    { type: 'link', href: 'notes/a.md', children: [text('see '), { type: 'strong', children: [text('this')] }] },
    text(' '),
    { type: 'link', href: 'https://x.dev', children: [text('https://x.dev')] },
    text(' *kept* snake_case_name <b>raw</b> alt'),
  ]);
  assert.deepEqual(parseInline('2 * 3 * 4 and **open'), [text('2 * 3 * 4 and **open')]);
});

test('links open externally only for web and mail addresses', () => {
  assert.equal(externalHref('https://example.com/a'), 'https://example.com/a');
  assert.equal(externalHref('MAILTO:me@example.com'), 'MAILTO:me@example.com');
  assert.equal(externalHref('javascript:alert(1)'), null);
  assert.equal(externalHref('notes/a.md'), null);
});

test('relative links resolve within the root of the linking file', () => {
  assert.equal(resolveLink('user/notes/plan.md', 'goals.md'), 'user/notes/goals.md');
  assert.equal(resolveLink('user/notes/plan.md', './../team%20notes/a.md#top'), 'user/team notes/a.md');
  assert.equal(resolveLink('README.md', 'docs/setup.md?raw'), 'docs/setup.md');
  assert.equal(resolveLink('user/plan.md', '../../escape.md'), null);
  assert.equal(resolveLink('README.md', '../outside.md'), null);
  assert.equal(resolveLink('user/plan.md', '/absolute.md'), null);
  assert.equal(resolveLink('user/plan.md', '#section'), null);
  assert.equal(resolveLink('user/plan.md', 'https://example.com'), null);
  assert.equal(resolveLink('user/plan.md', 'bad%zz.md'), null);
});
