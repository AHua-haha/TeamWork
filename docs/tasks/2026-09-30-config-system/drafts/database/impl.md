<!-- Task proposal; current contract is under docs/systems/ -->

# Database implementation

## Contract

[Database design](design.md). Preserve Pi payloads and metadata, immutable ordered display records, independently replaceable context, atomic writes, and explicit chunk gaps.

## Responsibilities and decomposition

A MySQL repository owns schema setup, transactions, versioned JSON serialization, and logical persistence operations. It is a leaf system called by the runtime.

The config service also calls it for scoped versioned config records. The database checks identities and revisions while leaving config field validation to that service.

## Coordination and data flow

Agent rows serialize writers with row locks. Starting a run atomically appends the accepted input to context and display history. Completing a message atomically appends both records and clears its temporary chunks. Context replacement uses a revision check. Runs record terminal history bounds so a follower cannot drift into a later run. Consistent transactional follow snapshots join durable history, run state, and the bounded active chunk range.

`config_records` stores app, catalog, and agent values as versioned JSON envelopes. Creates, updates, and deletes are atomic, with updates/deletes checking the expected revision. `configBundle` reads app, agent, and catalog in one repeatable-read transaction. New agents receive a blank config record in their creation transaction. Config initialization can populate that record for preexisting agents.

## Decisions and constraints

MySQL 8.4/InnoDB with mysql2/promise. JSON envelopes carry a schema version; unsupported JSON values and malformed stored messages fail explicitly. One runtime process owns a database via a MySQL session lock; process restart marks abandoned runs interrupted. No frontend acknowledgements. Chunk count and serialized-byte limits are runtime inputs.

## Code map

- [src/database.ts](../../../../../backend/src/database.ts): schema, repository, session ownership, and transactions.
- [Config service](../config/impl.md): interpretation and resolution of these stored values.
- [src/codec.ts](../../../../../backend/src/codec.ts): supported serialization and validation.
- [src/types.ts](../../../../../backend/src/types.ts): runtime-owned shared records and errors used by persistence.
- [compose.yaml](../../../../../backend/compose.yaml): optional local MySQL service.

## Verification

[Codec tests](../../../../../backend/test/codec.test.ts) cover rejection and preservation, including Pi tool schemas and opaque signatures. [MySQL integration tests](../../../../../backend/test/integration/backend.test.ts) cover atomicity, stale revisions, immutable history, serialized-byte/count pruning including full eviction, concurrent starts, pool reopening, corruption rejection, ownership exclusion, and restart recovery. From `backend/`, set `VERIFY_TASK_ID=2026-09-30-config-system` and run `node scripts/verify.mjs npm test` and `node scripts/verify.mjs npm run test:mysql`; the latter creates and removes a disposable MySQL 8.4 container.

The repository locks an agent row before every mutation; snapshot reads use one repeatable-read transaction. The advisory ownership lock is held on a dedicated pooled connection, its error listener is removed on release, and ownership loss is reported to the runtime. Schema initialization is idempotent for the initial schema, not a migration engine for future versions. JSON envelopes are versioned independently of the schema. Raw Pi event partials are serialized before awaiting database operations so later in-process mutations cannot rewrite retained events.

The config integration tests in [backend.test.ts](../../../../../backend/test/integration/backend.test.ts) cover revision conflicts, repeatable initialization, and a running agent's independence from later catalog edits/deletions.
