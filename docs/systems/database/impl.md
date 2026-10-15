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

Team members use one table, `members`: the member's ID, which is also its conversation's `agents` row, the workspace, a revision, the record as a JSON envelope, an `ordinal` that numbers members in creation order, and two nullable key columns. `is_lead` is 1 for the lead and null otherwise, and `name_key` is the lower-cased name for an active member and null once retired. Unique keys on `(workspace_id, is_lead)` and `(workspace_id, name_key)` make a second lead or a duplicate active name fail, because MySQL allows many nulls in a unique key. `createMember` inserts the `agents` row and the member row in one transaction, and `updateMember` checks the revision. `createWorkspace` inserts the workspace row and then the lead the same way, in one transaction, so a workspace is never stored without its lead; a duplicate directory or ID rolls back both and reports `workspace_exists`. `runMessages` reads the private `messages` rows of one run for inspection. `listAgents` leaves out member IDs, `createConfig` for an agent refuses a member's ID, and `configBundle` takes no agent for members.

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

The codec accepts context authors of user, external, and lead with validated member/run identities. Existing JSON author columns store the lead variant without schema changes. The team owns one-time migration of member scope to harness; the database retains accepted manifest/prompt bytes, source path, digest, submitter/time and their validated projection together in member JSON. The team owns their format and validation. updateMember optionally requires idle state under workspace/agent locks; group publication checks prepared recipient revisions under the same workspace lock.

`loadContext` reads the sequence number and the current files joined with their versions in one transaction. `lastFileId` orders by `seq` and, at the same `seq`, prefers a file created at the path over one deleted from it, which matters after an outside move that changes only letter case.

## Decisions and constraints

MySQL 8.4/InnoDB with mysql2/promise. JSON envelopes carry a schema version; unsupported JSON values and malformed stored messages fail explicitly. One runtime process owns a database via a MySQL session lock; process restart marks abandoned runs interrupted. No frontend acknowledgements. Chunk count and serialized-byte limits are runtime inputs.

Context paths are ASCII by the path rules and are stored with a binary collation; the path key is the lower-cased path. Content is `MEDIUMTEXT` in `utf8mb4_bin`, which holds 1 MiB of any Unicode text exactly. The directory key is the SHA-256 of the lower-cased real path, so the unique key fits any directory length. `LIMIT` values are validated integers written into the statement, because mysql2 prepared `LIMIT` placeholders are unreliable.

## Code map

- [src/database.ts](../../../backend/src/database.ts): schema, repository, session ownership, transactions, and the context store.
- [Config service](../config/impl.md): interpretation and resolution of these stored values.
- [Context base](../workspace-agent/context-base/impl.md): the changes stored in the context tables.
- [src/codec.ts](../../../backend/src/codec.ts): supported serialization and validation, including change authors and records.
- [src/types.ts](../../../backend/src/types.ts): runtime-owned shared records and errors used by persistence.
- [compose.yaml](../../../backend/compose.yaml): optional local MySQL service.

## Verification

[Codec tests](../../../backend/test/codec.test.ts) cover rejection and preservation, including Pi tool schemas and opaque signatures. [MySQL integration tests](../../../backend/test/integration/backend.test.ts) cover atomicity, stale revisions, immutable history, serialized-byte/count pruning including full eviction, concurrent starts, pool reopening, corruption rejection, ownership exclusion, and restart recovery. They also cover the context store: registry conflicts, commits with history and index reload, and refusal at a stale sequence number. The [context base tests](../../../backend/test/context-base.test.ts) exercise the same `ContextStore` contract with an in-memory store. From `backend/`, set `VERIFY_TASK_ID=2026-10-07-workspace-agent` and run `node scripts/verify.mjs npm test` and `node scripts/verify.mjs npm run test:mysql`; the latter creates and removes a disposable MySQL 8.4 container.

