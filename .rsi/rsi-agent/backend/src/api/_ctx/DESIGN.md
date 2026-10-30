# API

## Purpose, responsibilities and boundaries

API owns the backend's HTTP/SSE transport and request/response representation. It validates request shape, maps Core results/errors to protocol responses and manages streaming/backpressure, binary input and disconnects. Core owns semantic validation and business decisions.

## Interface contract

The server factory accepts Core services and returns an HTTP server without binding it. Runtime starts and closes it. Requests identify resources and carry JSON or multipart images, revisions/cursors and control actions. JSON results, status codes, error envelopes, binary images and SSE event semantics preserve the existing frontend contract.

Multipart parsing belongs to API; image preparation/validation semantics belong to Core. Follow streams present Core records/deltas and honor backpressure and cancellation without driving agent execution. Unknown paths/input formats fail explicitly; errors after headers follow the stream-error contract. API does not query application tables, run business migrations or implement cooperation/permission policy.

### Workspace initialization

`POST /workspaces/initialization` accepts directory and adopt and returns a read-only initialization inspection: canonical directory, cleanupPaths and cleanupRevision (null when no nonempty metadata). `POST /workspaces` additionally accepts optional cleanupRevision. Without matching reviewed cleanup consent, nonempty metadata returns a conflict. Existing content under `.rsi/context/` is preserved; source files and Git state are unchanged. Other registered workspaces cannot be cleaned or reinitialized through this operation.

### Context inspection


Provide read-only workspace-scoped endpoints for current retained member context and effective shared group context (accepted summary plus original tail). Each returns ordered entries with their native Pi message, stable identity and metadata, plus pagination and revision information. Require the selected revision on subsequent pages and report a conflict when the underlying context changes; the caller refreshes from the beginning.

Validate query shape and member/workspace boundaries. Reads work during execution and without runtime ownership, return no transient stream chunks, and perform no synchronization, repair or compaction. Preserve signed and multimodal content exactly. Prevent caching these debug reads. Existing history/timeline and stream contracts remain unchanged. The Context inspector presents these read-only records.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.

## Lightweight team roster

Provide a workspace-scoped read-only roster endpoint for chat presentation. Return only accepted active member identity/presentation fields and running flags, with no effective harness or readiness assessment. Existing detailed team/member endpoints remain available, preserving their behavior.

### Group summary inspection

Provide a read-only workspace-scoped group-summary resource returning the saved summary and its backend-owned coverage/revision metadata, or a successful empty result. The model-facing group context endpoint returns the effective summary plus original tail with revision-pinned pagination. No semantic range endpoint remains. Reads never schedule maintenance and are not cached.

### Bounded chat history

Expose a latest-entry/history-page resource with a default page of 50, bounded limit, optional before-position and matching reset cursor. Return current public timeline entries, next older cursor and current update cursor from one consistent view. Keep the existing incremental timeline change feed separate. Stable public final text is resolved from immutable Agent references; private working history is a separate resource. Refresh/reconnect continue after the applied change cursor. Reset-generation conflicts or backend-declared invalid/expired cursors are explicit, allowing a new latest-50 snapshot. No original history is removed.
