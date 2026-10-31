---
summary: Exposes the single frontend BackendClient facade for HTTP, JSON, binary and SSE backend access, including validated Agent, group-chat and context projections.
include:
  - frontend/src/shared/backend-client/backend-client.ts
  - frontend/src/shared/backend-client/agent-client.ts
  - frontend/src/shared/backend-client/config-client.ts
  - frontend/src/shared/backend-client/workspace-client.ts
  - frontend/src/shared/backend-client/context-client.ts
  - frontend/src/shared/backend-client/group-client.ts
  - frontend/src/shared/backend-client/transport.ts
  - frontend/src/shared/backend-client/sse.ts
  - frontend/src/shared/backend-client/progress.ts
  - frontend/src/shared/backend-client/protocol.ts
  - frontend/src/shared/backend-client/discussion-reference.ts
  - frontend/src/shared/backend-client/index.ts
  - frontend/src/app/main.tsx
  - frontend/test/client.test.ts
  - frontend/test/group.test.ts
  - frontend/test/context-client.test.ts
  - frontend/test/backend-transport.test.ts
  - backend/src/api/team-routes.ts
  - .rsi/rsi-agent/backend/src/api/_ctx/README.md
  - .rsi/rsi-agent/desktop/_ctx/README.md
---

# Backend Client usage contract

Backend Client is the frontend boundary for backend communication. Application composition creates or imports one `BackendClient`; features use its resource clients rather than configuring independent transports. The public facade currently exposes `config`, `workspace` and `context` properties, `createAgent()`, `agent(agentId, options?)` and `group(workspaceId)`. The facade passes its fetcher to resource clients; `agent()` also accepts an explicit per-client fetcher override. Resource classes and protocol types are also publicly exported and can be constructed independently, although application composition uses the facade. Constructing `agent()` or `group()` creates a new instance each time; the facade does not cache or dispose these instances.

## Transport and errors

The default `apiFetch` sends relative paths through the browser's normal same-origin behavior. Base configuration is module-global and applies to every client using `apiFetch`, including already constructed instances; a custom injected fetcher owns its own transport behavior. Desktop startup calls `configureBackendBase('teamwork://app/api/')`; the transport resolves relative paths beneath that base so Electron can proxy them to its configured backend origin. `configureBackendBase(null)` restores browser-relative requests. HTTP/HTTPS bases with hostname `localhost` or `127.0.0.1` are accepted for development; `teamwork:` bases must have host `app` and a pathname ending in `/api/`. Other bases throw `Error`; this check is not an authentication boundary or a canonical-origin validator. `apiUrl()` resolves endpoint paths against the configured base and `imageUrl()` supplies a URL for browser image requests. There is no separate binary-download method.

Current endpoint callers pass URL strings and `RequestInit`; `apiFetch` forwards that init unchanged. Its `Request` overload forwards only `input.url` plus the separately supplied init, so callers must not depend on properties carried solely by a `Request` object. Absolute inputs retain normal URL-resolution behavior. The adapter adds no timeout, authentication, retry or cache. Resource clients use JSON for configuration and workspace commands, multipart or JSON for group messages and SSE for follow operations. Group images are loaded through browser URL consumers. Electron forwards responses and streams but currently does not explicitly propagate renderer aborts to upstream Fetch.

Non-2xx JSON error envelopes become `BackendError(message, status, code)`. Invalid local identities, empty submissions and unavailable client operations throw `Error`. Malformed validated envelopes, unsupported event types, SSE framing errors and inconsistent sequence/revision data become `ProtocolError`. Backend invalid-cursor responses retain their `BackendError` codes for recovery. Fetch failures and JSON parse failures otherwise propagate as native errors. Configuration/workspace success payloads are typed rather than structurally validated; their shared JSON helper returns `null` on unparseable successful JSON. Validation depth therefore differs by operation. Features own user-facing handling.

## Resource clients

