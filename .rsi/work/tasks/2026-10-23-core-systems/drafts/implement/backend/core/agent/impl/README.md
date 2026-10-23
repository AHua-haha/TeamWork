<!-- Task implementation; promote with verified source. -->
# Agent implementation context

## Result summary

AgentExecution runs one agent activation entirely in memory. It owns mutable context/run state, produced message values, model/tool control and compact progress. It has no Team, database, SQL, durable codec or storage dependency. Provider model metadata/adapters and public execution contracts are here.

Design: [Agent](../../../../../design/backend/core/agent/design.md).

### Coordination and ownership

The loop validates requests/streams and executes declared tools sequentially. It emits public values through an optional AgentObserver and awaits acknowledgements before dependent work. Team can persist them; another caller can omit the observer. snapshot returns detached values. restoreContext loads a caller-supplied snapshot. Progress remains an in-memory bounded FIFO. Tool failures remain recoverable results; cancellation waits for tracked effects and afterRun before terminal notification.

### Implemented contract

**Input:** new AgentExecution(run: RunState, context: ContextHistory, historyPosition: number, config: AgentConfiguration, policy: RuntimePolicy, stream: ModelStream, observer?: AgentObserver, progress?: ProgressStore, maxSteps = 64); run(signal: AbortSignal).

**Output:** run returns acknowledged terminal RunState; snapshot returns detached {run,context,historyPosition}. Optional observer callbacks: messageStart(state, historyPosition) returns an acknowledged history boundary; message(record) returns an optional acknowledged CompletedMessage; contextChanged(revision,entries) returns an optional context snapshot; finished(state) returns an optional terminal state. assertActive is optional caller liveness validation.

**Effect and failure:** No durable effect is required. Tools may change files/network. The caller observer may persist; its message failure fails the run, and terminal acknowledgement failure rejects run. A callback failure causes no automatic replay. Instances run once. Context revisions detect stale replacements. Partial failed model output is discarded.

**Usage example:** const agent = new AgentExecution(run, context, historyPosition, config, configuredPolicy(), piModelStream(models)); const terminal = await agent.run(signal); const result = agent.snapshot(); Supply an AgentObserver only when the caller needs acknowledged effects such as persistence.

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
