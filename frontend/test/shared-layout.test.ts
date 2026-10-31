import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell, ThreadColumn, ThreadRow } from '../src/shared/ui/AppShell.js';
import { NavigationRailButton } from '../src/shared/ui/NavigationRailButton.js';
import { SidebarHeader } from '../src/shared/ui/SidebarHeader.js';

test('navigation controls have accessible labels and sidebar header actions remain outside title content', () => {
  const markup = renderToStaticMarkup(createElement('div', null,
    createElement(NavigationRailButton, { label: 'Home', icon: createElement('span', null, 'H') }),
    createElement(SidebarHeader, { children: 'Workspace', actions: createElement('button', { type: 'button' }, 'Search') }),
  ));
  assert.match(markup, /shared-navigation-rail-button/);
  assert.match(markup, /aria-label="Home"/);
  assert.match(markup, /shared-navigation-rail-button__icon/);
  assert.match(markup, /shared-sidebar-header"><div class="shared-sidebar-header__content">Workspace<\/div><div class="shared-sidebar-header__actions">/);
});

test('rail buttons expose caller-owned active and disabled states without submitting forms', () => {
  const active = renderToStaticMarkup(createElement(NavigationRailButton, {
    label: 'Projects', icon: 'P', active: true, disabled: true,
  }));
  assert.match(active, /type="button"/);
  assert.match(active, /aria-current="page"/);
  assert.match(active, /disabled=""/);
  assert.match(active, /aria-hidden="true">P/);
  const inactive = renderToStaticMarkup(createElement(NavigationRailButton, { label: 'Home', icon: 'H' }));
  assert.doesNotMatch(inactive, /aria-current|disabled/);
});

test('sidebar headers without actions render no empty action container', () => {
  const markup = renderToStaticMarkup(createElement(SidebarHeader, { children: 'Workspace', className: 'consumer-header' }));
  assert.match(markup, /class="shared-sidebar-header consumer-header"/);
  assert.doesNotMatch(markup, /shared-sidebar-header__actions/);
});

test('shared shell places its full-width toolbar before the navigation, sidebar and main content', () => {
  const markup = renderToStaticMarkup(createElement(AppShell, {
    toolbar: createElement('span', null, 'Window toolbar'),
    navigationRail: createElement('button', { type: 'button' }, 'Navigation action'),
    sidebar: createElement('p', null, 'Sidebar content'),
    children: createElement('p', null, 'Thread content'),
    navigationLabel: 'Application sections',
    sidebarLabel: 'Project conversations',
  }));
  assert.match(markup, /<header[^>]*><span>Window toolbar<\/span><\/header><div class="shared-app-shell__body">/);
  assert.match(markup, /<nav[^>]*aria-label="Application sections"[^>]*>[\s\S]*Navigation action[\s\S]*<\/nav><aside[^>]*aria-label="Project conversations"/);
  assert.match(markup, /<\/aside><main[^>]*><p>Thread content<\/p><\/main>/);
});

test('omitting shell side slots renders main content directly without empty navigation landmarks', () => {
  const markup = renderToStaticMarkup(createElement(AppShell, {
    toolbar: 'Toolbar', children: 'Main content', className: 'consumer-frame', style: { height: 700 },
  }));
  assert.doesNotMatch(markup, /<nav|<aside/);
  assert.match(markup, /class="shared-app-shell consumer-frame" style="height:700px"/);
  assert.match(markup, /<div class="shared-app-shell__body"><main[^>]*>Main content<\/main>/);
});

test('thread rows keep accessible avatars in a sibling gutter outside message content', () => {
  const markup = renderToStaticMarkup(createElement(ThreadColumn, {
    children: createElement(ThreadRow, {
      avatar: createElement('span', { role: 'img', 'aria-label': 'Assistant avatar' }, 'A'),
      children: createElement('article', null, 'Message content'),
    }),
  }));
  assert.match(markup, /<div class="shared-thread-column__content"><div class="shared-thread-row shared-thread-row--with-avatar">/);
  assert.match(markup, /<div class="shared-thread-row__avatar"><span role="img" aria-label="Assistant avatar">A<\/span><\/div><div class="shared-thread-row__content"><article>Message content<\/article><\/div>/);
});

test('thread content without an avatar renders no avatar element and preserves supplied order', () => {
  const markup = renderToStaticMarkup(createElement(ThreadColumn, {
    className: 'consumer-thread',
    children: [
      createElement(ThreadRow, { key: 'first', children: 'First message' }),
      createElement(ThreadRow, { key: 'second', children: 'Second message' }),
    ],
  }));
  assert.match(markup, /class="shared-thread-column consumer-thread"/);
  assert.doesNotMatch(markup, /shared-thread-row__avatar|shared-thread-row--with-avatar/);
  assert.ok(markup.indexOf('First message') < markup.indexOf('Second message'));
});
