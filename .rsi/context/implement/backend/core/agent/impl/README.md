# Agent implementation context

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

The semantic-range projection is implemented. `GroupContextReference.semantic()` supplies a detached Team index without transferring consumption state. During successful compaction, `compactedContext` deterministically replaces uninvolved ranges with source-linked summary messages, recursively opens involved internal ranges, keeps involved leaves as original Pi messages and appends original messages beyond the analyzed boundary. Normal delivery remains unchanged; the projection is private context and does not advance group consumption. Native image entries are preserved alongside summaries. `AgentRuntime.runMaintenance` provides the reusable in-memory maintenance model/tool loop used by Team without creating a member publication or durable member context. Existing compaction acknowledgement/recovery semantics remain the cutover boundary. Focused tests are in `backend/test/semantic-context.test.ts`.

AgentConfiguration.compaction?: {thresholdTokens,prompt} uses Pi estimateContextTokens(normalizeContext(request.context)). One positive safe-integer threshold (managed default 64000) applies before ordinary calls and after work. Preparation reuses ordinary tools with mode=compaction, bypasses publication and live ordinary-response chunks, and has its own default 64-call budget. Retain every new assistant/tool message after the control prompt, discard the prompt/old private prefix only after acknowledged completion, then prepend original incorporated group messages. Invalidate old provider usage on context copies; immutable records keep their original usage. The instruction requests Next steps for unfinished work. Preparation never creates another ordinary run or mention and does not recursively retry at one checkpoint.

AgentData beginCompaction/commitCompactionMessage/finishCompaction journals tentative records under the owning run without changing current context. CAS context replacement and terminal journal state commit together. Failed preparation retains old context plus recorded effects; finishing failure preserves the ordinary outcome. Uncertain lifecycle/message/cutover acknowledgement surfaces as persistence_failure even after publication and leaves recovery to restart, never a competing replacement. Startup recovers preparing journals before interrupted runs, including already published ordinary responses, without replay. Public final references/end ranges remain pinned. Team semantic analysis and the Agent deterministic range projection are not implemented in the current source yet; adding them must preserve these recovery and cutover guarantees.

adoptLegacyContext and finishLegacyMigration keep the existing once-only context_format transition; Core supplies original Team references. Agent owns the adoption algorithm and its SQL, and retires old retention/transient tables without deleting stable history. legacyContextIds avoids loading/locking already migrated contexts.

### Semantic mechanism verification

`npm run check` passes. The full backend suite passes: 231 tests, 231 passed. `backend/test/semantic-context.test.ts` verifies Agent-owned deterministic projection and uncovered fallback without changing normal group incorporation. `git diff --check` passes. Durable compaction recovery continues to use the existing acknowledged cutover path; no separate semantic persistence is owned by Agent.

### Retained context inspection

**Input:** `AgentRuntime.inspectContext(agentId, {offset?, limit?, revision?})` delegates to `AgentData.inspectContext`. Offset is zero-based, defaults to 0; limit defaults to 50 and must be 1–100. Subsequent pages require revision. Shared pagination validation lives in `backend/src/core/context-page.ts` and has no message/schema ownership.

**Output:** `{revision, offset, total, nextOffset, entries}`; each entry is the exact `{messageId, message: Pi.Message, metadata}` retained in `agent_context_entries`. Next offset is null at the end. Empty contexts return total 0 and no entries. Ordering follows context position, not stable-history position.

**Effect/failure:** One repeatable-read transaction reads Agent bookkeeping and only the selected context rows. It validates row count/order/identity and stored entry format. No runtime lease/resident-context initialization, write, repair or group synchronization occurs. Unknown agents return not_found/404; invalid page input returns invalid_input/400; stale revision returns context_changed/409; incomplete migration returns runtime_unavailable/503; malformed stored data fails explicitly. Append, update, compaction and reset increment the existing context revision. Signed thinking and native images survive serialization unchanged. This is the durable context at read time, not necessarily an in-flight model request.

**Usage example:** read `inspectContext(id, {limit:50})`; if nextOffset is non-null, read with `{offset:page.nextOffset, revision:page.revision, limit:50}`. On context_changed discard the partial assembled snapshot and start at offset 0 without revision.

## File lookup

- [backend/src/core/agent/data/resident-context.ts](../../../../../../../backend/src/core/agent/data/resident-context.ts): lazy resident models and committed revision reconciliation.
- [backend/test/resident-context.test.ts](../../../../../../../backend/test/resident-context.test.ts): load coalescing, cross-run identity and group patches.
- [backend/src/core/agent/data](../../../../../../../backend/src/core/agent/data): memory/durable models, validation and operations.
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
