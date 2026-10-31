---
summary: React browser and Electron renderer application for provider configuration, solo chat and workspace teams, built from App, Features and Shared layers.
include:
  - frontend/package.json
  - frontend/vite.config.ts
  - frontend/index.html
  - frontend/src/app/main.tsx
---

# Frontend usage contract

The frontend is one React application shared by browser hosts and Electron. It presents providers, solo conversations and project workspace teams, including streamed work, member activation, model choices and read-only context inspection. Backend records and revisions/cursors remain authoritative.

## Run and compose

Use Node 22.19.x and `npm ci --prefix frontend`. `npm --prefix frontend run check` type-checks; `npm --prefix frontend test` runs package tests; `npm --prefix frontend run build` type-checks and writes `frontend/dist`. Storybook commands provide presentation examples separately.

For development use `./scripts/dev.sh start`. Vite serve requires Operations-supplied `AGENT_BACKEND_ORIGIN`, proxies `/agents`, `/config` and `/workspaces`, and disables env-file loading. Static builds do not require that setting; their host must route API paths to a backend. Operations' frontend server does so in deployment. Electron supplies `window.desktopAPI.apiBase` through its proxy; the renderer does not discover or supervise a backend.

Startup requires the DOM element `root`. [App](../src/app/_ctx/README.md) configures transport, mounts React and owns routes/shell composition. [Features](../src/features/_ctx/README.md) owns Home, Providers, Chat and Workspace workflows. [Shared](../src/shared/_ctx/README.md) owns backend protocol clients/facade and generic presentation.

## Interactions, effects and failures

Supported addresses include `?page=home`, `?page=providers`, `?agent=<id>` and `?workspace=<id>`. IDs accept 1–64 ASCII letters, digits, underscores or hyphens; unrecognized addresses fall back to Home. The visible rail groups navigation into Conversations and Config.

Configure providers/models, create a solo conversation or inspect/register a workspace, then send text/images. Team interactions use backend scheduling. Stable history pages/incremental changes are reconciled separately from transient streams. Configuration and cleanup reviews use explicit backend revisions. On conflict, refresh/review again rather than repeating stale cleanup consent.

Requests can change durable records, files or external systems on the backend. Navigation/disconnection does not itself cancel backend work; explicit cancellation/stop is separate. App stores last-chat navigation in session storage; Workspace owns browser-local panel state. Context reads are revision-pinned and read-only; no retained-context editor exists.

Workflow errors are displayed locally with retry where supported. App list failures preserve shell retry controls; app-settings read failure leaves defaults while backend permissions remain enforced. No application-wide React error boundary or offline execution is provided.

## Design alignment

Frontend/App DESIGN describes four destinations, whereas the shell has Conversations/Config sections and query routing. Home supplies entry actions while App owns workspace/conversation lists and creation. Workspace's implemented panels are narrower than its optional DESIGN inventory. These are documented without changing intent or expanding behavior. Child contracts provide details. Includes supplement README and are not automatically loaded.
