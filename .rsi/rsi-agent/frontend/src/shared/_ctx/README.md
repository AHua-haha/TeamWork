---
summary: Provides the frontend's shared backend facade and reusable presentation-only UI primitives while leaving workflows, state and business meaning to features.
include:
  - .rsi/rsi-agent/frontend/src/shared/backend-client/_ctx/README.md
  - .rsi/rsi-agent/frontend/src/shared/ui/_ctx/README.md
  - frontend/src/shared/backend-client/backend-client.ts
  - frontend/src/shared/backend-client/index.ts
  - frontend/src/shared/backend-client/transport.ts
  - frontend/src/shared/backend-client/protocol.ts
  - frontend/src/shared/backend-client/context-client.ts
  - frontend/src/shared/backend-client/group-client.ts
  - frontend/src/shared/ui/SequenceInspector.tsx
  - frontend/src/shared/ui/index.ts
  - frontend/src/app/main.tsx
  - frontend/src/features/workspace/ContextTab.tsx
  - frontend/test/client.test.ts
  - frontend/test/group.test.ts
  - frontend/test/backend-transport.test.ts
---

# Shared usage contract

Shared contains the frontend capabilities used by more than one feature: one configured `BackendClient` facade and presentation-only UI components. Features own data loading decisions, state, workflows, record interpretation, navigation and business policy. Backend remains authoritative for validation and durable effects.

## Backend client

Application composition uses the exported `backendClient` instance, or constructs `BackendClient` once with a custom `fetch` implementation. The facade exposes resource clients for configuration, workspaces, paged context, solo Agent runs and group chat. Resource classes are decomposed implementation units behind this shared boundary and are also exported for focused adapters and tests.

The browser normally sends relative endpoint paths. Desktop startup calls `configureBackendBase('teamwork://app/api/')`, which routes those paths through the Electron protocol bridge; `null` restores relative browser requests. The transport accepts local HTTP/HTTPS development bases and the `teamwork://app/api/` bridge, rejects other bases and passes the current string-path callers' `RequestInit` through to Fetch. It adds no caching, retries or business interpretation to ordinary requests. The Backend Client contract documents validation limits and the `Request`-object overload caveat.

Resource clients return backend-shaped records, attachment URLs for browser binary loads and parsed SSE projections. HTTP failures become `BackendError` values with status and backend code when the response has the usual error envelope. Malformed SSE, context pages, group envelopes or other validated protocol data become `ProtocolError`; invalid local identities or unavailable operations throw ordinary `Error` values. Features decide how to display, retry or recover these failures.

## Shared UI

`SequenceInspector<T>` is the current reusable UI component. It receives an ordered `items` array, optional `getKey`, row/detail render callbacks, an optional controlled `selectedKey`, an `onSelect` callback and an empty-state node. It renders a two-pane list/detail presentation. The last item is selected initially when no controlled selection is supplied; selecting a row updates local selection and invokes the callback. If the active key disappears, it proposes the last remaining item through local selection and the callback; a controlled owner must apply that callback for the displayed selection to change.

The component renders native buttons with listbox/option semantics, selected styling, visible keyboard focus and an `aria-live` detail region. CSS supplies the two-pane layout, scrolling and a narrow-screen stacked layout. It owns only selection state and immediate presentation; it does not fetch data, paginate, map records or assign meaning to actions.

Features may provide any row and detail content. Workspace uses the component for group/member context and saved summaries, while its feature-owned adapter maps Pi messages to assistant-ui renderers, raw-data inspection, images, tools and thinking details. Those message semantics and context lifecycle remain outside Shared. Storybook provides representative generic examples in `SequenceInspector.stories.tsx`.

## Boundaries and guarantees

Shared preserves the backend's JSON, binary and SSE representations, revisions, cursors, cancellation signals and stream lifecycle semantics. It does not own feature caches, optimistic policy, navigation, persistence, authorization or durable mutation decisions. Shared UI begins with the genuinely reusable inspector; feature-specific screens stay in their feature.

Example composition:

```tsx
import { backendClient } from './shared/backend-client/index.js';
import { SequenceInspector } from './shared/ui/index.js';

const workspaces = await backendClient.workspace.listWorkspaces();

<SequenceInspector
  items={items}
  getKey={(item) => item.id}
  renderRow={(item) => <span>{item.label}</span>}
  renderDetail={(item) => <pre>{item.detail}</pre>}
  onSelect={(item) => setSelected(item.id)}
/>
```
