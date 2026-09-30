<!-- Task proposal; current contract is under docs/systems/ -->

# Frontend implementation

## Contract

[Frontend design](design.md). The agent client owns backend requests, Pi data, synchronization and recovery. The assistant-ui adapter derives display messages and actions without becoming another source of history.

## Responsibilities and decomposition

The client is a UI-independent TypeScript module. It owns an immutable snapshot, a subscription API, SSE parsing, completed-record reconciliation, live Pi partials, run/connection state, and commands. The assistant-ui adapter is a React integration that converts each client snapshot into `ThreadMessageLike` values and wires `ExternalStoreRuntime` callbacks. React components own presentation only.

## Coordination and data flow

On mount or refresh, the client opens a run-scoped SSE follow request. Completed records fill its ordered history. The `sync` event establishes that the history is current, then chunks update a Pi partial by replacing it with the event's cumulative Pi `partial`. A `message` event supersedes the partial with the same identity. Gaps and reconnections clear affected partials; an unexpected EOF retries the follow operation using the last completed position. `end` closes the connection and no periodic request is scheduled. A submit POST carries only new user content; its accepted run ID starts another follow request.

## Decisions and constraints

Vite serves React and proxies `/agents` to the backend during development. The client uses browser `fetch` and parses the backend's SSE envelopes without depending on React. Backend protocol types are kept in the frontend client boundary with Pi AI types; runtime checks reject malformed envelopes. Assistant UI 0.15 uses `useExternalStoreRuntime`. The display converter associates separate Pi tool-result records with preceding tool-call parts and preserves source records in the client. The user interface supports conversation creation and selection through agent IDs, send/cancel/refresh controls, and custom message/tool rendering. CSS supplies a light palette for all states and viewport sizes; the HTML theme color and favicon match it. No frontend tool execution or model-context submission is enabled.

## Code map

- [Client protocol](../../../../../frontend/src/client/protocol.ts), [SSE parser](../../../../../frontend/src/client/sse.ts), and [agent client](../../../../../frontend/src/client/agent-client.ts): backend-format data and commands.
- [Pi projection](../../../../../frontend/src/adapter/project.ts) and [assistant-ui runtime](../../../../../frontend/src/adapter/AssistantRuntime.tsx): display conversion and UI action delegation.
- [App](../../../../../frontend/src/ui/App.tsx), [conversation view](../../../../../frontend/src/ui/Thread.tsx), and [styles](../../../../../frontend/src/ui/styles.css): agent selection and customizable UI.
- [Client tests](../../../../../frontend/test/client.test.ts) and [adapter tests](../../../../../frontend/test/adapter.test.ts): contract verification.
- [Vite config](../../../../../frontend/vite.config.ts), [HTML entry](../../../../../frontend/index.html), [favicon](../../../../../frontend/public/favicon.svg), [package](../../../../../frontend/package.json), and [README](../../../../../frontend/README.md): development and use.

## Verification

TypeScript check and production build verify the package integration. Client tests cover completed/live reconciliation, chunk gaps, reconnect, failure, cancellation, and one-run stream termination. Adapter tests cover content/status/tool conversion and preservation of raw Pi records. A browser pass with a local protocol mock checked creation, submission, completed output, refresh, new-agent routing, and desktop/mobile layout; it caught and resolved a browser `fetch` binding issue. A later browser pass checked the requested light theme in empty and completed states at desktop/mobile widths. Every run is recorded in the task's `tests.jsonl` with increment start commit `02b74248227a8b538688bb95f16b0c27ac5f0e50`. The reviewed design and implementation are promoted with the frontend code in this checkpoint.