`ConfigClient` reads and writes application, Agent, connection and catalog configuration, capabilities and model catalogs. Records generally carry `{id, revision, value}`; updates/deletes send the record's current revision and leave stale-revision conflicts explicit. Connection input may include `apiKey`; the returned `ConnectionView` exposes `keyConfigured`, not the credential. `RunSettings` carries connection/model selection, tool/prompt option IDs, prompt text and per-model options; Agent settings add a name. The client does not resolve credentials or determine model readiness.

`WorkspaceClient` returns `{workspaceId, name, directory, createdAt}` records, roster metadata and revisioned workspace/member model settings. Initialization inspection takes `{directory, adopt}` and returns `{directory, cleanupPaths, cleanupRevision}`; creation takes `{name, directory, adopt, models, cleanupRevision?}`. The feature owns review/confirmation; the client forwards the captured request without automatically cleaning, retrying conflicts or activating members.

| Supported calls | Request / result behavior |
| --- | --- |
| `config.getApp/updateApp`, `listAgents/capabilities` | `/config/app`, `/agents`, `/config/capabilities`; reads and revisioned app updates. |
| `config.listConnections/createConnection/updateConnection/deleteConnection` | `/config/connections[/id]`; JSON create/update/delete with revisions where required. |
| `config.modelChoices(connectionId, discover?)` | GET `/config/connections/:id/models`, or POST `/refresh` with `{}` for backend discovery. |
| `config.listCatalog/createCatalog/updateCatalog/deleteCatalog` | `/config/catalog[/id]`; typed tool/prompt catalog records. |
| `config.getAgent/createAgentConfig/updateAgent` | `/agents/:id/config`; complete Agent settings and backend issues. |
| `workspace.listWorkspaces/getWorkspace` | GET `/workspaces` or `/workspaces/:id`; list unwraps the backend's `workspaces` array. |
| `workspace.inspectInitialization/createWorkspace` | POST `/workspaces/initialization` or `/workspaces`; inspection or backend creation effects. |
| `workspace.members/member/roster` | Canonical `/workspaces/:id/members[/memberId]`; `roster()` aliases `members()`. |
| `workspace.workspaceModels/updateWorkspaceModels` | `/workspaces/:id/models`; revisioned workspace model pool/default. |
| `workspace.memberModelSettings/updateMemberModelSettings` | `/workspaces/:id/members/:memberId/model-settings`; revisioned connection/model/options only. |
| `workspace.activateMemberConfiguration` | POST `/workspaces/:id/team/configuration/activate` with JSON `{}`; returns `{revision, memberIds}`. No file diff, expected digest/revision or Git handshake is sent. |

Roster members carry `memberId`, `workspaceId`, `revision`, `name`, `role`, `responsibility`, `lead` and `running`; the client does not synthesize readiness/harness fields. Feature code owns editing state, refresh/coalescing, temporary-mode policy and conflict handling. Activation is a distinct caller-initiated durable command, not a consequence of a read.

`ContextClient` provides read-only paged inspection:

- `group(workspaceId, options?)` reads `/workspaces/:id/chat/context`.
- `member(workspaceId, memberId, options?)` reads `/workspaces/:id/members/:memberId/context`.
- `summary(workspaceId)` reads the saved group summary.

Page options are `offset`, `limit` and optional `revision`. Pages preserve `{revision, offset, total, nextOffset, entries}` and each entry preserves its `messageId`, native Pi `Message` and metadata. The client validates nonnegative safe page numbers, the entry envelope and supported Pi message roles; it does not deeply validate every content part or reinterpret message content. Backend pagination defaults to 50 entries with a 1–100 limit; offset pages beyond zero require their first page's revision. Revisions are independent per group/member context. Requests send `Accept: application/json` and `Cache-Control: no-cache`; the backend responds with `Cache-Control: no-store`. The client does not set Fetch's `cache` option here, accept an abort signal, automatically page or retry. It serializes page options, leaving range/revision consistency checks to the backend. A backend `context_changed` 409 remains a `BackendError` so the feature can restart at offset zero. Summary validation preserves its revision, coverage, digest, text, message ID, timestamp and fixed retained-message count.

