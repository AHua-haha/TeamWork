# Backend

## Purpose, responsibilities and boundaries

Backend owns the application's agent-system capabilities and durable application state. It exposes the stable local application interface consumed by Frontend and is hosted/configured by Operations. It has four systems: Core, API, Storage and Runtime.

## Interface contract

Callers create/list agents and workspaces, configure providers/models, submit or cancel work, follow message history/progress, inspect design/member state and request review/activation/reset operations. Inputs carry user content, identifiers, expected revisions and cursors. Results contain domain records, stable ordered history, progress, review data or explicit failures.

Core owns complete business data and behavior, including persistence schema and migrations. API owns HTTP/SSE representations. Storage provides generic database access and transaction capabilities. Runtime constructs/initializes these components and hosts the process. One backend owns a database at a time. Restart preserves durable data, loses transient chunks and marks abandoned runs interrupted without replay.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
- Child system: core.
- Child system: api.
- Child system: storage.
- Child system: runtime.
