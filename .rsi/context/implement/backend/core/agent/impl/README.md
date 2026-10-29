# Agent implementation context

`AgentRuntime.runMaintenance` uses an ephemeral `maintenance_<uuid>` agent identity and ordinary UUID run identity, both valid under Agent state validation. Maintenance runs execute the actual in-memory model/tool loop without durable member context; Team owns their submission effects. `backend/test/team-summary.test.ts` verifies startup scheduling through this public method, real state validation, tool execution and completion using a synthetic model stream.

Maintenance additionally accepts an optional fourth `AgentObserver` argument, forwarded to `AgentExecution`. Callers can observe maintenance records and errors without introducing member publications or private context persistence. Team uses the message callback to report rejected summary tool calls while allowing ordinary recoverable tool feedback and retries to continue.

## Result summary

Agent owns both its core in-memory model and its durable data model. AgentExecution is the reusable model/tool mechanism; AgentRuntime supplies Agent-owned durable hosting, progress/follow and recovery. Neither imports concrete Team/Harness/Workspace models or repositories.

Design: [Agent](../../../../../design/backend/core/agent/design.md).

### Model and persistence contract

**Input:** data/model.ts defines ContextEntry, ContextHistory, CompletedMessage, RunState, CurrentState and FollowSnapshot/FollowEvent; data/validation.ts validates them. AgentContextState owns the resident ContextHistory and identity index across activations. AgentState(run,context,historyPosition) owns run-local values and references that context model; snapshots are detached. AgentData(storage,hooks?,connection?) owns SQL. AgentRuntime(data,configSource,policy,stream,options?) accepts the existing model/policy/compaction inputs.

**Output:** getContext/residentContext/patchContext/replaceContext, getState/followSnapshot, runMessages/completedMessage, createAgent/startRun/beginMessage/commitMessage/finishRun, compaction lifecycle and recovery. AgentExecution.run returns acknowledged terminal state; snapshot returns detached {run,context,historyPosition}. AgentConfiguration, ResolvedRunConfig and RunConfigSource are Agent public request inputs. Team supplies the latter without transferring ownership of its provider/member settings.

**Effect and failure:** AgentData owns agents, agent_context_entries, runs, messages and context_compactions schemas, versioned codecs, validation, queries and migrations. Context CAS atomically stores content and incorporation markers. Whole messages are immutable and persist before announcement; progress remains a bounded in-memory FIFO. AgentRuntime attaches the resident model after acquiring execution authority and acknowledges AgentExecution through AgentData directly. The first use loads ordered context rows; later activations and idle delivery reuse the same model. Success/failure retains recorded context; explicit reset is the destructive exception. Runtime lease/recovery belongs to Agent. Missing interrupted results receive uncertainty diagnostics without replay. No Team table is required to run or restore a standalone AgentData/AgentRuntime.

**Usage example:** const data = new AgentData(storage); await data.migrate(); const runtime = new AgentRuntime(data,source,policy,stream); await runtime.open(); const {agentId}=await data.createAgent(); const run=await runtime.start(agentId,'request'); await runtime.finished(agentId,run.runId). Close the runtime before the owning storage. CoreData supplies optional foreign profile/presentation callbacks when composing the full application.

### Incremental context storage and memory lifecycle

**Input:** ContextEntry keeps the complete Pi Message and source metadata. AgentData.patchContext(id,revision,{append,update}) accepts new entries and targeted edits; replaceContext accepts an explicit replacement. residentContext(id) returns the owned AgentContextState; getContext(id) reads a detached durable SQL snapshot for inspection/restoration.

**Output:** agent_context_entries contains one entry envelope per (agent_id,position), with unique (agent_id,id). positions start at 1. agents keeps context_length and context_revision, not whole-context JSON. Loading validates contiguous order, identities, length and messages. messages remains a separate immutable history with its own positions.

**Effect and failure:** startRun/commitMessage insert only the new context/history rows and update small bookkeeping. beginMessage, admission and terminal coordination read no context payloads. Safe group delivery inserts new rows and updates only provenance-modified entries; repair inside an explicitly restored malformed prefix can require replacement. Compaction/explicit replacement/reset replace active rows atomically with revision checks; preparation remains immutable history until cutover. Whole-context SQL is absent from ordinary writes.

