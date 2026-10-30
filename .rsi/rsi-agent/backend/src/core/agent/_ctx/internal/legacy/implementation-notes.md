# Agent implementation context

`AgentRuntime.runMaintenance` uses an ephemeral `maintenance_<uuid>` agent identity and ordinary UUID run identity, both valid under Agent state validation. Maintenance runs execute the actual in-memory model/tool loop without durable member context; Team owns their submission effects. `backend/test/team-summary.test.ts` verifies startup scheduling through this public method, real state validation, tool execution and completion using a synthetic model stream.

Maintenance additionally accepts an optional fourth `AgentObserver` argument, forwarded to `AgentExecution`. Callers can observe maintenance records and errors without introducing member publications or private context persistence. Team uses the message callback to report rejected summary tool calls while allowing ordinary recoverable tool feedback and retries to continue.

## Result summary

Agent owns both its core in-memory model and its durable data model. AgentExecution is the reusable model/tool mechanism; AgentRuntime supplies Agent-owned durable hosting, progress/follow and recovery. Neither imports concrete Team/Workspace models or repositories. React Harnesses and their tools/state belong to Agent.

Design: [Agent](../../DESIGN.md).

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

### Direct message/context data model

`data/messages.ts` owns `AgentMessageData` and `AgentTurnData`, shared directly with React Harness. AgentMessageData holds acknowledged operations on AgentState/AgentContextState: append, context patch/replace, targeted metadata and preparation traces. AgentTurnData owns paired results, exact call identities, metadata lookup and deferred private instructions. AgentObserver extends the data-owned persistence acknowledgement interface; the runtime wires AgentData operations without implementing another context API. Before acknowledgement, memory and purpose state remain unchanged. Ordinary writes remain incremental; compaction replaces context only at its accepted boundary.

Related opaque state uses `ComponentState` and `ComponentMessageEffects` with componentId. AgentData exposes getComponentState/saveComponentState/commitComponentMessage; historical physical table/column names are unchanged. Metadata-only preparation edits use patchCompactionMetadata and remain journaled until cutover or recovery. Stable history and original signed content are untouched. React Harness owns file-view projection and state meaning in its sibling directory.

## File lookup

- `backend/src/core/react-harness/file/instructions.md`: file-handler-owned format, aggregation and editing instructions assembled into every model request.

- [backend/src/core/agent/data/resident-context.ts](../../../../../../../../../backend/src/core/agent/data/resident-context.ts): lazy resident models and committed revision reconciliation.
- [backend/src/core/react-harness/data/resident-harnesses.ts](../../../../../../../../../backend/src/core/react-harness/data/resident-harnesses.ts): handler resident instances shared across runs, revision-checked state updates and invalidation.
- [backend/src/core/agent/resident-handler-wrapper.ts](../../../../../../../../../backend/src/core/agent/resident-handler-wrapper.ts): durable state utility base class for handlers.
- [backend/test/resident-context.test.ts](../../../../../../../../../backend/test/resident-context.test.ts): load coalescing, cross-run identity and group patches.
- [backend/src/core/agent/data](../../../../../../../../../backend/src/core/agent/data): memory/durable models, handler state persistence, validation and operations.
- [backend/src/core/react-harness/default/harness.ts](../../../../../../../../../backend/src/core/react-harness/default/harness.ts): default response handler fallback.
- [backend/src/core/agent/contracts.ts](../../../../../../../../../backend/src/core/agent/contracts.ts): handler and scoped callback interfaces.
- [backend/src/core/agent/runtime.ts](../../../../../../../../../backend/src/core/agent/runtime.ts): Agent-owned durable host and follow.

- [backend/src/core/agent](../../../../../../../../../backend/src/core/agent): owned source.
- [reference/agent-runtime/design.md](reference/agent-runtime/design.md): detailed existing behavior and code map.
- [reference/agent-runtime/impl.md](reference/agent-runtime/impl.md): detailed existing behavior and code map.
- [reference/modelflare-inventory.md](reference/modelflare-inventory.md): detailed existing behavior and code map.
- [Backend tests](../../../../../../../../../backend/test): unit/HTTP, in-memory execution, boundary and disposable SQL integration checks.

## Automatic retrieval

```json
{"commands": []}
```


### Shared attribution format migration

Team supplies a complete attribution string through GroupContextMessage.sender; Agent adds no message-index prefix. For an own accepted final it inserts only that attribution text block after thinking, leaving the original signed answer/thinking blocks intact. `refreshSharedAttribution(agentId, groupId, groups)` is a startup-only public data operation: `sharedAttributionUpdates` finds incorporated shared IDs, refreshes old user-message envelopes and replaces the old attribution-only assistant block, then patches only changed mutable rows. Stable message history, consumption positions and signed blocks are unchanged. Repeated migration is a no-op; legacy Agent adoption uses current Team envelopes.

### Ordered context inspection access path

Current-context restoration and paginated inspection explicitly use the `(agent_id, position)` primary index. The identity secondary index can otherwise produce `Using filesort`, causing `ER_OUT_OF_SORTMEMORY` for large native JSON entries under the normal MySQL sort buffer. Reads now stream the ordered index range without sorting payloads; pagination/revision checks and complete message content are unchanged. The regression pages 339 entries including a message larger than the normal sort buffer, verifies exact content/order and checks that query plans have no filesort.

### React Harness integration after directory refactor

React Harness implementation, tools, instructions and residency live in `backend/src/core/react-harness`. Agent invokes public contracts and supplies the actual AgentTurnData/AgentMessageData. The runtime only coordinates model calls, validation/tool sequencing and lifecycle. Preparation and ordinary runs share data-model operations against separate context models. [React Harness implementation context](../../../../react-harness/_ctx/internal/legacy/implementation-notes.md) describes its owned capabilities/state and relocated assets.

Direct-data refactor verification: 259 backend tests, 98 disposable-MySQL integration tests, both production builds and compiled prompt loading passed. Public Agent data exports are aggregated at data/index.ts. Generic component-state persistence keeps existing physical SQL schema/keys and related commits remain atomic; no data reset is required.
