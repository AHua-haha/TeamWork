<!-- Task proposal; current contract is under docs/systems/ -->
# Database implementation

## Contract

[Database design](design.md). Preserve Pi payloads and metadata, immutable ordered display records, independently replaceable context, atomic writes, and explicit chunk gaps. Store context-base changes atomically at an expected sequence number.

## Responsibilities and decomposition

A MySQL repository owns schema setup, transactions, versioned JSON serialization, and logical persistence operations. It is a leaf system called by the runtime.

The config service also calls it for scoped versioned config records. The database checks identities and revisions while leaving config field validation to that service.

The team calls it through the `TeamStore` interface, which the repository also implements, to store team members. The workspace service and each context base call it through the `ContextStore` interface. The [context base](../workspace-agent/context-base/impl.md) builds each change; the repository stores it and validates stored authors and change records when reading them.

## Coordination and data flow

Agent rows serialize writers with row locks. Starting a run atomically appends the accepted input to context and display history. Completing a message atomically appends both records and clears its temporary chunks. Context replacement uses a revision check. Runs record terminal history bounds so a follower cannot drift into a later run. Consistent transactional follow snapshots join durable history, run state, and the bounded active chunk range.

`config_records` stores app, catalog, connection, model-cache, and agent values as versioned JSON envelopes. Creates, updates, and deletes are atomic, with updates/deletes checking the expected revision. `configBundle` reads app, agent, and catalog in one repeatable-read transaction. New agents receive a blank config record in their creation transaction. Config initialization can populate that record for preexisting agents.

Team members use one table, `members`: the member's ID, which is also its conversation's `agents` row, the workspace, a revision, the record as a JSON envelope, an `ordinal` that numbers members in creation order, and two nullable key columns. `is_lead` is 1 for the lead and null otherwise, and `name_key` is the lower-cased name for an active member and null once retired. Unique keys on `(workspace_id, is_lead)` and `(workspace_id, name_key)` make a second lead or a duplicate active name fail, because MySQL allows many nulls in a unique key. `createMember` inserts the `agents` row and the member row in one transaction, and `updateMember` checks the revision. `createWorkspace` inserts the workspace row and then the lead the same way, in one transaction, so a workspace is never stored without its lead; a duplicate directory or ID rolls back both and reports `workspace_exists`. `runMessages` reads the `messages` rows of one run, which a call between members uses to find the recipient's final assistant message. `listAgents` leaves out member IDs, `createConfig` for an agent refuses a member's ID, and `configBundle` takes no agent for members.

Context bases use five tables:

| Table | Holds | Keys |
| --- | --- | --- |
| `workspaces` | registry and latest `seq` | ID; unique directory key |
| `context_blobs` | version content | workspace and SHA-256 hash |
| `context_versions` | every version | workspace, file ID, and `seq`; unique revision; path key and `seq` for path history |
| `context_files` | current files | workspace and path key; unique file ID |
| `context_records` | change records as JSON envelopes | workspace and `seq` |

`commitContext` runs in one transaction:
1. Advance `workspaces.seq` only where it still equals the expected value. If no row changes, fail with 503 and write nothing.
2. Insert blobs, ignoring content already stored.
3. Insert versions, 500 rows per statement.
4. Delete the removed path keys, 500 per statement.
5. Insert the new current-file rows.
6. Insert the record.

`loadContext` reads the sequence number and the current files joined with their versions in one transaction. `lastFileId` orders by `seq` and, at the same `seq`, prefers a file created at the path over one deleted from it, which matters after an outside move that changes only letter case.

## Decisions and constraints

MySQL 8.4/InnoDB with mysql2/promise. JSON envelopes carry a schema version; unsupported JSON values and malformed stored messages fail explicitly. One runtime process owns a database via a MySQL session lock; process restart marks abandoned runs interrupted. No frontend acknowledgements. Chunk count and serialized-byte limits are runtime inputs.

Context paths are ASCII by the path rules and are stored with a binary collation; the path key is the lower-cased path. Content is `MEDIUMTEXT` in `utf8mb4_bin`, which holds 1 MiB of any Unicode text exactly. The directory key is the SHA-256 of the lower-cased real path, so the unique key fits any directory length. `LIMIT` values are validated integers written into the statement, because mysql2 prepared `LIMIT` placeholders are unreliable.

## Code map

- [src/database.ts](../../../../../backend/src/database.ts): schema, repository, session ownership, transactions, and the context store.
- [Config service](../../../../systems/config/impl.md): interpretation and resolution of these stored values.
- [Context base](../workspace-agent/context-base/impl.md): the changes stored in the context tables.
- [src/codec.ts](../../../../../backend/src/codec.ts): supported serialization and validation, including change authors and records.
- [src/types.ts](../../../../../backend/src/types.ts): runtime-owned shared records and errors used by persistence.
- [compose.yaml](../../../../../backend/compose.yaml): optional local MySQL service.

## Verification

[Codec tests](../../../../../backend/test/codec.test.ts) cover rejection and preservation, including Pi tool schemas and opaque signatures. [MySQL integration tests](../../../../../backend/test/integration/backend.test.ts) cover atomicity, stale revisions, immutable history, serialized-byte/count pruning including full eviction, concurrent starts, pool reopening, corruption rejection, ownership exclusion, and restart recovery. They also cover the context store: registry conflicts, commits with history and index reload, and refusal at a stale sequence number. The [context base tests](../../../../../backend/test/context-base.test.ts) exercise the same `ContextStore` contract with an in-memory store. From `backend/`, set `VERIFY_TASK_ID=2026-10-07-workspace-agent` and run `node scripts/verify.mjs npm test` and `node scripts/verify.mjs npm run test:mysql`; the latter creates and removes a disposable MySQL 8.4 container. This task's runs are recorded in the [task verification log](../../tests.jsonl).

The repository locks an agent row before every mutation; snapshot reads use one repeatable-read transaction. The advisory ownership lock is held on a dedicated pooled connection, its error listener is removed on release, and ownership loss is reported to the runtime. Schema initialization is idempotent for the initial schema, not a migration engine for future versions. JSON envelopes are versioned independently of the schema. Raw Pi event partials are serialized before awaiting database operations so later in-process mutations cannot rewrite retained events.

The config integration tests in [backend.test.ts](../../../../../backend/test/integration/backend.test.ts) cover revision conflicts, repeatable initialization, and a running agent's independence from later catalog edits/deletions.
