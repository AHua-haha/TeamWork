# Backend API

## Purpose, responsibilities and boundaries

Backend API is the transport and composition layer of the backend. It owns HTTP routing, request shape validation, response status codes, SSE stream framing, and the composition root (`main.ts`) that wires all concrete implementations together. API exposes all backend capabilities to the browser frontend over loopback HTTP.

API never contains policy. A route handler validates shape only — the `may this happen?` question belongs to the domain layer. The composition root (`main.ts`) is the only file allowed to know every concrete implementation; no other file imports across more than one layer.

## Interface contract

**Purpose and supported interactions.** API defines the full HTTP surface described in the agent-runtime and workspace-agent team designs. It registers routes on an `http.Server`, streams SSE events to followers, and forwards requests to the domain services.

**Required inputs and returned information.**
- `createAgentServer(runtime, config, workspace, team)` — constructs and returns the HTTP application; called once by `main.ts`. Accepts an `AgentRuntime`, `ConfigService`, `WorkspaceService`, and `TeamSystem`.
- `main.ts` — reads env config, instantiates `MySqlStore`, domain services, and `AgentRuntime`; wires `webTools`, `closeBashRuntime` lifecycle; starts the server.

**Transport contract.** Every HTTP route, status code, SSE frame format, and error envelope is as specified in the agent-runtime design. `workspace-routes.ts` covers workspace/context-base/project-file/change-feed endpoints; `team-routes.ts` covers team member, group-chat, activation, and approval endpoints.

**Observable effects.** `main.ts` binds the server port, acquires the database ownership lock, runs startup migrations, and registers a SIGTERM handler for clean shutdown.

**Failure behavior.** A missing or invalid route returns JSON `{error: {code, message}}` with the appropriate 4xx/5xx. SSE stream errors send a `stream_error` event before closing. Startup failures exit the process.

## Constraints, specifications and requirements

- API imports Domain and Foundation. It must not import Storage directly except through `main.ts`.
- `main.ts` is the composition root and the only file that imports `MySqlStore` from Storage; domain services receive only the store interface declared in Domain.
- `index.ts` re-exports every public symbol from all layers, preserving the flat public API for external callers and tests.
- Route handlers must not contain activation/publication/validation logic. A handler calls a domain service method and maps its result or error to an HTTP response.
- Known violations (labeled debt): `main.ts` currently imports `MySqlStore` directly — this is intentional for Phase 1; the storage interface will be extracted in Phase 3.
