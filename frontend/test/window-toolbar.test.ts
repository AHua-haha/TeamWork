import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from '../src/shared/ui/AppShell.js';
import { WindowToolbar } from '../src/shared/ui/WindowToolbar.js';

test('window toolbar exposes application identity, panel title and supplied actions in order', () => {
  const markup = renderToStaticMarkup(createElement(WindowToolbar, {
    brand: createElement('strong', null, 'Application'),
    title: 'Current panel',
    actions: createElement('button', { type: 'button', 'aria-label': 'Refresh panel' }, 'Refresh'),
    sidebarOpen: true,
    sidebarId: 'project-sidebar',
    onSidebarToggle: () => {},
  }));
  assert.ok(markup.indexOf('Application') < markup.indexOf('Current panel'));
  assert.ok(markup.indexOf('Current panel') < markup.indexOf('Refresh panel'));
  assert.match(markup, /type="button"[^>]*aria-label="Hide sidebar"/);
  assert.match(markup, /aria-expanded="true" aria-controls="project-sidebar"/);
});

test('closing preserves logo, app name and reopening control while only the sidebar becomes inert', () => {
  const markup = renderToStaticMarkup(createElement(AppShell, {
    toolbar: createElement(WindowToolbar, {
      logo: createElement('span', { 'data-testid': 'app-logo' }, 'R'),
      brand: 'Application', title: 'Current panel', sidebarOpen: false,
      sidebarId: 'project-sidebar', onSidebarToggle: () => {},
    }),
    navigationRail: 'Navigation', sidebar: createElement('input', { defaultValue: 'Retained draft' }),
    sidebarOpen: false, sidebarId: 'project-sidebar', children: 'Panel content',
  }));
  assert.match(markup, /data-sidebar-open="false"/);
  assert.match(markup, /class="shared-window-toolbar__logo"><span data-testid="app-logo">R<\/span><\/div><div class="shared-window-toolbar__brand">Application<\/div>/);
  assert.doesNotMatch(markup, /class="shared-window-toolbar__brand"[^>]*(?:aria-hidden|inert|hidden)/);
  assert.match(markup, /aria-label="Show sidebar"[^>]*aria-expanded="false"/);
  assert.match(markup, /<aside[^>]*id="project-sidebar"[^>]*aria-hidden="true" inert=""/);
  assert.doesNotMatch(markup, /\shidden=/);
  assert.match(markup, /shared-app-shell__sidebar-content/);
  assert.match(markup, /value="Retained draft"/);
  assert.match(markup, /Current panel/);
  assert.match(markup, /Panel content/);
});

test('optional toolbar actions do not leave an empty actions container', () => {
  const markup = renderToStaticMarkup(createElement(WindowToolbar, {
    brand: 'Application', title: 'Panel', sidebarOpen: true, onSidebarToggle: () => {},
  }));
  assert.doesNotMatch(markup, /shared-window-toolbar__actions/);
});
