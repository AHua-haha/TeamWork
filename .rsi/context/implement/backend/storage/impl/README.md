## Result summary

Storage implementation context rebuilt from accepted database design and current `store.ts`/`database.ts`. `Store` is the persistence port; `MySqlStore` implements it using mysql2/promise and MySQL/InnoDB transactions. Storage persists agents/runs/completed messages/context, config records, workspace registry/model settings/context-base versions and blobs, member/team activation, chat/timeline and prepared images. No project source was changed. Current tree has user/other-member source modifications and deleted legacy domain files; those must be preserved. Context design covers more detailed persistence operations than can be fully verified from this bounded inspection; implementation notes identify follow-up.

## File lookup

| Path | Description |
|---|---|
| `backend/src/storage/store.ts` | Store port, config record/scope types and persistence operation signatures. |
| `backend/src/storage/database.ts` | MySQL schema, migrations, transactional implementation and SQL serialization. |
| `backend/compose.yaml` | Local MySQL service configuration (not inspected in this activation). |
| `backend/scripts` | Storage/development scripts (not inspected in this activation). |
| `backend/src/foundation/codec.ts` | Shared serialization/validation boundary called by Storage. |
| `.rsi/context/design/backend/storage/design.md` | Accepted persistence behavior and requirements. |

## Implemented contract

### Store port (`store.ts`)

Callers depend on `Store`, not the concrete SQL class. It groups lifecycle (`migrate`, `acquireRuntime`, `assertRuntime`, `releaseRuntime`, `close`), agent/config/context/run/state/member/chat/workspace/model/context-base operations. Inputs are typed method arguments; optimistic updates take expected revision/sequence, chat reset takes workspace ID, and `prepareMemberContext` takes agent/run plus document entries. Results include typed current/run/follow/config/member/chat data; many context-base low-level methods intentionally use `unknown` payloads. `Store` currently exposes `readonly pool: Pool` with a TODO noting workspace-reset reaches through Storage (layer leak). Example: `const current = await store.getState(agentId); const history = await store.getContext(agentId);`.

### MySQL implementation

`database.ts` exports config scope/record shapes and implements storage against `mysql2/promise`. Database URL is passed to `MySqlStore` constructor. Schema uses InnoDB, identity keys and JSON records; helper `encode`/`decode` wraps records in version-1 envelopes and validators. It uses transactions/connection helpers for multi-record atomic operations and translates duplicate keys/conflicts to AppErrors. `migrate()` creates schema and applies migration logic; `close()` closes resources. Expected revisions protect context/config/member/model updates; expected sequence protects context-base commits. A storage exception rejects the Promise; documented stale/conflict conditions should be handled by callers as AppError.

**Usage examples:** `const store = new MySqlStore(databaseUrl); await store.migrate(); await store.createAgent('agent-1'); const state = await store.getState('agent-1'); await store.close();` and `const ctx = await store.getContext(id); await store.replaceContext(id, ctx.revision, entries);`.

**Effects:** SQL transactions persist records; context blobs and history are durable. Storage does not persist transient progress chunks (current schema has completed `messages`; migration removes obsolete chunks/live_messages tables per design). Do not run migrations/reset operations casually; preserve existing database contents.

## Implementation notes

Schema declarations begin in `database.ts`; `Store` imports domain persistence interfaces for chat/context/team and currently exposes the concrete Pool. Database implementation imports Foundation codecs/types and many domain validators/types, which reflects persistence integration but should be compared with accepted layer boundaries. `Store` currently includes richer workspace/member/chat operations than the original core agent persistence list, including `activateMembers`, `resetChat`, `chatImage`, `saveWorkspaceModels`, and `prepareMemberContext`. Design also requires newer activation, bootstrap, timeline, reset-boundary and image behavior; confirm all are implemented by inspecting the relevant methods/migrations before making claims beyond signatures.

## Verification and continuation

Inspected beginning/schema of `database.ts` and full `store.ts`; no tests run and no project source changed. `backend/compose.yaml` and scripts were not inspected. Before future storage changes, inspect whole database implementation, especially migration/ownership, `createWorkspace` bootstrap, activation markers, group publication, reset, image persistence, and transaction rollback. Do not modify data or perform reset/migration without separate authorization.

## Automatic retrieval

```json
{"commands": []}
```
