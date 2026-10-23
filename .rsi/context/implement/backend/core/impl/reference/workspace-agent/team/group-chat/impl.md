> Existing behavior reference inside the aggregate implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

# Group chat implementation

## Contract

[Group chat design](design.md).

## Responsibilities and decomposition

Chat records and member context/admission boundaries are durable in MySQL. Publication validates mentions and resolves recipient model snapshots before one transaction persists the shared message, exchange budget, frozen context admission, and recipient run records. Busy checks and optional prepared recipient member-revision checks occur again inside the transaction. A revision mismatch refuses the whole publication before any message or activation is stored. A member final publication completes its sender run in that transaction, completing durable sender admission; recipient execution still waits for sender runtime finalization. Runtime terminal finalization is idempotent for this case.

TeamRunner coordinates publication/admission and sequential execution. TeamSystem.beforeStep invokes [conversation context](../conversation-context/impl.md) on the first model step. It loads assigned implementation README summaries and prepares a fixed group/document/failed-history/incoming composition, then records fresh Bash retrieval results as private history. Idle members have no shared-message delivery copies. Terminal SQL transactions advance processed/successful boundaries and clear run-local context while preserving immutable history. Expected publication refusals still add private feedback and continue the same run.

Workspace chat queries read durable transcript and run status; long-lived SSE follows use versioned notifications and database snapshots. Restart interrupts run records and retains recorded failed private work without reactivating members. Stop fences exchanges before cancellation.

## Verification

Unit tests cover mention parsing, routing, ordered admission and sequential execution, atomic refusal, budgeting, stop and follow. Disposable MySQL tests exercise real runtime private/public separation, activation-time context snapshots, publication feedback, persistence/restart, and SQL atomicity. Existing solo runtime, design, harness and configuration checks remain required.

## Code map

- [Chat records, mention parsing and context entry format](../../../../../../../../../../backend/src/core/group-chat.ts)
- [Agent response header parser](../../../../../../../../../../backend/src/core/member-response.ts)
- [File-backed response/routing rules](../../../../../../../../../../backend/prompts/team/group-chat.md)
- [Publication and activation coordinator](../../../../../../../../../../backend/src/core/team-runner.ts)
- [Database implementation](../../../database/impl.md) owns atomic persistence and delivery.
- Parent [team implementation](../impl.md) owns runtime policy integration and routes.
- [Group unit tests](../../../../../../../../../../backend/test/team-group-chat.test.ts) and [MySQL integration](../../../../../../../../../../backend/test/integration/backend.test.ts).

Shutdown fences new publication, waits for accepted in-flight publications to register jobs, and then closes the runtime. Retirement cancels execution and preserves stable history; retired members receive no new model activation context. No group transcript is reconstructed from private agent history.

## Coordination and data flow

TeamSystem receives the durable assistant record after tool execution. finalAnswer selects naturally completed text blocks; native commentary continues and truncation fails. TeamRunner validates mentions and invokes publishChat with the exact message identity. The store revalidates text selection and atomically completes the sender, records its final reference and admits recipient runs. Private follow returns whole stored Pi records and compact in-memory progress frames; the frontend projects its own visible activity and applies accepted contentIndices only after group publication.

## Decisions and constraints

Lock order is workspace then all relevant agents then clock for publication; runtime terminal writes use agent then clock and never take the workspace lock. The clock prevents concurrent writers from reusing display/change positions. Revisions are change cursors, distinct from publication/delivery positions. TeamRunner followTimeline reads paged durable changes and wakes on admission, completion, cancellation and settings updates. HTTP adds timeline and timeline-follow under team/chat; existing publication feeds remain the shared-context contract.

Migration imports old prototype records once per workspace in publication order. Old atomic completed-run endPosition identifies the original committed final candidate; migration validates its text and never searches for the latest response. Missing/corrupt references fail explicitly. Old runs without an accepted final become retained status entries. Existing reference data and agent history are never deleted.

TeamSystem offers naturally completed final text for atomic group publication without Git checkpoints. Runtime still settles pending effects and optional finalization before releasing the workspace execution lock. No filesystem or Git policy is added to SQL group admission.

## Unified streaming and model completion

Ordinary assistant text and tools stream to the user as one private activity flow. Backend selects a final candidate after model completion, using native phase where available and normal terminal reasons where absent. Successful publication establishes acceptance. Accepted references pin exact text block indices; frontend disclosure cannot publish or trigger work. Busy/mention-budget refusal remains atomic. Historical accepted references remain immutable.

Publication/admission and user member-config control share TeamRunner's per-workspace operation gate. User activation refuses any active/admitted/finalizing job and rechecks durable active-run state during the database transaction. Concurrent publication runs before or after the complete activation, never within its idle-check/write window. This coordination does not queue a busy member trigger or automatically retry activation. Sender mention-slot release still permits normal handoffs; the separate run-job map remains until terminal finalization finishes.

