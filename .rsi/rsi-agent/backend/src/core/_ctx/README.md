---
summary: Wires Agent, Team and Workspace owner data and coordinates cross-owner lifecycle transactions without centralizing business models.
include:
  - backend/src/core/data.ts
  - backend/src/core/data-transaction.ts
  - backend/src/core/workspace-bootstrap.ts
  - backend/src/core/workspace-reset.ts
  - backend/src/core/context-page.ts
  - backend/src/core/operation-queue.ts
  - backend/src/core/errors.ts
  - backend/test/backend-layout.test.ts
  - backend/test/workspace-bootstrap.test.ts
---

# Core usage contract

Core composes Agent execution, Team cooperation, Workspace project information and React Harness capabilities. Child owners define their data schemas, queries and behavior. Parent files supply shared validation, encoding, pagination and queue primitives and coordinate owner lifecycle operations.

## Data composition

`new CoreData(storage)` exposes `agents`, `workspaces`, `team` and `config` repositories over one `MySqlStorage`. Agent creation seeds configuration through an owner callback; run completion informs Team. Workspace registration creates its Lead and initial activation within the registration transaction; workspace model changes inform Team lead settings. Team receives Agent/Workspace interfaces rather than foreign SQL.

`await store.migrate()` invokes owner migrations, imports older chat/group context, adopts supported legacy member context into Agent-owned rows and finishes that migration. This writes startup state and is not one global rollback transaction. `store.close()` releases runtime ownership, closes Team state and ends Storage; the host must first stop execution and Workspace resources.

```ts
const storage = new MySqlStorage(databaseUrl);
const store = new CoreData(storage);
await store.migrate();
// Construct services from the owner repositories; run and then drain them.
await store.close();
```

Imports are available at the included source paths. `dataTransaction(storage, connection, operation)` reuses a supplied outer connection or creates a managed transaction, mapping duplicate identities/positions to a 409 conflict. Storage's `afterCommit` is the acknowledgement boundary for resident state publication.

## Bootstrap and administrative reset

`prepareWorkspace(record, settings, cleanupRevision?)` stages reviewed non-context metadata and prepares missing root DESIGN/Lead files. Finish its files object after successful registration or roll it back on failure. `WorkspaceService.create()` performs this coordination; use it rather than persisting a partial bundle. Existing context and source are preserved; initialization does not synthesize a usage README.

`resetWorkspaceData(store)` is a separate **destructive administrative operation**, not an HTTP/agent capability. With exclusive database runtime ownership it quarantines registered projects' `.rsi`, `.context`, `.team` and associated historical harness state, then atomically clears workspace/member/run/history records and agent profiles. It preserves provider connections, credentials, app settings/catalogs, implementation and Git. Before SQL success it attempts to restore moved paths on failure; later cleanup failure can leave quarantine files. Unlike Team's idle conversation reset, this administrative operation removes project context/member files. Do not run it for context maintenance.

## Ownership and consistency

[Agent](../agent/_ctx/README.md) owns private messages/context, execution, acknowledged persistence, recovery and compaction. [Team](../team/_ctx/README.md) owns shared context/summaries, publication/admission, activation and serial scheduling. [Workspace](../workspace/_ctx/README.md) owns registration, model choices and filesystem context discovery. [React Harness](../react-harness/_ctx/README.md) owns tool reactions and purpose-specific state.

Cross-owner publication, sender completion/recipient admission, activation and reset use one technical transaction. Incoming Agent context is synchronized at safe boundaries, not between a tool call/result. Stable history and current model context are separate. Inspection returns detached read-only pages with revision conflicts on change. Filesystem/external effects can precede failures; SQL atomicity does not make them transactional. Uncertain COMMIT acknowledgement may require invalidating caches rather than replay.

Core DESIGN still calls shared summarization deferred, while Team DESIGN and implementation provide it. This contract records actual summary-plus-tail behavior and leaves the intent discrepancy for user confirmation. No DESIGN changed. Includes are supplementary, not automatically loaded.