ResidentContexts deduplicates initial asynchronous loads and shares one AgentContextState across repository transaction views and run-local AgentState instances. MySqlStorage.afterCommit(connection,callback) publishes acknowledged changes synchronously only after the outer commit; rollback publishes nothing. Updates arriving during initial load are reconciled by revision exactly once. Unexpected revision gaps and uncertain SQL commit acknowledgements invalidate the resident model, preventing stale execution, and permit exceptional restoration from the actual durable state without replay. Resident loads from uncommitted transaction views are refused. Reset empties the same resident model after commit. Runtime release/shutdown clears resident references; first use after restart loads durable rows again. Context memory grows with loaded agents; no eviction policy is added.

Migration creates agent_context_entries, converts each old agents.context envelope transactionally without changing order, IDs, signatures, metadata, context revisions or stable history, then drops the old context column only after every conversion succeeds. Startup retries safely after interruption. Existing context_format adoption remains separate. No workspace metadata reset is required. Run the startup migration with the old backend stopped.

**Usage example:** repeated runtime.start calls for one agent share its resident context; SQL tracing for two user/assistant runs observes one initial context read, four entry inserts, and no context-row updates/deletes. A new backend restores the same context, including empty signed/redacted thinking blocks.

### Cross-owner transactions

inTransaction(connection) binds operations to a transaction created by the same MySqlStorage.transaction without owning commit/rollback; this preserves outer-commit memory acknowledgements. executionState(id,lock?) returns only {id,historyPosition,activeRunId}, avoiding private-context reads for Team admission. readRun/readRuns/activeRuns/listRuns and completedMessage return owner-validated values, not SQL rows. createRecord/admitRun/completePublishedRun let Team coordinate member creation/publication; completePublishedRun verifies active identity and finished private output, while Team writes its own final reference. Normal finishRun calls the parent-supplied presentation hook on the same transaction. resetConversations, clearHistory and deleteRecords are used by coordinated resets after foreign references are removed.

### Continuous context and compaction

AgentMessageContext owns group incorporation. RuntimePolicy.groupContext provides only {id,read(after)}; markers groupContextId/groupPosition/groupMessageId live on entries. Shared messages enter before work or after work settles, never midway through a tool exchange. Own accepted finals gain separate sender/provenance text without changing original signed blocks or duplicating their answer. Team owns shared content; Agent chooses the incorporation/compaction boundary.

Shared context compaction now calls `GroupContextReference.read(after, through?)`, with Agent supplying its already incorporated upper position. Team returns the accepted shared summary plus the original tail, or archived original messages if its latest summary covers future positions. `compactedContext` appends the newly retained private preparation messages after that shared context; no semantic tree or member-involvement projection remains. Normal delivery stays incremental, and existing durable compaction acknowledgement/recovery boundaries remain unchanged. `group-summary.test.ts` verifies full-summary use and the older-checkpoint fallback.

AgentConfiguration.compaction?: {thresholdTokens,prompt} uses Pi estimateContextTokens(normalizeContext(request.context)). One positive safe-integer threshold (managed default 64000) applies before ordinary calls and after work. Preparation reuses ordinary tools with mode=compaction, bypasses publication and live ordinary-response chunks, and has its own default 64-call budget. Retain every new assistant/tool message after the control prompt, discard the prompt/old private prefix only after acknowledged completion, then prepend original incorporated group messages. Invalidate old provider usage on context copies; immutable records keep their original usage. The release-owned instruction makes preparation strictly context preservation: it prohibits continuing the task or making implementation/design/configuration changes, while encouraging useful file reads, workspace inspection and targeted checks of existing conclusions. It retains the work already performed, conclusions/evidence and uncertainties, then requests Next steps as a handoff rather than actions to execute. The checkpoint describes runtime behavior only after cutover. Preparation never creates another ordinary run or mention and does not recursively retry at one checkpoint.

AgentData beginCompaction/commitCompactionMessage/finishCompaction journals tentative records under the owning run without changing current context. CAS context replacement and terminal journal state commit together. Failed preparation retains old context plus recorded effects; finishing failure preserves the ordinary outcome. Uncertain lifecycle/message/cutover acknowledgement surfaces as persistence_failure even after publication and leaves recovery to restart, never a competing replacement. Startup recovers preparing journals before interrupted runs, including already published ordinary responses, without replay. Public final references/end ranges remain pinned. Shared-summary incorporation preserves these recovery and cutover guarantees.

adoptLegacyContext and finishLegacyMigration keep the existing once-only context_format transition; Core supplies original Team references. Agent owns the adoption algorithm and its SQL, and retires old retention/transient tables without deleting stable history. legacyContextIds avoids loading/locking already migrated contexts.

### Assistant response handlers and handler state

