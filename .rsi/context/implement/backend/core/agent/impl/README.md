# Agent implementation context

## Result summary

AgentExecution owns one activation's in-memory model/tool loop. AgentMessageContext owns continuous context incorporation across activations, using Team's read reference and Agent-owned state. No database, durable codec or concrete Team dependency exists.

Design: [Agent](../../../../../design/backend/core/agent/design.md).

### Coordination and ownership

Team restores the public context snapshot after acquiring execution authority. Agent obtains policy.groupContext(agentId), synchronizes before its first model request, runs without mid-loop shared insertion, then synchronizes after work settles. Incorporation markers live on entries so context and consumption acknowledge together. Completed private messages remain in subsequent context after either success or failure. The optional observer persists public values before dependent work/completion.

### Implemented contract

**Input:** AgentExecution(run, context, historyPosition, config, policy, stream, observer?, progress?, maxSteps=64). RuntimePolicy.groupContext?(agentId) returns GroupContextReference {id, read(after)}. A read returns ordered GroupContextMessage values {position, entry, sender, origin?}; origin identifies an accepted final's agent/message. AgentMessageContext(agentId, history).incoming(reference?) proposes updated entries or undefined.

**Output:** run(signal) returns acknowledged terminal RunState. snapshot() returns detached {run,context,historyPosition}. Public observer callbacks and replaceContext/restoreContext remain available. Group consumption is encoded in metadata.groupContextId/groupPosition/groupMessageId on incorporated entries, not an extra Team-selected admission bound.

**Effect and failure:** Without an observer all effects are in memory apart from supplied tools. Context incorporation/reconciliation awaits contextChanged acknowledgement; refusal leaves prior context unchanged. Own accepted finals receive provenance and a separate sender text block while their original signed blocks remain intact, avoiding a duplicated body. Interrupted calls receive context-only missing-result errors without rewriting history or replaying tools. There is no compaction/automatic trimming policy.

**Usage example:** Supply policy.groupContext = async () => ({id: workspaceId, read: after => source.read(after)}); pass the retained/restored snapshot into the next AgentExecution. Let an observer acknowledge contextChanged(revision, entries) atomically. For idle synchronization use AgentMessageContext(...).incoming(reference) and acknowledge the candidate through the same snapshot persistence port.

### Legacy adoption

adoptRecordedContext(agentId, groupId, existing, recorded, groups) provides the one-time in-memory transition from old per-run retention. It merges original shared inputs and recorded private work in timeline order, keeps call/result exchanges together, reconciles own final origins and repairs interrupted exchanges. It does not call models/tools or mutate its inputs. Group/private stable history remains unchanged. Existing document injection entries are excluded; project files are untouched.

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
