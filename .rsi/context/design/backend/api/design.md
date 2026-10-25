# API

## Purpose, responsibilities and boundaries

API owns the backend's HTTP/SSE transport and request/response representation. It validates request shape, maps Core results/errors to protocol responses and manages streaming/backpressure, binary input and disconnects. Core owns semantic validation and business decisions.

## Interface contract

The server factory accepts Core services and returns an HTTP server without binding it. Runtime starts and closes it. Requests identify resources and carry JSON or multipart images, revisions/cursors and control actions. JSON results, status codes, error envelopes, binary images and SSE event semantics preserve the existing frontend contract.

Multipart parsing belongs to API; image preparation/validation semantics belong to Core. Follow streams present Core records/deltas and honor backpressure and cancellation without driving agent execution. Unknown paths/input formats fail explicitly; errors after headers follow the stream-error contract. API does not query application tables, run business migrations or implement cooperation/permission policy.

### Workspace initialization

`POST /workspaces/initialization` accepts directory and adopt and returns a read-only initialization inspection: canonical directory, cleanupPaths and cleanupRevision (null when no nonempty metadata). `POST /workspaces` additionally accepts optional cleanupRevision. Without matching reviewed cleanup consent, nonempty metadata returns a conflict. Existing content under `.rsi/context/` is preserved; source files and Git state are unchanged. Other registered workspaces cannot be cleaned or reinitialized through this operation.

### Workspace deletion endpoint

DELETE /workspaces/:workspaceId removes only application data and returns the deleted workspace identity. Busy teams/maintenance fail with workspace_busy/409 and missing identities with not_found/404. No filesystem deletion option is exposed. Existing error envelopes apply. Delegate Team idle authority and Workspace/Core lifecycle work to business services.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