`AgentRuntime` obtains and caches handler instances through `RuntimePolicy.createAssistantResponseHandlerFactories(agentId)` in a per-Agent resident set; the same instances are reused across runs. The dispatcher invokes matching handlers, then invokes `DefaultAssistantResponseHandler` for any unhandled tool calls. It validates unique call IDs, executes calls at most once and preserves assistant call/result order. Hints are buffered until all tool results are recorded so they cannot break protocol pairing.

**Handler state durability and resident pattern:** Agent owns `agent_assistant_response_handler_state` schema (agent_id, handler_id, revision, data JSON). Handler state is resident and shared across all runs, matching the Agent context resident pattern:

1. **Resident loading:** At Agent init, `AgentRuntime` loads handler factory instances for the Agent and initializes each with its durable state snapshot through the `persist` callback.
2. **Shared instances:** The same handler instances are reused across multiple runs; they maintain their in-memory state between activations.
3. **In-memory updates:** During a run, handlers modify their state in memory; these changes accumulate across runs.
4. **Durable sync:** Handler state is persisted to the database through revision-checked updates. After successful persistence, the resident is notified via `ResidentHandlers.changed()` to advance its in-memory state.
5. **Invalidation:** On persistence failure, the resident is invalidated and will be reloaded from durable storage on the next Agent activation.
6. **Reset:** Handler state is cleared consistently with Agent context during explicit reset.

`ResidentHandlers` (new class in `data/resident-handlers.ts`) manages handler instances per Agent, mirroring `ResidentContexts`. It deduplicates concurrent loads, applies pending updates once handlers are ready, and invalidates on failure. `DurableHandlerState` (new utility base class in `resident-handler-wrapper.ts`) provides handlers with a common state management pattern: load initial durable state, read/modify in memory, and persist updates atomically.

`DefaultAssistantResponseHandler` is the compatibility path: it delegates each configured tool call through the existing RuntimePolicy/Harness tool executor, records the native Pi `toolResult` with its call ID/name and current error recovery behavior, then returns to the existing continuation loop. Existing tool definitions and implementations are unchanged. Handler metadata updates retain the original stored Pi message and use Agent's acknowledged context patch/replacement operations. Context inspection remains unchanged.

**Handler factory pattern:** `RuntimePolicy.createAssistantResponseHandlerFactories(agentId)` returns handler factory objects with `handlerId: string` and `create(durableState, persist) -> AssistantResponseHandler`. Factories create handler instances initialized with their durable state; `persist(revision, data)` is an async callback for saving state to the database. Handlers may call `persist()` during `handle()` to atomically update their state and trigger resident advancement.

**Handler input:** `AssistantMessage`, `AssistantResponseHandlerContext` and the small durable handler snapshot. Handler-owned declarations have no standalone executor; other `RuntimeTool`s retain their executable implementations. `buildModelRequest` installs handler declarations directly and replaces colliding legacy names, including during compaction. Team resolves the workspace directory and registers `fileAssistantResponseHandlerFactory(root)`; no Harness file capability is passed. Handler initialization occurs after execution queue acquisition so filesystem/config/state loads cannot reorder admitted members.

**File tools:** `FileAssistantResponseHandler` owns custom read/write/edit schemas, descriptions and direct Node filesystem operations. Relative paths resolve from the workspace root; absolute/outside paths and symlinks work without Harness access checks. Canonical absolute paths deduplicate references. Reads prepare images with Pi's public image utilities or return UTF-8 text with `cat -n` numbering, gap markers and trailing metadata. Text views are complete aggregates, with no inherited native-tool truncation claim. Exact-string edits support multiple non-overlapping replacements, preserve CRLF, shift ranges and reveal changed lines. Writes create parents and return the full file. Empty files have zero lines.

**State and lookup:** `files[absolutePath] = {ranges, visibleMessageId}` stores no content. Each successful operation records an aggregate, then directly hides the prior referenced message using `AgentContextState.entry(messageId)`, an existing resident index. Only the newest aggregate is visible in future model requests; original stable results remain intact, including earlier results from the same assistant turn. Errors do not hide or replace the last successful view. Successful write calls suppress only their content argument in model projection. Old range-only handler state is reconciled once from the already-restored context; normal calls never scan context/history. A removed compaction reference is ignored on the next replacement. Reset clears durable state and invalidates the resident handler.

**Atomic persistence:** `recordToolResult(..., commit)` supplies the new message identity, handler revision/state, previous reference and successful-write suppression flag. Agent builds small metadata updates by message ID. `AgentObserver.handlerMessage` delegates to `AgentData.commitHandlerMessage`: one transaction appends the new stable/context rows, uses `JSON_SET` to update only affected context metadata and replaces the small revision-checked handler state. Existing message bodies are never sent back to SQL for visibility changes. The transaction publishes one resident context append/metadata patch after acknowledgement, with no full-context read or replacement. Rollback/CAS refusal leaves all durable and resident values unchanged. Uncertain persistence invalidates residents and stops execution without replaying filesystem effects.

