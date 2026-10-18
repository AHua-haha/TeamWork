# In-memory compact streaming

Status: complete
Task start commit: b125f7ea437b16196c577b30e946a90a9a19c4fa
Review boundaries: member execution streaming, durable message storage and frontend synchronization.

## Design outcomes
- [delivered] Persist completed messages in SQL; keep progress in a per-member, 1,024-event in-memory FIFO, independent of readers.
- [delivered] Deliver compact reconstructable block events without cumulative partials, with consistent SQL-history-to-message-start cutover.
- [delivered] Recover reconnect/eviction gaps through completed history and the next retained unfinished-message start. Preserve group references, ordering and final-response presentation.

## Decisions and open questions
- Count-only capacity is intentional; no byte or three-message retention rule. Eviction never waits for subscribers.
- The progress buffer is a separate runtime-owned storage area read by the observation API. SQL remains authoritative for completed records and run state.
- Progress is lost on restart; existing interruption recovery preserves completed history.
- A missing start suppresses that message tail until durable completion or the next valid start. Compact events retain block identity and essential metadata/signatures.
- SQL synchronization happens on initial/reconnect and durable changes, never every incoming delta.

## Checkpoints and remaining work
- Delivered the memory FIFO, compact execution v2 frames, incremental frontend reducer, SQL-only completed history/run state and scoped notifications. Removed SQL chunk retention, full-partial wire payloads, obsolete event codec and old retention options. Group timeline v1 and publication semantics remain unchanged. Canonical runtime/database/frontend/group documents and API usage notes are promoted.
- Final verification passed: 153 backend unit/HTTP tests, 57 disposable MySQL integration tests, 76 frontend tests and both builds. SQL tests cover zero reads during 100 deltas between durable boundaries, FIFO gaps during paused synchronization, next-start recovery, transient-table migration preserving stable records, restart, and reset clearing retired-member progress. Pi frame-equivalence tests preserve interleaved content and signatures.
- Browser verification against a disposable real SQL/runtime/HTTP backend passed live text, evicted-start reload, SQL recovery, subsequent-message streaming, tool display, hidden thinking, final folding/deduplication, narrow layout and durable reload. The first browser attempt used the button's visible text instead of its accessible name; the corrected procedure passed. Intermediate type checks identified stale fixtures and missing test annotations; failures remain in tests.jsonl.
- The deterministic 2,000-delta benchmark reduced serialized event payloads from 66,819,000 bytes to 164,000 bytes (99.75%) and retained exactly 1,024 events. This is a synthetic payload comparison, not a promised live CPU percentage.
- Restarted the idle managed backend with execution v2 and the transient-table migration. Exact HTTP snapshots confirm workspace registration, agents, active members, group chat/timeline, configuration approvals and harness state were preserved. No real model calls, approvals or activations were issued. Browser fixture/container processes were shut down.
- Canonical/draft parity, local links, retired SQL-path removal, credential exclusion and whitespace audits passed. No remaining design decisions or implementation work. See [test evidence](tests.jsonl).
