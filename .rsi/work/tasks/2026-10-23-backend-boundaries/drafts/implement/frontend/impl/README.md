<!-- Task implementation; promoted with verified code. -->
# Frontend implementation context

## Result summary

The React client and its current UI behavior remain unchanged. It consumes stable API history and compact progress; retained detailed references document presentation and synchronization.

Design: [Frontend](../../../design/frontend/design.md).

### Coordination and ownership

Client modules fetch history/inspection and merge live deltas; adapters derive display state; UI components render conversations, review and configuration. API responses are the frontend contract, not backend object internals.

### Implemented contract

**Input:** HTTP JSON/binary/SSE records, user interaction, cursor/revision state.

**Output:** Browser views and explicit requests carrying user decisions.

**Effect and failure:** Owns browser state and presentation; durable business state is owned by Backend Core.

**Usage example:** Use the running frontend URL. Submit a message; the reserved member section streams visible text/tool work, then folds work when the accepted final message is known. Refresh reads durable records.

## File lookup

- [frontend](../../../../../frontend): owned implementation.
- [reference/frontend/design.md](reference/frontend/design.md): migrated existing behavior/code reference, not a child design.
- [reference/frontend/group-chat/design.md](reference/frontend/group-chat/design.md): migrated existing behavior/code reference, not a child design.
- [reference/frontend/group-chat/impl.md](reference/frontend/group-chat/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/frontend/impl.md](reference/frontend/impl.md): migrated existing behavior/code reference, not a child design.
- [Frontend tests](../../../../../frontend/test): client, adapter and UI regression checks.

## Automatic retrieval

```json
{"commands": []}
```
