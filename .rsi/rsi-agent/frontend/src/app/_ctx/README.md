---
summary: Mounts the shared React application, configures backend transport, parses query routes and composes navigation, resource lists and feature pages.
include:
  - frontend/src/app/
  - frontend/index.html
---

# App usage contract

App provides `App`, the React entry module, query-route helpers and global styles. It composes feature pages with Shared's backend facade. The actual shell also owns resource lists and initial conversation/configuration requests, even where DESIGN describes a thinner navigation layer.

## Startup and routes

`main.tsx` configures the shared backend base from `window.desktopAPI.apiBase` when present, requires `document.getElementById('root')`, imports CSS and mounts `<App />`. Browser API paths remain relative to the host. App stores no provider keys or backend discovery configuration.

`readRoute(search)` returns Home, Providers, solo conversation or Workspace. IDs match `/^[A-Za-z0-9_-]{1,64}$/`. Valid `workspace` wins over valid `agent`, then `page=providers`, otherwise Home. `routeUrl(route)` writes the canonical query string; `sameRoute(a,b)` compares those strings.

```ts
readRoute('?workspace=w&agent=a'); // {page: 'workspace', id: 'w'}
routeUrl({page: 'conversation', id: 'a'}); // '?agent=a'
readRoute('?page=unknown'); // {page: 'home'}
```

App uses `pushState` and `popstate`, without a routing library. Navigation clears the shell setup error and closes narrow-screen sidebar state. `sessionStorage.lastChat` remembers the last workspace/conversation; storage failure does not disable navigation. Feature pages are keyed by resource id.

## Shell interactions

Mount/window focus loads agents, workspaces, connections and app settings. Title updates `document.title`; `allowAgentCreation` controls conversation buttons. Failed lists show retry controls; failed app-settings reads retain defaults while backend enforcement remains authoritative.

The rail has Conversations and Config. Selecting the current section toggles the sidebar; Config opens Providers and Conversations restores last chat or Home. Sidebar search filters workspace name/directory and agent name/id locally. It lists workspaces, solo conversations and provider shortcuts with a mobile scrim. App passes Providers records, loading/errors, refresh and focused connection.

Starting a conversation creates an Agent, tries to create empty initial settings, refreshes the list and navigates. Settings failure after creation leaves the Agent created. App sets a setup warning, but the subsequent navigation clears that same shell error; a persistent failure banner is not guaranteed. There is no rollback.

Renaming reads current configuration and performs a revision-checked update with trimmed name, then refreshes list/config state. Failure preserves editing/error state. Workspace creation opens Feature-owned `CreateWorkspaceDialog`; success updates the list and navigates. App supplies Workspace's files-panel open/expanded state, while the feature determines available content.

## Effects and design alignment

App issues backend requests, changes URL/session storage/title and mounts/unmounts features. Navigation/focus refresh does not explicitly cancel backend work. Errors are handled locally; there is no global React error boundary.

DESIGN describes four navigation destinations, feature-owned workflows and error boundaries. Current behavior is the two-section shell and some shell-owned workflows above, with query fallback but no React error boundary. Confirm intent before changing those boundaries. Detailed workflows belong to [Features](../../features/_ctx/README.md), and transport/presentation primitives to [Shared](../../shared/_ctx/README.md). Includes supplement README and are opened explicitly.
