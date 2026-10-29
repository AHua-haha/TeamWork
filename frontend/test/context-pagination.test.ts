import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ContextPagination} from '../src/features/workspace/ContextTab.js';

const render = (values: Partial<Parameters<typeof ContextPagination>[0]> = {}) => renderToStaticMarkup(createElement(ContextPagination, {loaded: 100, total: 339, hasMore: true, loading: false, stale: false, onMore: () => {}, ...values}));
test('pagination exposes loaded/total counts and an actionable next page', () => {
  const html = render();
  assert.match(html, /100 of 339 messages loaded/); assert.match(html, /Load more/); assert.doesNotMatch(html, /disabled/);
});
test('exhausted compacted context is explicit instead of implying a missing pagination button', () => {
  const html = render({loaded: 73, total: 73, hasMore: false});
  assert.match(html, /All 73 messages in this context are loaded/); assert.doesNotMatch(html, /Load more|<button/);
});
test('loading and changed revisions disable paging until synchronization or refresh', () => {
  assert.match(render({loading: true}), /disabled/); assert.match(render({loading: true}), /Loading/);
  assert.match(render({stale: true}), /disabled/);
});
