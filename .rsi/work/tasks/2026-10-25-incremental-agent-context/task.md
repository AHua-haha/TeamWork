# Incremental durable and resident Agent context

Status: complete; final delivery is the commit carrying this Task-ID
Starting commit: f94fd6a61e2eb676395be3ecde5a7a698f7dcd42
Review boundary: Backend/Core/Agent; technical transaction acknowledgement and Core/Team callers only as necessary.

## Agreed design

Store active context as ordered rows, one complete Pi message/envelope per row, separate from immutable history. Normal appends insert new rows and update small bookkeeping; targeted edits update only affected rows. Full replacement is reserved for explicit replacement/compaction/reset. Load an agent context once on first use and keep the same in-memory model across runs until shutdown/reset; restart loads durable rows again. Persist acknowledgement precedes memory publication.

## Work

- Draft Agent contract and implementation before code.
- Migrate existing JSON contexts without resetting user data; retire old context column.
- Keep Agent-owned resident context consistent through transactions, group synchronization, compaction and reset.
- Verify incremental SQL, reuse across runs, rollback, opaque fields, restart, migration and existing behaviors with disposable databases and deterministic providers.

## Safeguards

Preserve unrelated .gitignore edits. No live database, workspace metadata, provider requests or deployment changes. No frontend/HTTP/SSE contract changes. Commit coherent source/context/evidence only.

## Delivered

- Agent-owned agent_context_entries stores one ordered ContextEntry/Pi Message per row, separate from immutable messages history. agents stores only context length/revision and execution bookkeeping.
- Normal private input, assistant and tool-result commits insert the new context/history rows; coordination reads small fields. Group delivery uses append/targeted provenance patches, with one incorporation algorithm. Explicit replacement, compaction, reset and exceptional interrupted-prefix repair can replace rows.
- AgentData owns lazy ResidentContexts and AgentContextState. Transaction views share them. Each run holds run-local state and attaches the existing resident model after acquiring execution authority; idle delivery reuses it too.
- SQL outer-commit acknowledgements advance memory; rollback does not. Uncertain commit acknowledgement and unexpected revision gaps invalidate resident state before reuse; restore actual durable state without replaying writes/tools.
- Startup converts old JSON context entries losslessly and retires the old column only after every agent succeeds. Retry after interruption is verified. No user workspace reset is required.
- Reset uses the common Storage-managed transaction, preserving its filesystem quarantine/rollback behavior and ensuring resident-state deletion follows commit.
- Canonical Agent/Core/Storage contracts and implementation references reconciled. HTTP/SSE, stable history and frontend behavior are unchanged.

## Verification

Final candidate: 215 backend tests, 80 disposable MySQL integration tests and 15 host-script tests pass; backend build and verification of 12 RSI context nodes/source mappings/links/compiled startup pass. SQL tracing across two runs observes one full context load, four new context-row inserts and no existing-context row updates/deletes. New tests cover resident identity across runs, initial-load races, targeted updates, outer rollback/commit/reset, uncertain acknowledged commits, signatures/redacted thinking and resumable migration. Existing compaction/recovery/publication/streaming tests pass.

All checks, including early failures, remain in tests.jsonl. Corrections include moving the idle-failure injection from replaceContext to patchContext, routing administrative reset through Storage.transaction, annotating SQL-trace test receiver types, and correcting the host-script test invocation. The early unit run is superseded by the final passing candidate run; its full console output was not retained. No tests or behavior guarantees were weakened.

## Handoff

Restart the backend to run the schema migration, with the old backend stopped. No live database, provider, deployment or personal workspace data was modified during development. Resident memory stays allocated for loaded agents until runtime shutdown; no cache eviction is introduced. Model requests still serialize their current context. Unrelated .gitignore changes remain outside this commit. Merge/push are not part of this task.
