# Agent implementation context

## Result summary

Agent owns both its core in-memory model and its durable data model. AgentExecution is the reusable model/tool mechanism; AgentRuntime supplies Agent-owned durable hosting, progress/follow and recovery. Neither imports concrete Team/Harness/Workspace models or repositories.

Design: [Agent](../../../../../design/backend/core/agent/design.md).

### Model and persistence contract

**Input:** data/model.ts defines ContextEntry, ContextHistory, CompletedMessage, RunState, CurrentState and FollowSnapshot/FollowEvent; data/validation.ts validates them. AgentState(run,context,historyPosition) owns mutable execution values, receive/acknowledged replacement and detached snapshots. AgentData(storage,hooks?,connection?) owns SQL. AgentRuntime(data,configSource,policy,stream,options?) accepts the existing model/policy/compaction inputs.

**Output:** getContext/replaceContext, getState/followSnapshot, runMessages/completedMessage, createAgent/startRun/beginMessage/commitMessage/finishRun, compaction lifecycle and recovery. AgentExecution.run returns acknowledged terminal state; snapshot returns detached {run,context,historyPosition}. AgentConfiguration, ResolvedRunConfig and RunConfigSource are Agent public request inputs. Team supplies the latter without transferring ownership of its provider/member settings.

**Effect and failure:** AgentData owns agents, runs, messages and context_compactions schemas, versioned codecs, validation, queries and migrations. Context CAS atomically stores content and incorporation markers. Whole messages are immutable and persist before announcement; progress remains a bounded in-memory FIFO. AgentRuntime restores context after acquiring execution authority and acknowledges AgentExecution through AgentData directly. Success/failure retains recorded context; explicit reset is the destructive exception. Runtime lease/recovery belongs to Agent. Missing interrupted results receive uncertainty diagnostics without replay. No Team table is required to run or restore a standalone AgentData/AgentRuntime.

**Usage example:** const data = new AgentData(storage); await data.migrate(); const runtime = new AgentRuntime(data,source,policy,stream); await runtime.open(); const {agentId}=await data.createAgent(); const run=await runtime.start(agentId,'request'); await runtime.finished(agentId,run.runId). Close the runtime before the owning storage. CoreData supplies optional foreign profile/presentation callbacks when composing the full application.

### Cross-owner transactions

inTransaction(connection) binds operations to an existing transaction without owning commit/rollback. executionState(id,lock?) returns only {id,historyPosition,activeRunId}, avoiding private-context reads for Team admission. readRun/readRuns/activeRuns/listRuns and completedMessage return owner-validated values, not SQL rows. createRecord/admitRun/completePublishedRun let Team coordinate member creation/publication; completePublishedRun verifies active identity and finished private output, while Team writes its own final reference. Normal finishRun calls the parent-supplied presentation hook on the same transaction. resetConversations, clearHistory and deleteRecords are used by coordinated resets after foreign references are removed.

### Continuous context and compaction

AgentMessageContext owns group incorporation. RuntimePolicy.groupContext provides only {id,read(after)}; markers groupContextId/groupPosition/groupMessageId live on entries. Shared messages enter before work or after work settles, never midway through a tool exchange. Own accepted finals gain separate sender/provenance text without changing original signed blocks or duplicating their answer. Team owns shared content; Agent chooses the incorporation/compaction boundary.

AgentConfiguration.compaction?: {thresholdTokens,prompt} uses Pi estimateContextTokens(normalizeContext(request.context)). One positive safe-integer threshold (managed default 64000) applies before ordinary calls and after work. Preparation reuses ordinary tools with mode=compaction, bypasses publication and live ordinary-response chunks, and has its own default 64-call budget. Retain every new assistant/tool message after the control prompt, discard the prompt/old private prefix only after acknowledged completion, then prepend original incorporated group messages. Invalidate old provider usage on context copies; immutable records keep their original usage. The instruction requests Next steps for unfinished work. Preparation never creates another ordinary run or mention and does not recursively retry at one checkpoint.

AgentData beginCompaction/commitCompactionMessage/finishCompaction journals tentative records under the owning run without changing current context. CAS context replacement and terminal journal state commit together. Failed preparation retains old context plus recorded effects; finishing failure preserves the ordinary outcome. Uncertain lifecycle/message/cutover acknowledgement surfaces as persistence_failure even after publication and leaves recovery to restart, never a competing replacement. Startup recovers preparing journals before interrupted runs, including already published ordinary responses, without replay. Public final references/end ranges remain pinned. Group summarization remains deferred.

adoptLegacyContext and finishLegacyMigration keep the existing once-only context_format transition; Core supplies original Team references. Agent owns the adoption algorithm and its SQL, and retires old retention/transient tables without deleting stable history. legacyContextIds avoids loading/locking already migrated contexts.

## File lookup

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
