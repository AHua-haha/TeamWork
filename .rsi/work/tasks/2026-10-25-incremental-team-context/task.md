# Incremental resident Team group context

Status: complete; delivery is the commit carrying this Task-ID
Starting commit: 90fd7534f7dde23d1e96b3104a96221eb859f4b8
Review boundary: Backend/Core/Team and its Agent/Core callers.

## Agreed behavior

Use complete Pi messages plus metadata for shared group context, with authoritative sender attribution in message content. Persist ordered per-message context rows and append only new accepted publications. Reuse Team-owned resident group context across member activations; load once per workspace on first use and restore on restart. SQL commit precedes memory publication; reset and uncertainty must remain consistent.

## Implementation decisions

Team context and frontend stable presentation are separate, as for Agent context/history. Keep existing stable shared final references, timeline reservations and API shapes. Materialize the model-facing public text/images once in chat_context_entries; private thinking/tools remain only in Agent history/context. Group context metadata includes sender, recipients, workspace/order/exchange and optional final origin. Migration backfills from existing shared history losslessly before runtime opens. Team alone owns this data and supplies detached read ranges through the existing Agent port.

## Safeguards

Preserve unrelated .gitignore edits. No live database, workspace, provider or deployment mutation. Use deterministic providers and disposable databases. No new frontend contract.

## Delivered

- Team owns GroupContextEntry ({messageId, Pi Message, metadata}), GroupContextState and resident GroupContexts. Sender/mentions are in authoritative public content as well as metadata. Native images remain image blocks; private thinking/tools remain Agent-owned.
- chat_context_entries stores ordered per-message envelopes. Normal accepted publication inserts one new row and updates only small chat_settings position/count fields in the existing acceptance/admission transaction. Stable frontend history still holds exact private final references; all existing API/SSE shapes and reservation semantics remain intact.
- First root read loads the shared model once per workspace; later reads/runs return detached suffixes from memory without resolving private finals or image blobs. Bound reads use SQL transaction state without creating a speculative cache.
- Outer commit callbacks acknowledge resident state, rollback preserves it, uncertainty invalidates before reuse, reset clears it consistently, and Core shutdown releases it. Row-count validation detects incomplete durable context.
- Startup backfills existing accepted messages/images/origins atomically per workspace using a context_format marker, preserving stable IDs/order/time and records. Failed conversion retries without partial rows or implicit reset.
- Canonical Team/Core and detailed persistence/context references were reconciled.

## Verification

Final candidate: 220 backend tests and 84 disposable MySQL integration tests pass; backend build and verification of all 12 RSI nodes, source mappings, context links and compiled startup/assets pass. New tests cover native Pi messages and copied sender metadata, pictures, detached ranges, initial-load races, one load across runs/members, SQL triggers prohibiting existing-row UPDATE/DELETE during normal publication, rollback/reset, missing rows, uncertain commits without replay and transactional/retryable migration preserving timeline and exact origins.

All check runs, including failures, remain in tests.jsonl. The initial new migration fixture incorrectly passed the PNG factory instead of its bytes; it was corrected to png(). A test union needed a member-author type guard. A temporary test-path collision was corrected by restoring the existing team-context.test.ts byte-for-byte and putting the new checks in team-group-context.test.ts; no old tests were removed or weakened. The final 220 tests include all 215 previous tests plus five new tests.

## Handoff

Restart the backend, with the old instance stopped, to run the automatic migration. No metadata reset is needed. No live database, workspace files/runtime metadata, providers or deployment were changed. Resident memory grows with loaded workspaces; group compaction/eviction remain deferred. Unrelated .gitignore edits stay outside the commit. No merge or push is included.
