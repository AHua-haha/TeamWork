# Backend Client

## Purpose and responsibilities

Backend Client owns one public frontend client for reaching the backend. It centralizes HTTP, binary and SSE transport, request encoding, response parsing and transport/protocol error representation. It is internally decomposable by resource, but features consume one public client rather than separate public Workspace, Chat or Provider clients.

## Interface contract

**Input:** backend endpoint operations, request payloads, expected revisions/cursors, cancellation signals and stream options.

**Output:** parsed backend API representations, binary responses, SSE events and typed transport/protocol failures.

**Effect:** performs network requests and manages transport-level stream/reconnect/cancellation behavior. It does not own feature state, caching, optimistic updates, business workflows, business validation or feature-specific view-model mapping.

**Usage example:** `backend.workspaces.list()` returns backend workspace records; the Home or Workspace feature decides how to store, combine and display them. `backend.chat.follow(cursor)` returns decoded stream events; Chat decides how to merge them with stable history.

## Public shape

Application startup creates one configured client instance and makes it available to features through the App composition. Internal endpoint modules may be separated by resource for maintainability, but they are implementation details behind the single public `BackendClient` facade.

## Constraints

- Preserve existing HTTP/JSON, binary and SSE payloads, cursors, revisions and lifecycle semantics.
- Unknown paths, malformed responses and transport failures remain explicit.
- Do not move feature interpretation or durable business policy into this layer.

## Chat roster transport

Expose the backend's narrow roster separately from full team inspection. The frontend feature owns refresh coalescing and temporary-mode policy; transport does not synthesize missing readiness/harness fields. Member activation continues to use the committed-review and revision/digest activation endpoints.
