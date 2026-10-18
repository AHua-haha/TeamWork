# Group chat implementation

## Contract

[Group chat design](design.md).

## Responsibilities and decomposition

Chat records and delivery cursors are durable in MySQL. Publication validates mentions and resolves recipient model snapshots before one transaction persists the shared message, exchange budget, member context delivery, and recipient run records. Busy checks and optional prepared recipient member-revision checks occur again inside the transaction. A revision mismatch refuses the whole publication before any message or activation is stored. A member final publication completes its sender run in that transaction, releasing the sender before recipients execute. Runtime terminal finalization is idempotent for this case.

TeamRunner coordinates publication and launches persisted runs in parallel. The runtime loop retains private history and asks TeamRunner to publish a final candidate before ending. Expected refusals append private feedback and continue the same loop. No send-message or assignment call tool remains. Group delivery appends only model-context entries, preserving the separate immutable private runtime history. Each member has a durable group position: idle members drain on publication; busy members drain at terminal completion. New members inherit existing shared messages when created.

Workspace chat queries read durable transcript and run status; long-lived SSE follows use versioned notifications and database snapshots. Restart interrupts run records and drains pending member delivery without reactivating members. Stop fences exchanges before cancellation.

## Verification

Unit tests cover mention parsing, routing, parallel launch, atomic refusal, budgeting, stop and follow. Disposable MySQL tests exercise real runtime private/public separation, deferred context delivery, publication feedback, persistence/restart, and SQL atomicity. Existing solo runtime, design, harness and configuration checks remain required.

## Code map

- [Chat records, mention parsing and context entry format](../../../../../backend/src/group-chat.ts)
- [Agent response header parser](../../../../../backend/src/member-response.ts)
- [File-backed response/routing rules](../../../../../backend/prompts/team/group-chat.md)
- [Publication and activation coordinator](../../../../../backend/src/team-runner.ts)
- [Database implementation](../../../database/impl.md) owns atomic persistence and delivery.
- Parent [team implementation](../impl.md) owns runtime policy integration and routes.
- [Group unit tests](../../../../../backend/test/team-group-chat.test.ts) and [MySQL integration](../../../../../backend/test/integration/backend.test.ts).

Shutdown fences new publication, waits for accepted in-flight publications to register jobs, and then closes the runtime. Retirement records the final shared position before cancellation, so buffered prior messages can drain while later messages are excluded. No group transcript is reconstructed from private agent history.

## Coordination and data flow

TeamSystem receives the durable assistant record after tool execution. finalAnswer selects naturally completed text blocks; native commentary continues and truncation fails. TeamRunner validates mentions and invokes publishChat with the exact message identity. The store revalidates text selection and atomically completes the sender, records its final reference and admits recipient runs. Private follow returns stored Pi blocks/chunks unchanged; the frontend projects its own visible activity and applies accepted contentIndices only after group publication.

## Decisions and constraints

Lock order is workspace then all relevant agents then clock for publication; runtime terminal writes use agent then clock and never take the workspace lock. The clock prevents concurrent writers from reusing display/change positions. Revisions are change cursors, distinct from publication/delivery positions. TeamRunner followTimeline reads paged durable changes and wakes on admission, completion, cancellation and settings updates. HTTP adds timeline and timeline-follow under team/chat; existing publication feeds remain the shared-context contract.

Migration imports old prototype records once per workspace in publication order. Old atomic completed-run endPosition identifies the original committed final candidate; migration validates its text and never searches for the latest response. Missing/corrupt references fail explicitly. Old runs without an accepted final become retained status entries. Existing reference data and agent history are never deleted.

TeamSystem checkpoints harness state before invoking final publication. Its runtime afterRun hook finalizes failed/cancelled/interrupted work after policy/tool effects settle and skips a successfully checkpointed publication, preventing an older sender from checkpointing a successor activation. No filesystem or Git policy is added to SQL group admission.

## Unified streaming and model completion

Ordinary assistant text and tools stream to the user as one private activity flow. Backend selects a final candidate after model completion, using native phase where available and normal terminal reasons where absent. Successful publication establishes acceptance. Accepted references pin exact text block indices; frontend disclosure cannot publish or trigger work. Busy/mention-budget refusal remains atomic. Historical accepted references remain immutable.

Publication/admission and user member-config control share TeamRunner's per-workspace operation gate. User activation refuses any active/admitted/finalizing job and rechecks durable active-run state during the database transaction. Concurrent publication runs before or after the complete activation, never within its idle-check/write window. This coordination does not queue a busy member trigger or automatically retry activation. Sender mention-slot release still permits normal handoffs; the separate run-job map remains until terminal finalization finishes.

## Mention token boundaries

userMentions() in group-chat.ts excludes bare-name matches immediately followed by a slash, preserving scoped package/path tokens as ordinary text. TeamRunner uses that parser only for user input. Agent publication uses parseMemberResponse on the selected raw final text. Explicit braces and real unknown/busy mentions retain existing refusal rules. No frontend string matching, report deduplication, message deletion or provider-specific routing exception is used. Refused candidates remain real private records; accepted finalRef alone selects the published report.

Regression tests cover scoped packages with unknown and existing member names, mixed package tokens plus real mentions, single-publication acceptance of reports containing package names, and the frontend's projection of two genuine refused attempts plus one accepted final.

## Agent routing envelope and immutable body references

member-response.ts owns strict optional-header parsing. TeamRunner parses each candidate before recipient resolution and passes only body plus explicitly parsed names to publication; the body never enters the user mention scanner. MySqlStore independently parses the immutable selected assistant source, stores its bodyOffset with contentIndices and verifies the published body against that slice. finalText resolves new references by their stored offset, without reparsing accepted older messages. No schema/table migration or raw-history mutation is required.

MemberContext loads backend/prompts/team/group-chat.md once for fixed response/routing instructions; build packages this required asset. Dynamic member/role/roster instructions remain backend-owned. Invalid header syntax is an AppError caught by the normal private publication-feedback path. No completion tool or second runtime loop is introduced.

Frontend projection hides a leading routing header, including incomplete prefixes while streaming, without deciding recipient validity or final acceptance. It preserves text block identity/order, tools, native commentary and accepted-final exclusion. Private records remain raw; group APIs and shared contexts contain body text only.

## Conversation reset coordination

TeamRunner.reset serializes with publication and configuration activation through the workspace operation gate, rejects any active/admitted/finalizing job and invokes one database reset transaction. SQL rechecks all workspace member active-run markers while holding workspace then agent locks. Clearing durable history follows dependency order; no filesystem operation is involved. Successful reset wakes timeline and legacy followers. Both follow loops emit a reset boundary before post-reset data and continue using monotonic positions. A reset cannot race with a new run inside the gate.
