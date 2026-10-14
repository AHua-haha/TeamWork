<!-- Task proposal; current contract is under docs/systems/ -->
# Group chat implementation

## Contract

[Group chat design](design.md).

## Responsibilities and composition

Chat records and delivery cursors are durable in MySQL. Publication validates mentions and resolves recipient model snapshots before one transaction persists the shared message, exchange budget, member context delivery, and recipient run records. Busy checks occur again inside the transaction. A member final publication completes its sender run in that transaction, releasing the sender before recipients execute. Runtime terminal finalization is idempotent for this case.

TeamRunner coordinates publication and launches persisted runs in parallel. The runtime loop retains private history and asks TeamRunner to publish a final candidate before ending. Expected refusals append private feedback and continue the same loop. No send-message or assignment call tool remains. Group delivery appends only model-context entries, preserving the separate immutable private runtime history. Each member has a durable group position: idle members drain on publication; busy members drain at terminal completion. New members inherit existing shared messages when created.

Workspace chat queries read durable transcript and run status; long-lived SSE follows use versioned notifications and database snapshots. Restart interrupts run records and drains pending member delivery without reactivating members. Stop fences exchanges before cancellation.

## Verification

Unit tests cover mention parsing, routing, parallel launch, atomic refusal, budgeting, stop and follow. Disposable MySQL tests exercise real runtime private/public separation, deferred context delivery, publication feedback, persistence/restart, and SQL atomicity. Existing solo runtime, design, harness and configuration checks remain required.

## Code map

- [Chat records, mention parsing and context entry format](../../../../../backend/src/group-chat.ts)
- [Publication and activation coordinator](../../../../../backend/src/team-runner.ts)
- [Database implementation](../../../database/impl.md) owns atomic persistence and delivery.
- Parent [team implementation](../impl.md) owns runtime policy integration and routes.
- [Group unit tests](../../../../../backend/test/team-group-chat.test.ts) and [MySQL integration](../../../../../backend/test/integration/backend.test.ts).

Shutdown fences new publication, waits for accepted in-flight publications to register jobs, and then closes the runtime. Retirement records the final shared position before cancellation, so buffered prior messages can drain while later messages are excluded. No group transcript is reconstructed from private agent history.
