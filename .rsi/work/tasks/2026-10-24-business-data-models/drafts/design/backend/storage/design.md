> Proposed for 2026-10-24-business-data-models; delivered with source.

# Storage

## Purpose, responsibilities and boundaries

Storage supplies technical storage-engine access and resource management. It does not know Core's or another business system's models, schemas, record serialization, table names, queries, activation rules or application migrations. Each business aggregates its in-memory schema, durable model and related operations in its own data-model part and uses this infrastructure. Storage does not supply a shared business repository.

## Interface contract

A caller supplies an engine connection configuration and receives connection/query/command capabilities, transaction execution and resource shutdown. Transaction callbacks execute caller-owned statements on one connection and return a result. Success commits; failure attempts rollback, preserves the original failure and releases the connection. Shutdown closes owned resources.

The prototype implements MySQL access only. SQLite/Redis are examples of future engine-specific capabilities, not promised adapters or an interchangeable universal transaction model. Engine errors remain technical errors; callers interpret application conflicts. The infrastructure creates no application schema, names no business records and constructs no prompts.

## Constraints, specifications and requirements

- Preserve existing accepted observable behavior, record formats, revisions/cursors, API payloads and lifecycle guarantees during this migration.
- Refusals and failures remain explicit. Database transactions provide their agreed atomicity; executed tools/filesystem operations may leave earlier effects on failure.
- This document is the design; matching implementation context documents exact inputs, outputs, effects and usage.
