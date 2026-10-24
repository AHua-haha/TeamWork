> Existing behavior reference inside its owning system implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

> Ownership after migration: TeamData owns all application schemas, SQL, records and migrations. MySqlStorage only provides the pool, generic transaction mechanics and shutdown. TeamData is constructed with an injected MySqlStorage.

# Team durable persistence implementation

## Contract

[Database design](design.md). Preserve Pi payloads and metadata, immutable ordered display records, independently replaceable context, atomic writes. Store context-base changes atomically at an expected sequence number.

## Responsibilities and decomposition

A MySQL repository owns schema setup, transactions, versioned JSON serialization, and logical persistence operations. It is internal to aggregate Core; Storage supplies only the injected MySQL resources.

The config service also calls it for scoped versioned config records. The database checks identities and revisions while leaving config field validation to that service.

The team calls it through the `TeamStore` interface, which the repository also implements, to store team members. The workspace service and each context base call it through the `ContextStore` interface. The [context base](../../../../workspace/impl/reference/workspace-agent/context-base/impl.md) builds each change; the repository stores it and validates stored authors and change records when reading them.

## Coordination and data flow

Agent rows serialize writers with row locks. Starting a run atomically appends the accepted input to context and display history. Completing a message atomically appends both records and clears its active message marker. Context replacement uses a revision check. Runs record terminal history bounds so a follower cannot drift into a later run. Consistent transactional follow snapshots join durable history and run state.

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

The codec accepts context authors of user, external, and lead with validated member/run identities. Existing JSON author columns store the lead variant without schema changes. The team owns one-time migration of member scope to harness; the database retains accepted manifest/prompt bytes, source path, digest, submitter/time and their validated projection together in member JSON. The team owns their format and validation. Backend envelope formatVersion and previous legacy source preserve bookkeeping outside editable JSON. Git file acceptance is separate from the stable active member projection; MemberConfigService now supplies validated immutable source/projections for explicit user activation; the member_activation table additionally records the workspace review boundary. updateMember optionally requires idle state under workspace/agent locks; group publication checks prepared recipient revisions under the same workspace lock.

`loadContext` reads the sequence number and the current files joined with their versions in one transaction. `lastFileId` orders by `seq` and, at the same `seq`, prefers a file created at the path over one deleted from it, which matters after an outside move that changes only letter case.

## Decisions and constraints

MySQL 8.4/InnoDB with mysql2/promise. JSON envelopes carry a schema version; unsupported JSON values and malformed stored messages fail explicitly. One runtime process owns a database via a MySQL session lock; process restart marks abandoned runs interrupted. No frontend acknowledgements. Chunk count and serialized-byte limits are runtime inputs.

Context paths are ASCII by the path rules and are stored with a binary collation; the path key is the lower-cased path. Content is `MEDIUMTEXT` in `utf8mb4_bin`, which holds 1 MiB of any Unicode text exactly. The directory key is the SHA-256 of the lower-cased real path, so the unique key fits any directory length. `LIMIT` values are validated integers written into the statement, because mysql2 prepared `LIMIT` placeholders are unreliable.

## Code map

- [core/core-data.ts](../../../../../../../../../backend/src/core/team/data.ts): Core schema, repository, session ownership, business transactions, and context records.
- [Config service](../config/impl.md): interpretation and resolution of these stored values.
- [Context base](../../../../workspace/impl/reference/workspace-agent/context-base/impl.md): the changes stored in the context tables.
- [src/codec.ts](../../../../../../../../../backend/src/core/codec.ts): supported serialization and validation, including change authors and records.
- [src/types.ts](../../../../../../../../../backend/src/core/agent/types.ts): runtime-owned shared records and errors used by persistence.
- [compose.yaml](../../../../../../../../../backend/compose.yaml): optional local MySQL service.

## Verification

[Codec tests](../../../../../../../../../backend/test/codec.test.ts) cover rejection and preservation, including Pi tool schemas and opaque signatures. [MySQL integration tests](../../../../../../../../../backend/test/integration/backend.test.ts) cover atomicity, stale revisions, immutable history, serialized-byte/count pruning including full eviction, concurrent starts, pool reopening, corruption rejection, ownership exclusion, and restart recovery. They also cover the context store: registry conflicts, commits with history and index reload, and refusal at a stale sequence number. The [context base tests](../../../../../../../../../backend/test/context-base.test.ts) exercise the same `ContextStore` contract with an in-memory store. From `backend/`, set `VERIFY_TASK_ID=2026-10-07-workspace-agent` and run `node scripts/verify.mjs npm test` and `node scripts/verify.mjs npm run test:mysql`; the latter creates and removes a disposable MySQL 8.4 container.

Runtime message/context mutations lock the agent row; workspace publication and member lifecycle mutations acquire their workspace lock before agent locks; snapshot reads use one repeatable-read transaction. The advisory ownership lock is held on a dedicated pooled connection, its error listener is removed on release, and ownership loss is reported to the runtime. Schema initialization is idempotent for the initial schema, not a migration engine for future versions. JSON envelopes are versioned independently of the schema. Whole completed Pi messages are serialized for SQL. Compact progress frames are independent in-memory values; no partial event serialization or SQL retention remains.

