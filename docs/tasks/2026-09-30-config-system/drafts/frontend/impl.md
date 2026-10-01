<!-- Task proposal; current contract is under docs/systems/ -->

# Frontend implementation

## Contract

[Frontend design](design.md). The agent client owns backend requests, Pi data, synchronization and recovery. The assistant-ui adapter derives display messages and actions without becoming another source of history.

## Responsibilities and decomposition

The client is a UI-independent TypeScript module. It owns an immutable snapshot, a subscription API, SSE parsing, completed-record reconciliation, live Pi partials, run/connection state, and commands. The assistant-ui adapter is a React integration that converts each client snapshot into `ThreadMessageLike` values and wires `ExternalStoreRuntime` callbacks. React components own presentation only.

A separate `ConfigClient` exchanges app, connection, model-choice, catalog, capability, agent-list, and per-agent config records in the backend's JSON format. React config views own drafts, revision handling, save status, and navigation. The conversation provider receives a send gate from the agent config controller so an unconfirmed choice cannot start a run.

## Coordination and data flow

On mount or refresh, the client opens a run-scoped SSE follow request. Completed records fill its ordered history. The `sync` event establishes that the history is current, then chunks update a Pi partial by replacing it with the event's cumulative Pi `partial`. A `message` event supersedes the partial with the same identity. Gaps and reconnections clear affected partials; an unexpected EOF retries the follow operation using the last completed position. `end` closes the connection and no periodic request is scheduled. A submit POST carries only new user content; its accepted run ID starts another follow request.

The Agents route lists agents and links to the catalog and each agent's Conversation/Configuration tabs. The catalog has separate Models, Prompts, and Tools tabs. Models contains provider connection editing and a read-only, searchable backend model list. Known Pi connections show built-in choices immediately; unknown-provider saves attempt endpoint discovery. Explicit refresh queries the endpoint for either kind. Selecting a known provider fills its Pi endpoint and default protocol; the editor may choose another supported protocol and corresponding URL for that connection. Anthropic-compatible endpoints use a root URL. API keys are not retained in client records. The App Settings route edits the single app record. The agent config hook reads and saves the agent record at its revision, refreshes on focus, and handles conflicts by reloading the latest value. The composer fetches provider connections and model choices on opening, saves valid model/reasoning changes immediately, stages advanced call options for one apply, and gates Send during invalid, pending, or failed edits. Switching away from Conversation disposes only that frontend follow client; the backend run continues and resynchronizes when the user returns.

## Decisions and constraints

Vite serves React and proxies `/agents` and `/config` to the backend during development. The client uses browser `fetch` and parses the backend's SSE envelopes without depending on React. Backend protocol types are kept in the frontend client boundary with Pi AI types; runtime checks reject malformed envelopes. Assistant UI 0.15 uses `useExternalStoreRuntime`. The display converter associates separate Pi tool-result records with preceding tool-call parts and preserves source records in the client. The interface supports agent lists, catalog/config editing, send/cancel/refresh, and custom message/tool rendering. CSS supplies a light palette for all states and viewport sizes. No frontend tool execution or model-context submission is enabled.

## Code map

- [Client protocol](../../../../../frontend/src/client/protocol.ts), [SSE parser](../../../../../frontend/src/client/sse.ts), and [agent client](../../../../../frontend/src/client/agent-client.ts): backend-format data and commands.
- [Config client](../../../../../frontend/src/client/config-client.ts): backend-format config data and requests.
- [Pi projection](../../../../../frontend/src/adapter/project.ts) and [assistant-ui runtime](../../../../../frontend/src/adapter/AssistantRuntime.tsx): display conversion and UI action delegation.
- [App](../../../../../frontend/src/ui/App.tsx), [conversation view](../../../../../frontend/src/ui/Thread.tsx), and [styles](../../../../../frontend/src/ui/styles.css): agent selection and customizable UI.
- [Config pages and composer controls](../../../../../frontend/src/ui/ConfigPages.tsx) and [agent config hook](../../../../../frontend/src/ui/useAgentConfig.ts): editing and save coordination.
- [Catalog page](../../../../../frontend/src/ui/CatalogPage.tsx): kind-specific tabs, provider connections, and backend-provided model choices.
- [Client tests](../../../../../frontend/test/client.test.ts) and [adapter tests](../../../../../frontend/test/adapter.test.ts): contract verification.
- [Vite config](../../../../../frontend/vite.config.ts), [HTML entry](../../../../../frontend/index.html), [favicon](../../../../../frontend/public/favicon.svg), [package](../../../../../frontend/package.json), and [README](../../../../../frontend/README.md): development and use.

## Verification

TypeScript check and production build verify the package integration. Client tests cover completed/live reconciliation, chunk gaps, reconnect, failure, cancellation, one-run stream termination, config revision transport, and conflict errors. Adapter tests cover content/status/tool conversion and preservation of raw Pi records. A browser pass checks navigation, config editing, composer gating, and light responsive layout. This task's runs are recorded in [tests.jsonl](../../tests.jsonl).
