# Backend Client

## Purpose and responsibilities

Backend Client owns one public frontend client for reaching the backend. It centralizes HTTP, binary and SSE transport, request encoding, response parsing and transport/protocol error representation. It is internally decomposable by resource, but features consume one public client rather than separate public Workspace, Chat or Provider clients.

## Interface contract

**Input:** backend endpoint operations, request payloads, expected revisions/cursors, cancellation signals and stream options. Context inspection operations include read-only paged group context by workspace and read-only paged member context by workspace/member, each carrying offset, limit and optional selected revision.

**Output:** parsed backend API representations, binary responses, SSE events and typed transport/protocol failures. Context inspection returns the backend page representation unchanged at the envelope level: revision, offset, total, nextOffset and entries containing stable message IDs, native Pi messages and metadata. The frontend client types each context entry's `message` with Pi's public `Message` union and validates the entry envelope/role before returning it; it does not map or otherwise reinterpret message content.

**Effect:** performs network requests and manages transport-level stream/reconnect/cancellation behavior. It does not own feature state, caching, optimistic updates, business workflows, business validation or feature-specific view-model mapping. Context reads are no-store/read-only and revision conflicts remain explicit for the Workspace feature to recover.

**Usage example:** `backend.workspaces.list()` returns backend workspace records; the Home or Workspace feature decides how to store, combine and display them. Context inspection is available as `backend.context.group(workspaceId, options)` and `backend.context.member(workspaceId, memberId, options)`; each returns the backend page envelope unchanged, and the feature handles page progression and stale-revision recovery.

## Public shape

Application startup creates one configured client instance and makes it available to features through the App composition. Internal endpoint modules may be separated by resource for maintainability, but they are implementation details behind the single public `BackendClient` facade.

## Constraints

- Preserve existing HTTP/JSON, binary and SSE payloads, cursors, revisions and lifecycle semantics.
- Unknown paths, malformed responses and transport failures remain explicit.
- Do not move feature interpretation or durable business policy into this layer.

## Chat roster transport

Expose the backend's narrow roster separately from full team inspection. The frontend feature owns refresh coalescing and temporary-mode policy; transport does not synthesize missing readiness/harness fields. Member activation continues to use the committed-review and revision/digest activation endpoints.