The config integration tests in [backend.test.ts](../../../../../../../../../backend/test/integration/backend.test.ts) cover revision conflicts, repeatable initialization, and a running agent's independence from later catalog edits/deletions.

The complete lead/harness integration verifies persisted lead author and version content after reopening the pool; codec checks reject invalid author IDs.

## Group chat storage and transaction order

Shared storage uses chat_settings, chat_messages, chat_exchanges and chat_runs. Agent incorporation state lives with entries in agents.context; no separate member processed/success boundary or admission-range tables remain. agents.context_format marks the once-only adoption of legacy recorded work/shared messages through Agent's public helper. Migration preserves stable records/project files, commits each snapshot/marker together and drops obsolete retention tables only after adoption.

Publication locks the workspace and active agents in ID order, validates recipients/budget and stores the shared record/recipient runs atomically. Successful publication completes the sender's run/timeline but leaves current context intact. TeamRunner then schedules Agent-owned synchronization for idle members. Busy execution receives no mid-loop insertion.

readGroupContext reads the original messages after the Agent-requested position, resolves final references and hydrates images in one repeatable-read snapshot. TeamRuntime restores context once after acquiring execution authority. AgentMessageContext determines incoming messages, reconciles own finals and proposes an acknowledged context replacement. SQL is the persistence mapping, not the retention policy owner.

finishRun and accepted final publication no longer clear agents.context or maintain success-only private retention. Recorded working messages and incorporation metadata survive success/failure/restart. Context-only missing-result repair belongs to Agent and never changes immutable messages. Explicit reset clears model context and history together.

Repeatable-read snapshots provide stable history pages and status. Live observation remains a TeamRunner notification over durable reads; private chunks stay in memory. Integration tests cover publication rollback, continuous context, buffered inputs, sender reconciliation, acknowledgement, restart, legacy adoption, images and reset.

### Group timeline persistence

chat_clock (workspace, position, seq), chat_entries (stable display position and optional unique run), and chat_changes (immutable entry snapshots by seq) hold presentation history. writeChatEntry locks the clock after agents, assigns a display position only on creation, advances seq and writes current/change records together. finishChatEntry pins the terminal run and private `(after,through]` range. publishChat accepts finalMessageId and validates the sender/run/committed-history position and assistant content, then references messages instead of duplicating text. finalText and resolveTimelineEntry project accepted text at read time. chatTimeline pages changes with a consistent watermark. importChatHistory performs the one-time old prototype upgrade, identifying finals by their existing terminal bound and preserving publication order. SQL integration tests cover reverse completion, refusal rollback, references through compaction/retirement, paged updates, cancellation/restart and repeatable import.

Runtime startup can pass a beforeFinish callback to recoverInterruptedRuns. The store invokes it for each abandoned run before marking that run interrupted; the team adds no Git checkpoint hook. Callback failure leaves recovery incomplete and propagates to runtime startup. The database does not own Git state or interpret approval records.

## Workspace model records

workspace_models stores one revisioned JSON choices/default value per workspace, with a foreign key to workspaces. createWorkspace inserts it with the workspace and initialized lead in one transaction. saveWorkspaceModels locks the workspace row, checks the expected revision, and optionally initializes a lead whose connection and model are both null; that lead update includes generated accepted source and its revision in the same transaction. Existing configured members are untouched. Missing-record startup initialization uses an expected-null write; a first user save advances to revision 1 so a stale revision-0 placeholder cannot overwrite it. SQL integration checks rollback on lead insertion failure, competing revisions, reopen durability and one-time lead bootstrap.

## Unified streaming and model completion

New member final publications reference the latest committed assistant message of that activation and exact ordered contentIndices for its final text blocks. Publication validates natural completion, absence of tool calls, final text selection and text equality before accepting. Native commentary is excluded. Existing historical plain-text and response-tool references remain read-only immutable history; new publications never use the retired tool format.

activateMembers serializes with publishChat on the workspace row, validates the full active revision set and workspace-model revision, locks active agents in ID order and refuses active_run_id. It applies retirements/updates before insertMember so replacements may reuse retired names. Source metadata/settings and rows share the transaction; insertMember creates conversations and empty durable member-context boundaries. Retired member history remains preserved. TeamRunner supplies an additional local gate that includes runtime finalization after early publication. SQL integration verifies rollback after an earlier update followed by duplicate insertion failure, direct busy/stale refusal and successful replacement/update with retained history.

## Configuration activation tracking

Add member_activation state keyed by workspace ID. Read it through TeamStore and update it inside activateMembers after checking the expected previous activation revision. The same transaction stores all member/source changes and the marker, so process restart retains the inspection history boundary without filesystem/database dual writes. Existing databases acquire the table through the current idempotent schema initializer.


## Workspace bootstrap transaction

