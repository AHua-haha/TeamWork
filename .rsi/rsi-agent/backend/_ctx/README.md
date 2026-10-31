---
summary: Composes persistent Agent, Team and Workspace services into the local HTTP/SSE backend, with MySQL storage and process lifecycle wiring.
include:
  - backend/src/runtime/main.ts
  - backend/src/api/http.ts
  - backend/src/core/data.ts
  - backend/package.json
---

# Backend usage contract

The backend provides solo agents, workspace registration and model choices, provider configuration, serial workspace teams, public history and streaming progress, retained-context inspection and explicit idle member activation. Application records persist in MySQL; project source/context remain on the host filesystem. Browser and Desktop clients consume the same HTTP/SSE protocol.

## Launch and lifecycle

Operations supplies child-only settings from private `rsi.config.json`. Select Node 22.19.x, install locked dependencies and use `./scripts/dev.sh start` for a full development environment. Backend package `dev` and `start` commands go through `scripts/backend-command.mjs`; `start` requires a built package. `npm --prefix backend run build` compiles TypeScript and copies prompt assets.

Runtime constructs services, migrates owner schemas, initializes provider/Team state, acquires Agent runtime ownership and binds HTTP. One backend owns a database at a time. Restart preserves durable context/history and interrupts abandoned runs without replaying tool effects. Shutdown drains services and releases connections/shells/storage. See [Runtime](../src/runtime/_ctx/README.md) for exact settings and cleanup limitations.

## Interactions and failures

- Configure provider connections/catalogs with revision-checked records. Keys are encrypted at rest; preserve the environment's encryption key. Discovery failures are separate from saved configuration.
- Create solo agents, submit native user text/images, cancel a named run and follow persisted history plus transient progress.
- Inspect workspace initialization, then register an adopted/new directory with model settings and any reviewed cleanup revision. Registration creates a Lead and initial active bundle through Core.
- Submit workspace publications, follow bounded public history/timeline, inspect active metadata and retained context. Stop requests cancellation; reset and current-file activation require idle state.

Inputs include resource identifiers, native content, provider/model settings, expected revisions and cursors. Outputs include JSON records, acceptance/run identifiers, binary attachments and SSE frames. Invalid, unknown or conflicting input produces an explicit error envelope. Stream disconnect does not cancel independent work. Context pages require their pinned revision after the first page.

For example, `GET /agents` lists solo agents, `GET /workspaces` returns `{workspaces:[...]}`, and `GET /workspaces/w/chat/history?limit=50` reads bounded team history. `/workspaces/w/team/chat/...` is not a compatibility route. See [API](../src/api/_ctx/README.md).

## Ownership and effects

[Core](../src/core/_ctx/README.md) composes [Agent](../src/core/agent/_ctx/README.md), [Team](../src/core/team/_ctx/README.md), [Workspace](../src/core/workspace/_ctx/README.md) and [React Harness](../src/core/react-harness/_ctx/README.md). [Storage](../src/storage/_ctx/README.md) supplies technical transactions. API does no business SQL; Runtime owns hosting rather than scheduling/model policy.

Transactions coordinate durable cross-owner changes; resident state advances through commit acknowledgements. Files, Git and external calls may change before a later failure and are not automatically rolled back or replayed. Current File/Default tools run under the host OS account without path/design, command, sandbox or Git approval gates. HTTP adds no general authentication or CORS layer; exposure requires a separate access design. Includes supplement this contract and are opened on demand.
