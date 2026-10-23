<!-- Task implementation; promoted with verified code. -->
# Backend implementation context

## Result summary

The backend source now follows four high-level ownership directories. Core remains aggregated. Existing public HTTP/SSE and persisted data formats are preserved.

Design: [Backend](../../../design/backend/design.md).

### Coordination and ownership

Runtime creates MySqlStorage, injects it into CoreData, constructs Core services and API, then initializes Core and binds HTTP. API forwards application operations to Core. Core controls semantic validation and business transactions.

### Implemented contract

**Input:** Operator process settings and API requests, including revisions and history/progress cursors.

**Output:** HTTP/SSE/binary responses, durable records and permitted workspace/tool effects.

**Effect and failure:** Core initializes existing app schema and recovery. Storage supplies technical resources only. Runtime coordinates process shutdown.

**Usage example:** Build using `npm --prefix backend run build`; managed start uses `scripts/backend-command.mjs`, whose compiled entry is `backend/dist/src/runtime/main.js`.

## File lookup

- [core](../core/impl/README.md): child implementation context.
- [api](../api/impl/README.md): child implementation context.
- [storage](../storage/impl/README.md): child implementation context.
- [runtime](../runtime/impl/README.md): child implementation context.
- [Backend tests](../../../../../backend/test): deterministic/unit/HTTP and disposable MySQL verification.

## Automatic retrieval

```json
{"commands": []}
```