**Compaction:** preparation uses its own indexed draft and handler declarations. Preparation result/state commits journal targeted metadata in `context_compactions.state.contextMetadata`, without changing ordinary context before cutover. Cutover retains the updated trace; interrupted/restart recovery applies the journal to retained entries while preserving immutable history. Full context replacement remains a compaction/reset operation.

**Usage example:** reading lines 1–10 then 40–50 of `src/a.ts` returns two paired historical results. The second model request sees the first result's placeholder and the new aggregate containing both ranges. Its transaction inserts only that new result and patches only the old result metadata, plus the small handler state. A later failed edit returns an error and leaves the second view/reference visible.

**Verification:** focused real-filesystem/Agent-loop tests cover declaration-only tools, outside paths/symlinks, mixed-tool ordering, aggregation and direct references across runs/restart, failed edits, empty files, CRLF, write suppression, line padding, image blocks, legacy restoration, compaction and fatal persistence failures, including deletion to a surviving line or an empty file. MySQL integration tests verify metadata-only SQL with a large old message, atomic rollback, preparation restart recovery, resident reuse and reset behavior.

Verification for this change: backend build/type checks passed; 37 focused Agent/file/compaction/resident tests passed; the full backend unit suite passed with 264 tests and one skipped; all 94 disposable-MySQL integration tests passed. An existing immediate-background-job timing assertion failed once in the parallel unit run, then passed in isolation and in the serial full-suite run.


`backend/test/group-summary.test.ts` verifies summary/tail reads at the Agent's consumed boundary without introducing future messages or changing normal incremental incorporation. `backend/test/team-summary.test.ts` exercises the real public maintenance runtime and full model/tool correction loop. Group summary persistence remains Team-owned.

## File lookup

- [backend/src/core/agent/data/resident-context.ts](../../../../../../../backend/src/core/agent/data/resident-context.ts): lazy resident models and committed revision reconciliation.
- [backend/src/core/agent/data/resident-handlers.ts](../../../../../../../backend/src/core/agent/data/resident-handlers.ts): handler resident instances shared across runs, revision-checked state updates and invalidation.
- [backend/src/core/agent/resident-handler-wrapper.ts](../../../../../../../backend/src/core/agent/resident-handler-wrapper.ts): durable state utility base class for handlers.
- [backend/test/resident-context.test.ts](../../../../../../../backend/test/resident-context.test.ts): load coalescing, cross-run identity and group patches.
- [backend/src/core/agent/data](../../../../../../../backend/src/core/agent/data): memory/durable models, handler state persistence, validation and operations.
- [backend/src/core/agent/assistant-response-handler.ts](../../../../../../../backend/src/core/agent/assistant-response-handler.ts): default response handler fallback.
- [backend/src/core/agent/contracts.ts](../../../../../../../backend/src/core/agent/contracts.ts): handler and scoped callback interfaces.
- [backend/src/core/agent/runtime.ts](../../../../../../../backend/src/core/agent/runtime.ts): Agent-owned durable host and follow.

- [backend/src/core/agent](../../../../../../../backend/src/core/agent): owned source.
- [reference/agent-runtime/design.md](reference/agent-runtime/design.md): detailed existing behavior and code map.
- [reference/agent-runtime/impl.md](reference/agent-runtime/impl.md): detailed existing behavior and code map.
- [reference/modelflare-inventory.md](reference/modelflare-inventory.md): detailed existing behavior and code map.
- [Backend tests](../../../../../../../backend/test): unit/HTTP, in-memory execution, boundary and disposable SQL integration checks.

## Automatic retrieval

```json
{"commands": []}
```


### Shared attribution format migration

Team supplies a complete attribution string through GroupContextMessage.sender; Agent adds no message-index prefix. For an own accepted final it inserts only that attribution text block after thinking, leaving the original signed answer/thinking blocks intact. `refreshSharedAttribution(agentId, groupId, groups)` is a startup-only public data operation: `sharedAttributionUpdates` finds incorporated shared IDs, refreshes old user-message envelopes and replaces the old attribution-only assistant block, then patches only changed mutable rows. Stable message history, consumption positions and signed blocks are unchanged. Repeated migration is a no-op; legacy Agent adoption uses current Team envelopes.
