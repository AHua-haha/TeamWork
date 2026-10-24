> Proposed for task 2026-10-24-agent-compaction; delivered with its source.

# Agent implementation context

## Result summary

AgentExecution owns one activation's in-memory model/tool loop. AgentMessageContext owns continuous context incorporation across activations, using Team's read reference and Agent-owned state. No database, durable codec or concrete Team dependency exists.

Design: [Agent](../../../../../design/backend/core/agent/design.md).

### Coordination and ownership

Team restores the public context snapshot after acquiring execution authority. Agent obtains policy.groupContext(agentId), synchronizes before its first model request, runs without mid-loop shared insertion, then synchronizes after work settles. Incorporation markers live on entries so context and consumption acknowledge together. Completed private messages remain in subsequent context after either success or failure. The optional observer persists public values before dependent work/completion.

### Implemented contract

**Input:** AgentExecution(run, context, historyPosition, config, policy, stream, observer?, progress?, maxSteps=64). RuntimePolicy.groupContext?(agentId) returns GroupContextReference {id, read(after)}. A read returns ordered GroupContextMessage values {position, entry, sender, origin?}; origin identifies an accepted final's agent/message. AgentMessageContext(agentId, history).incoming(reference?) proposes updated entries or undefined.

**Output:** run(signal) returns acknowledged terminal RunState. snapshot() returns detached {run,context,historyPosition}. Public observer callbacks and replaceContext/restoreContext remain available. Group consumption is encoded in metadata.groupContextId/groupPosition/groupMessageId on incorporated entries, not an extra Team-selected admission bound.

**Effect and failure:** Without an observer all effects are in memory apart from supplied tools. Context incorporation/reconciliation awaits contextChanged acknowledgement; refusal leaves prior context unchanged. Own accepted finals receive provenance and a separate sender text block while their original signed blocks remain intact, avoiding a duplicated body. Interrupted calls receive context-only missing-result errors without rewriting history or replaying tools. Compaction is optional for in-memory callers and configured by the managed host as documented below.

**Usage example:** Supply policy.groupContext = async () => ({id: workspaceId, read: after => source.read(after)}); pass the retained/restored snapshot into the next AgentExecution. Let an observer acknowledge contextChanged(revision, entries) atomically. For idle synchronization use AgentMessageContext(...).incoming(reference) and acknowledge the candidate through the same snapshot persistence port.

### Legacy adoption

adoptRecordedContext(agentId, groupId, existing, recorded, groups) provides the one-time in-memory transition from old per-run retention. It merges original shared inputs and recorded private work in timeline order, keeps call/result exchanges together, reconciles own final origins and repairs interrupted exchanges. It does not call models/tools or mutate its inputs. Group/private stable history remains unchanged. Existing document injection entries are excluded; project files are untouched.

### Compaction contract

**Input:** AgentConfiguration.compaction?: {thresholdTokens: number, prompt: string}. Validate a positive safe integer and nonempty instruction. estimateRequestTokens(request) calls Pi 0.87.1 estimateContextTokens(normalizeContext(request.context)). Reported assistant usage plus trailing estimates is preferred; Pi’s character/image estimates apply when usage is unavailable. No independent estimator is maintained.

**Output/effect:** At each ordinary before-call checkpoint and after ordinary work/shared synchronization, an estimate strictly above threshold starts private preparation. Both use the same threshold. Preparation reuses the model/tool turn engine with StepScope.mode = compaction and its own maxSteps budget (default 64); it bypasses ordinary beforeStep/shouldContinue publication and progress chunks. Its prompt and completed messages enter the optional compaction journal. All messages after the prompt, including tool results and private inputs, are retained. A natural nonempty final ends preparation; truncation, empty output and interruption do not authorize replacement.

compactedContext(agentId,before,retained,groupReference?) selects original shared messages through Agent-owned incorporation markers, then appends retained messages. New arrivals are caught up after preparation, never inserted into a pending exchange. Context copies invalidate assistant usage/cost because it measured the discarded prefix; stable records and signed content blocks remain unchanged. Before-call success rebuilds the request and resumes the same ordinary loop; finishing success remains idle. There is one attempt per checkpoint, no recursive preparation even if group history remains large.

Optional observer.compactionStarted(state), compactionMessage(record), compactionFinished(state,revision,entries) acknowledge lifecycle, completed records and context cutover. CompactionState has id/agentId/runId, trigger before-model|after-run, status preparing|completed|failed, startedAt/endedAt and error. Preparation leaves current context untouched until cutover acknowledgement. Failure preserves old context plus recorded preparation and explicit uncertainty via interruptedCompactionContext; missing tool results get context-only repair. A pre-call failure ends ordinary work; an acknowledged finishing failure preserves its outcome. No automatic tool replay. A lifecycle/message/cutover acknowledgement failure throws compaction_persistence_failure even if the terminal observer returns an already completed ordinary result; Team exposes persistence_failure and recovers the journal on restart rather than attempting a competing replacement.

**Usage example:** pass compaction: {thresholdTokens: 64000, prompt: maintainedInstruction} in AgentConfiguration. Supply lifecycle observers for durability, or omit them for in-memory operation. snapshot().context is the acknowledged current model context; immutable preparation records belong to the caller’s separate history. No preparation starts on an already-aborted signal. Stop/shutdown abort active preparation.

## File lookup

- [backend/src/core/agent](../../../../../../../backend/src/core/agent): owned source.
- [reference/agent-runtime/design.md](reference/agent-runtime/design.md): detailed existing behavior and code map.
- [reference/agent-runtime/impl.md](reference/agent-runtime/impl.md): detailed existing behavior and code map.
- [reference/modelflare-inventory.md](reference/modelflare-inventory.md): detailed existing behavior and code map.
- [Backend tests](../../../../../../../backend/test): unit/HTTP, in-memory execution, boundary and disposable SQL integration checks.

## Automatic retrieval

```json
{"commands": []}
```
