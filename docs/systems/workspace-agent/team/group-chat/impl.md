# Group chat implementation

## Contract

[Group chat design](design.md).

## Responsibilities and decomposition

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

## Coordination and data flow

MySqlStore’s chat_entries holds stable ordered user/member entries. chat_clock holds display position and change seq; chat_changes appends immutable lifecycle snapshots. Publication reserves recipient entries in mention order in the same transaction as shared acceptance and run creation. Successful final publication validates finalMessageId against the sender’s committed assistant record, stores only a FinalReference in member public records, and completes its existing entry with the terminal working-history bound. Readers resolve text from the immutable messages table. Finish/recovery appends terminal changes without a fake final. Names at completion reflect the accepted publication; member color remains a frontend ID projection.

## Decisions and constraints

Lock order is workspace then all relevant agents then clock for publication; runtime terminal writes use agent then clock and never take the workspace lock. The clock prevents concurrent writers from reusing display/change positions. Revisions are change cursors, distinct from publication/delivery positions. TeamRunner followTimeline reads paged durable changes and wakes on admission, completion, cancellation and settings updates. HTTP adds timeline and timeline-follow under team/chat; existing publication feeds remain the shared-context contract.

Migration imports old prototype records once per workspace in publication order. Old atomic completed-run endPosition identifies the original committed final candidate; migration validates its text and never searches for the latest response. Missing/corrupt references fail explicitly. Old runs without an accepted final become retained status entries. Existing reference data and agent history are never deleted.
