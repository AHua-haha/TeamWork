## Result summary

Implemented context was rebuilt from the accepted Backend API design and inspected current source. API is the HTTP transport and route composition layer; it forwards to domain services, performs transport/shape validation, maps errors, and streams follow feeds as SSE. No project source was changed for this context task. The working tree has extensive unrelated source edits/deletions already present; preserve them.

Known discrepancies/debt: actual API has expanded config, workspace/context-base, files/designs, team configuration/chat/timeline/image and approvals routes beyond the older design's abbreviated route list. `index.ts` exports many domain symbols (not merely a narrow API surface). Current route handlers instantiate `DesignService` in workspace-routes and perform some policy-like feature gating (`allowAgentCreation`); compare this against the design's route-only shape-validation constraint. Verify intended endpoint contract against domain designs before changing code.

## File lookup

| Path | Description |
|---|---|
| `backend/src/api/http.ts` | Config/agent HTTP endpoints and top-level route dispatch. |
| `backend/src/api/http-helpers.ts` | Route type, JSON/body/query validation, error envelope, SSE/backpressure. |
| `backend/src/api/workspace-routes.ts` | Workspace, models, designs, files, context-base and change-feed routes. |
| `backend/src/api/team-routes.ts` | Team members/configuration, approvals, shared chat/timeline/image routes. |
| `backend/src/api/index.ts` | Flat exports across API and backend modules. |
| `.rsi/context/design/backend/api/design.md` | Accepted API design and transport expectations. |

## Implemented contract

### `createAgentServer(runtime, config, workspaces, team)`

**Input:** concrete `AgentRuntime`, `ConfigService`, `WorkspaceService`, and `TeamSystem` objects. The function closes over route handlers and uses Node HTTP requests; no explicit port is supplied. **Output:** Node `http.Server`; caller must listen/close it. **Effect:** request handling invokes supplied service methods. It does not itself bind a socket. Unmatched routes yield `not_found`; service/validation failures are converted by `respond` to `{error:{code,message}}` with an `AppError` status or 503 for unknown errors. **Example:** `const server = createAgentServer(runtime, config, workspaces, team); server.listen(port, '127.0.0.1');`.

### HTTP helpers

`body(request, limit = 2 MiB)` requires `application/json`, enforces byte limit, parses a non-array object; invalid content gives 415/400 and oversized input 413. `fields` rejects unknown keys. `query` rejects unknown or duplicate query keys. `json` writes JSON with UTF-8 content type. `respond(handler)` creates an abort signal per client connection and centralizes error handling/logging. `sse(response, asyncGenerator, signal, errorFields={})` obtains first event before headers (thus first-read errors can retain normal HTTP status), then emits `event: <type>` and JSON data frames, heartbeat comments every 15s, honors backpressure, emits `stream_error` on later errors, closes generator in `finally`. Usage: `await sse(response, feed(), signal, {workspaceId});`.

### Routes

`/agents` exposes agent list/create; `/agents/:id/config`, state, run start/cancel and follow. Follow accepts only `runId`/`after`, validates cursor and streams `runtime.follow`. `/config` supports capabilities, app, connection/model choices and catalog CRUD. Workspace routes expose registry, models, designs, project files and context base overview/tree/file/history/find/search/changes/follow and mutation endpoints. Team routes expose team/member inspection, model settings, configuration review/activation, commit approvals, chat history/timeline/follow, multipart chat image publication and attachment retrieval, reset/stop/configuration, and change feeds. Concrete endpoint inputs/defaults and status behavior are encoded in route helpers; service contracts remain in domain context. Workspace/team JSON request limits are 4 MiB/1 MiB respectively (shared helper default 2 MiB). All query handlers whitelist parameters.

**Effects:** route methods delegate persistent changes to domain/runtime; API itself owns no persistence. SSE may keep a connection open and aborts feed on disconnect. Image retrieval writes raw bytes with MIME/length and nosniff headers.

## Implementation notes

`http.ts` selects workspace/team routes for `/workspaces`; all other routes are config/agent. `respond` handles AppError and unknown exceptions. Source presently imports domain service implementations/types, Foundation validation and Node HTTP. `main.ts` is composition root; it alone should directly wire storage. The accepted design specifies `createAgentServer(runtime, config, workspace, team)` and design-observed Storage access exception in main.

## Verification and continuation

Inspected all five API files and relevant Foundation interfaces. No tests were run; no project source was modified. Verify endpoint-by-endpoint against accepted agent/workspace/team designs when available. Reconcile route-level policy concerns and the broad `index.ts` export surface only through a separately agreed implementation task.

## Automatic retrieval

```json
{"commands": []}
```