`AgentClient` represents one solo Agent or a member's private run history. `BackendClient.agent(id, options)` accepts `historyAfter`, `basePath`, `retryDelayMs` and a fetcher override; `historyAfter` starts the completed-history cursor at a caller-supplied boundary, and `follow(runId)` pins a private-run inspection. `getSnapshot()` and `subscribe()` expose completed backend records, transient live messages, run state, completed-history position, connection state, sending state and an error. `follow(runId?)` and `refresh()` synchronize completed records before applying compact live chunks; `send(input)` submits text or Pi user content and follows the acknowledged run; `cancel()` requests cancellation; `dispose()` aborts active following and removes listeners. Completed records remain authoritative. A gap discards the affected partial message until a completed record arrives. Reconnect resumes at the last completed position with exponential delay capped at 8 seconds by default; there is no retry-count limit. Protocol and client 4xx failures stop in `error`, while ordinary disconnections retry. Client disconnect/navigation does not cancel backend work.

`GroupClient` represents one workspace chat. It exposes the same snapshot/subscription pattern plus `follow()`, `refresh()`, `loadOlder()`, `send(text, images?)`, `reset()`, `stop()` and `dispose()`. Follow first reads the latest 50 history entries, then follows the independent timeline cursor through SSE. Older pages use `nextBefore` and a reset cursor. Entries are ordered by backend position; duplicate changes do not advance the cursor, gaps and malformed events stop protocol processing, and reset or backend-declared invalid/expired cursors recover another latest-50 snapshot. Recovery is bounded by page size, not by a finite retry count. Refresh/reconnect otherwise retain already loaded pages and resume the applied update cursor. An older-page failure is reported separately and may be retried with `loadOlder()`. POST acknowledgements merge reserved entries without advancing the feed cursor, and stale acknowledgements cannot resurrect entries removed by reset. `send()` locally checks nonempty text-or-files and a maximum of four files, then sends the original text and file bytes; MIME/size/content policy is enforced by the feature/backend, while returned attachment metadata is validated as PNG/JPEG. Reset and stop remain explicit backend commands. `send()` and `reset()` publish command errors and reject; `stop()` publishes failures without rethrowing. Disposing cancels follow/older-page requests and listeners, not already submitted commands or backend work. `GroupSnapshot` exposes connection, synchronization, history, command and busy states for feature-owned presentation.

`ProgressReducer` turns Pi compact assistant frames into an immutable assistant message for `AgentClient` live state. `readSse()` handles split UTF-8, CRLF, comments, multiline data and incomplete-frame errors. It emits `{name, data}` frames and releases its reader lock on exit; application cursors/retry logic are owned by the resource clients rather than SSE `id`/`retry` fields. `protocol.ts` defines backend-owned records and run/event unions; no assistant-ui types cross this boundary.

## Guarantees and boundaries

The client preserves backend endpoint paths, JSON/binary/SSE payloads, revisions, cursors, cancellation signals and final-reference data. It owns transport, protocol validation and stream lifecycle only. It maintains the in-memory protocol snapshots needed by the Agent/group feed contracts but does not own React state, feature caches, backend validation, durable persistence, navigation or mapping into feature-specific view models.

`discussion-reference.ts` is an existing exception to the transport-only boundary: it exports discussion labels/input formatting and a `Discussion` callback shape. Its design-reference text currently embeds the retired `.rsi/context/design/` location. This helper remains unchanged; its location and path wording need review.

The backend API contract and this client use canonical `/workspaces/:id/chat/...` and `/workspaces/:id/members/...` paths. Actual routing in `backend/src/api/team-routes.ts` rejects the former `/team/chat/...` and `/team/members/...` aliases. Activation retains `/workspaces/:id/team/configuration/activate` with JSON `{}`. The API README's earlier stale examples were corrected during project-level reconciliation.

Example:

```ts
import { backendClient } from './shared/backend-client/index.js';

const workspaces = await backendClient.workspace.listWorkspaces();
const page = await backendClient.context.member(workspaceId, memberId, { limit: 50 });
const chat = backendClient.group(workspaceId);
const stopFollowing = chat.subscribe(() => render(chat.getSnapshot()));
chat.follow();
// stopFollowing(); chat.dispose() when the feature leaves the view
```
