import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarSection } from '../src/shared/ui/SidebarSection.js';

test('sidebar sections start expanded and connect their native disclosure button to retained content', () => {
  const markup = renderToStaticMarkup(createElement(SidebarSection, {
    title: 'Projects', children: createElement('button', { type: 'button' }, 'Current project'),
  }));
  assert.match(markup, /type="button"[^>]*aria-expanded="true"/);
  const controls = markup.match(/aria-controls="([^"]+)"/);
  assert.ok(controls?.[1]);
  assert.ok(markup.includes(`id="${controls[1]}"`));
  assert.match(markup, /Current project/);
  assert.doesNotMatch(markup, / hidden=/);
});

test('initially folded sections hide their panel while retaining child markup', () => {
  const markup = renderToStaticMarkup(createElement(SidebarSection, {
    title: 'Recent', defaultOpen: false,
    children: createElement('input', { 'aria-label': 'Draft', defaultValue: 'Keep this value' }),
  }));
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /class="shared-sidebar-section__body" hidden=""/);
  assert.match(markup, /value="Keep this value"/);
});

test('controlled open state overrides the default and each section owns a unique panel identity', () => {
  const markup = renderToStaticMarkup(createElement(Fragment, null,
    createElement(SidebarSection, { title: 'Projects', open: false, defaultOpen: true, children: 'Project list' }),
    createElement(SidebarSection, { title: 'Recent', open: true, defaultOpen: false, children: 'Recent list' }),
  ));
  assert.equal((markup.match(/aria-expanded="false"/g) ?? []).length, 1);
  assert.equal((markup.match(/aria-expanded="true"/g) ?? []).length, 1);
  const controls = [...markup.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
  assert.equal(controls.length, 2);
  assert.equal(new Set(controls).size, 2);
});