createWorkspace accepts prepared bootstrap activation/context state and persists both before commit. writeContext contains the shared context mutation body for both bootstrap and normal context commits; it runs on the caller's transaction connection. Filesystem preparation/rollback is owned by WorkspaceService. The administrative reset module owns ordered dependent-table deletion and provider/config preservation, using TeamData ownership and one transactional connection. The SQL integration suite injects a bootstrap context insert failure and reset foreign-key failure to verify rollback and source-file preservation.

Workspace bootstrap now supplies three context files (design/metadata.json, design/design.md and implement/impl/README.md) in one sequence-1 ContextCommit. writeContext stores all three versions/blobs/index rows and the single three-entry change record with the workspace, models, lead and activation marker. The same transaction also writes the static workspace_git_baselines JSON row. Reopen assertions and injected context-insert failure verify the baseline’s durability and rollback. Implementation-context files are now edited in the shared workspace and observed by ContextBase; accepted design/member reads use ordinary project commits and a static bootstrap/import baseline. Agent publications with multiple recipients refuse before transaction mutation.

The context path key now addresses one context container with design/implement purpose roots; existing columns, per-file revisions and expected-sequence transactions are unchanged. Markdown design documents and JSON metadata use the same text/blob storage. Aggregate overview counts are computed by ContextBase, not a database schema/category migration. SQL tests seed real node files through one WorkspaceService per workspace and verify durable node bootstrap, file history and accepted mappings.

The root split changes stored context path keys to design/... and implement/..., not the schema or context transaction model. Bootstrap still persists three files at seq 1. Existing workspace rows/files are not reset or converted automatically.

Member publication parses the leading routing header from the immutable finalAnswer-selected text, stores bodyOffset alongside contentIndices, and validates the supplied shared body against that slice before committing. Reference reads validate the integer offset/bounds and slice the selected raw text without reinterpreting already accepted history. JSON metadata carries this field without a schema migration. The runtime source record is not changed.

## Workspace conversation reset

chat_settings adds reset_cursor and reset_position with zero defaults; migrate inspects existing columns and adds absent columns before serving. resetChat takes workspace, sorted member-agent and clock locks in publication order, rejects active runs, deletes chat changes/entries/messages, chat-run links and exchanges, deletes context_compactions journals and private messages/runs, then clears model contexts/incorporation markers/current-run pointers and advances context revisions. It preserves member/settings rows, all filesystem/context-base state and monotonic chat clocks. The transaction returns durable reset boundaries; snapshots clamp pagination to these boundaries and expose them to TeamRunner followers.

## Transient progress removal

Database storage has no appendChunk or live-range reads. beginMessage returns the stable history position before the response, establishing the memory start boundary. followSnapshot selects agent identity/run pointers/positions without fetching its canonical context JSON. Migration drops only obsolete transient chunks/live_messages tables. Completed-message and terminal transactions retain their existing atomic history/context and group coordination guarantees. Runtime ProgressStore owns temporary events and eviction.

## Conversation-context durability verification

MySQL/runtime tests cover the exact earlier-group/document/retained/incoming/retrieval composition, consecutive failed ranges once, cleanup on success surviving reopen, abandoned execution recovery, context-only missing tool results, retrieval Bash inputs/results, invalid-document repair, fixed activation prefixes and reset of the new tables. Completed history and frontend final references remain independent of these boundaries.

## Image attachment integration

TeamData creates chat_images(workspace_id,id,metadata,content MEDIUMBLOB). publishChat stores prepared binaries and shared metadata atomically. readGroupContext hydrates native image blocks in its transaction; groupEntry prefixes sender/recipient information. Incorporated images survive normal run stops; reset removes image records with conversation/context state. Existing text-only history and stable messages are preserved.

## Bootstrap/import control baseline and terminal ordering

workspace_git_baselines stores one JSON copy of initial/legacy accepted design and member content per workspace. Workspace creation stores it atomically with lead/context/activation. INSERT IGNORE adopts a legacy baseline once without overwriting it; no run/edit/commit adds rows or history. Ordinary project Git supplies subsequent committed content. Active member sources, activation markers and durable private/shared contexts keep their existing tables. Approval waiting is session-bound memory and is cancelled on shutdown/restart; no Git index/ref/checkpoint tables are added.

writeChatEntry acquires the existing workspace clock row with an exclusive upsert before its update. Concurrent terminal writes, including cancelled waiting members, cannot deadlock through shared-to-exclusive INSERT IGNORE lock upgrades previously masked by checkpoint delays.

### Agent compaction journal

context_compactions records id, agent_id, run_id, unique nullable active_agent_id, history_after and versioned lifecycle state. Tentative completed records append immutable messages under their owning run without changing current context. finishCompaction CAS-replaces agents.context and marks the lifecycle terminal atomically. recoverCompactions retains old context plus recorded preparation/uncertainty and marks runtime_restarted without replay; it runs before ordinary interrupted-run recovery. Public final references/end bounds stay pinned. Reset deletes journals before their message/run owners.