Runtime message/context mutations lock the agent row; workspace publication and member lifecycle mutations acquire their workspace lock before agent locks; snapshot reads use one repeatable-read transaction. The advisory ownership lock is held on a dedicated pooled connection, its error listener is removed on release, and ownership loss is reported to the runtime. Schema initialization is idempotent for the initial schema, not a migration engine for future versions. JSON envelopes are versioned independently of the schema. Raw Pi event partials are serialized before awaiting database operations so later in-process mutations cannot rewrite retained events.

The config integration tests in [backend.test.ts](../../../backend/test/integration/backend.test.ts) cover revision conflicts, repeatable initialization, and a running agent's independence from later catalog edits/deletions.

The complete lead/harness integration verifies persisted lead author and version content after reopening the pool; codec checks reject invalid author IDs.

## Group chat storage and transaction order

Five tables are added: `chat_settings` (workspace position and current limit), `chat_messages` (stable authored shared records), `chat_exchanges` (frozen budget, usage, stopped flag), `chat_runs` (run/exchange association), and `chat_delivery` (member delivered position and nullable retirement boundary).

Publication, stop and member lifecycle updates lock the workspace row first. Publication then locks active agent rows in stable ID order, rechecks busy recipients and sender identity, and checks the exchange budget before inserting a message. Successful sender publication stores its terminal state and releases its active-run marker. Idle members drain shared entries into canonical JSON context; busy members keep their cursor unchanged. Recipient run rows and active markers are inserted in the same transaction. Executing model calls is outside it.

`drainChat` reads entries after the member's cursor, bounded by its retirement position, wraps each with group author/position metadata, and updates context/cursor together. It does not change the private `messages` table or history position. Private finish/recovery locks the agent and drains after releasing its active marker; it does not acquire the workspace lock, avoiding inverted lock order. New-member creation drains historical group entries in its creation transaction. Shared JSON records are versioned and validated on write/read.

Repeatable-read snapshots provide stable history pages and status. Live group observation is a TeamRunner notification over these database reads, never a view of the model stream. Private runtime chunks remain separate. Group tests cover SQL admission races, rollback, deferred delivery, retained private history, restart recovery and persistence across pools.

### Group timeline persistence

chat_clock (workspace, position, seq), chat_entries (stable display position and optional unique run), and chat_changes (immutable entry snapshots by seq) hold presentation history. writeChatEntry locks the clock after agents, assigns a display position only on creation, advances seq and writes current/change records together. finishChatEntry pins the terminal run and private `(after,through]` range. publishChat accepts finalMessageId and validates the sender/run/committed-history position and assistant content, then references messages instead of duplicating text. finalText and resolveTimelineEntry project accepted text at read time. chatTimeline pages changes with a consistent watermark. importChatHistory performs the one-time old prototype upgrade, identifying finals by their existing terminal bound and preserving publication order. SQL integration tests cover reverse completion, refusal rollback, references through compaction/retirement, paged updates, cancellation/restart and repeatable import.

Runtime startup can pass a beforeFinish callback to recoverInterruptedRuns. The store invokes it for each abandoned run before marking that run interrupted; the harness uses it to preserve scoped file snapshots. Callback failure leaves recovery incomplete and propagates to runtime startup. The database does not own Git state or interpret approval records.

## Workspace model records

workspace_models stores one revisioned JSON choices/default value per workspace, with a foreign key to workspaces. createWorkspace inserts it with the workspace and initialized lead in one transaction. saveWorkspaceModels locks the workspace row, checks the expected revision, and optionally initializes a lead whose connection and model are both null; that lead update includes generated accepted source and its revision in the same transaction. Existing configured members are untouched. Missing-record startup initialization uses an expected-null write; a first user save advances to revision 1 so a stale revision-0 placeholder cannot overwrite it. SQL integration checks rollback on lead insertion failure, competing revisions, reopen durability and one-time lead bootstrap.

## Unified streaming and model completion

New member final publications reference the latest committed assistant message of that activation and exact ordered contentIndices for its final text blocks. Publication validates natural completion, absence of tool calls, final text selection and text equality before accepting. Native commentary is excluded. Existing historical plain-text and response-tool references remain read-only immutable history; new publications never use the retired tool format.