## Mention token boundaries

userMentions() in group-chat.ts excludes bare-name matches immediately followed by a slash, preserving scoped package/path tokens as ordinary text. TeamRunner uses that parser only for user input. Agent publication uses parseMemberResponse on the selected raw final text. Explicit braces and real unknown/busy mentions retain existing refusal rules. No frontend string matching, report deduplication, message deletion or provider-specific routing exception is used. Refused candidates remain real private records; accepted finalRef alone selects the published report.

Regression tests cover scoped packages with unknown and existing member names, mixed package tokens plus real mentions, single-publication acceptance of reports containing package names, and the frontend's projection of two genuine refused attempts plus one accepted final.

## Agent routing envelope and immutable body references

member-response.ts owns strict optional-header parsing. TeamRunner parses each candidate before recipient resolution and passes only body plus explicitly parsed names to publication; the body never enters the user mention scanner. CoreData independently parses the immutable selected assistant source, stores its bodyOffset with contentIndices and verifies the published body against that slice. finalText resolves new references by their stored offset, without reparsing accepted older messages. No schema/table migration or raw-history mutation is required.

MemberInstructions loads backend/prompts/team/group-chat.md once for fixed response/routing instructions; build packages this required asset. Dynamic member/role/roster instructions remain backend-owned. Invalid header syntax is an AppError caught by the normal private publication-feedback path. No completion tool or second runtime loop is introduced.

Frontend projection hides a leading routing header, including incomplete prefixes while streaming, without deciding recipient validity or final acceptance. It preserves text block identity/order, tools, native commentary and accepted-final exclusion. Private records remain raw; group APIs and shared contexts contain body text only.

## Conversation reset coordination

TeamRunner.reset serializes with publication and configuration activation through the workspace operation gate, rejects any active/admitted/finalizing job and invokes one database reset transaction. SQL rechecks all workspace member active-run markers while holding workspace then agent locks. Clearing durable history follows dependency order; no filesystem operation is involved. Successful reset wakes timeline and legacy followers. Both follow loops emit a reset boundary before post-reset data and continue using monotonic positions. A reset cannot race with a new run inside the gate.

AgentRuntime persists recoverable tool errors and completes the call batch before invoking team continuation policy. TeamSystem already continues any response with tool calls; the next step reads the full canonical context including error results. Final publication/mentions stay on the same natural-completion path. No team retry scheduler or provider-specific exception is added.

## Private execution progress

The version-1 durable group timeline and final references are unchanged. Private execution follows use the runtime’s version-2 compact in-memory progress contract. SQL completed messages remain authoritative; transient gaps/restarts do not rewrite group order or publish partial work. Idle reset clears both durable conversations and member progress buffers.

## Shared workspace execution lock

TeamRunner.acquireExecution uses a separate per-workspace OperationQueue from publication admission. RuntimePolicy.acquireRun obtains it before any request/tool and returns a release callback. AgentRuntime releases only after pending effects, afterRun and terminal persistence settle. Waiting abort rejects acquisition and skips policy finalization, while still recording cancellation durably. Publication continues to atomically reserve recipients; no lock is held while waiting for a recipient execution. parseMemberResponse and the SQL publication boundary enforce at most one agent recipient. Existing user multi-recipient admission remains unchanged.

## Image attachment integration

The attachment adapter [chat-images.ts](../../../../../../../../../../backend/src/core/chat-images.ts) owns bounded multipart decoding, actual PNG/JPEG/WebP byte signatures, preparation and metadata validation. It reuses public Pi 0.87.1 convertToPng for WebP normalization and resizeImage for decoding, aspect-preserving resizing and encoding. The encoded limit is 4.5 MiB with 2000-pixel edges (below the external 5 MiB stored-image cap). It adds no semantic caption and has no private Pi imports or custom image decoder. Invalid preparation refuses the full publication before SQL admission. HTTP rawBody bounds multipart source data to four 10 MiB images plus 128 KiB envelope/text overhead. JSON text submissions keep their existing route.

TeamRunner resolves recipients and checks new-picture model input capability before publishChat. GET chat/attachments/:id uses the workspace-scoped store lookup and serves binary with its stored type, byte length, private no-cache and nosniff. Missing images return 404. The same transaction that records the user publication stores prepared binary data, metadata references, timeline reservation and run admissions. The group API/feed never carries image bytes/base64.

[Image unit tests](../../../../../../../../../../backend/test/chat-images.test.ts), [HTTP tests](../../../../../../../../../../backend/test/team-routes.test.ts) and disposable MySQL integration cover real Pi processing, malformed input, refusals, workspace isolation, restart, native context and reset.
