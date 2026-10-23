<!-- Task target; implemented with the source migration before commit. -->
# API

## Purpose, responsibilities and boundaries

API owns the backend's HTTP/SSE transport and request/response representation. It validates request shape, maps Core results/errors to protocol responses and manages streaming/backpressure, binary input and disconnects. Core owns semantic validation and business decisions.

## Interface contract

The server factory accepts Core services and returns an HTTP server without binding it. Runtime starts and closes it. Requests identify resources and carry JSON or multipart images, revisions/cursors and control actions. JSON results, status codes, error envelopes, binary images and SSE event semantics preserve the existing frontend contract.

Multipart parsing belongs to API; image preparation/validation semantics belong to Core. Follow streams present Core records/deltas and honor backpressure and cancellation without driving agent execution. Unknown paths/input formats fail explicitly; errors after headers follow the stream-error contract. API does not query application tables, run business migrations or implement cooperation/permission policy.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
