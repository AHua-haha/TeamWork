---
summary: Runs model and tool loops, retains private message context and history, and provides durable recovery, compaction and inspection.
include:
  - backend/src/core/agent/
  - backend/prompts/agent/context-compaction.md
  - backend/src/core/context-page.ts
  - backend/test/agent-execution.test.ts
  - backend/test/conversation-context.test.ts
  - backend/test/compaction.test.ts
  - backend/test/agent-message-data.test.ts
  - backend/test/resident-context.test.ts
---

# Agent usage contract

Agent owns one agent's model/tool execution, retained private context, shared-message incorporation state, immutable completed execution history, progress and compaction. `AgentExecution` can run entirely in memory. `AgentRuntime` hosts durable executions through `AgentData`. Team supplies shared content, serial admission and publication policy; React Harness supplies purpose-owned tools, instructions and context projections. Agent does not select recipients or own Team's shared history.

## Execution inputs and outputs

`AgentConfiguration` contains a Pi `model`, optional `Models` instance, executable `tools`, `systemPrompt`, stream `options`, and optional `{thresholdTokens, prompt}` compaction settings. `RunConfigSource.resolveForRun(agentId)` returns this configuration plus source revisions. Configuration resolution belongs to the supplied source; the execution loop has no concrete Team or Workspace dependency.

`RuntimePolicy.buildRequest(scope, history)` creates a `ModelRequest`: model, native Pi context, executable tool definitions and options. Optional hooks supply a group-context read reference, acquire/release execution, run pre-step work, execute tools, choose continuation, attach metadata and finalize. `scope` identifies agent/run/step, signal and work/compaction mode, and exposes detached context reads, revision-checked replacement and private generated input. `fixedPolicy()` builds requests for a fixed model/tools; `configuredPolicy()` uses the resolved configuration.

`ModelStream(request, signal)` yields native Pi assistant events. A completed response is recorded before its tools or continuation policy run. Stream events must have a valid start and matching terminal reason; missing completion or model errors fail execution. `piModelStream(models)` uses Pi with automatic retries disabled and `deferred: false`; explicit request options can override the initial `maxRetries: 0` default.

`new AgentExecution(run, context, historyPosition, config, policy, stream, observer?, progress?, maxSteps?, harnesses?)` accepts a validated `RunState`, `ContextHistory` or resident `AgentContextState`, and immutable-history position. `run(signal)` is single-use and returns terminal `RunState`; terminal persistence failure rejects instead of claiming acknowledgement. `snapshot()` detaches state for the caller. The default model-call limit is 64; ordinary execution and each preparation loop have separate limits. Without `shouldContinue`, tool calls continue execution and a response without calls finishes; Team adds stricter final-publication rules.

An optional `AgentObserver` acknowledges message insertion, component/message effects, context patches/replacement, preparation lifecycle/metadata and terminal state. Hosts that supply persistence must implement the corresponding atomic operations, including related state; otherwise these paths reject with `invalid_config`. In-memory use requires no SQL. `AgentMessageData` publishes accepted messages and metadata to its model after persistence acknowledgement. `AgentTurnData` records one paired result per tool-call identity and buffers private instructions until every call has a result.

## Durable hosting and lifecycle

`new AgentRuntime(agentData, runConfigSource, policy, stream, options?)` supports `maxSteps`, progress capacity and a runtime-wide compaction override. `open()` acquires exclusive database runtime ownership, recovers preparing compactions, marks abandoned runs interrupted and clears resident Harness state before accepting work. Runtime ownership is a MySQL named lock tied to a dedicated connection; lease loss aborts active jobs and makes execution unavailable. `close()` refuses new work, drains accepted starts/context updates, cancels and waits for jobs, releases Harness residency and the lease.

`start(agentId, userContent)` validates nonempty native user text/content, resolves configuration, atomically records input/admission and launches the run. It returns the admitted state before completion. `prepareRun(agentId)` resolves without starting; `launch(run, resolved)` executes an already durable admission, as used by Team. Duplicate live run IDs are refused. The policy execution gate is acquired before resident context/Harness initialization, so initialization cannot reorder member execution.

`finished(agentId, runId)` waits for a locally hosted run and returns its stored terminal state; for a nonlocal run it reads current stored state. `cancel()` requests cancellation; it does not promise that external effects already stopped. Finalization waits for tracked policy/tool promises to settle. Recorded completed messages survive cancellation/failure. If a stored running run has no live worker, cancellation reports `runtime_unavailable` and restart recovery is required.

`getState()` returns context revision, history position and latest/current run. `feedback()` appends private runtime-generated publication feedback to a live run. `replaceContext(agentId, expectedRevision, entries)` explicitly replaces retained context and updates a live execution after acknowledgement; it is an internal capability, not a public context-edit HTTP endpoint. `finalText()` selects the last ordinary assistant text for a run, skipping compaction records; it is distinct from Team's accepted-final selection and may include ordinary text that was not published.

## Continuous context and shared incorporation

Retained entries are `{messageId, message, metadata}` with complete native Pi messages. Stable completed records add `{agentId, runId, position}`. Retained-context positions/revisions differ from immutable-history positions. Hidden entries can still exist in retained storage; Harness projections operate on detached model-request copies.

Team supplies `GroupContextReference {id, read(after, through?)}` with ordered, detached entries and authoritative sender information. `AgentMessageContext` finds its incorporated group position in retained provenance and requests only newer messages. Incorporation preserves native user/assistant roles, images, sender envelopes and chronological interleaving with private work. For its own accepted response, Agent adds attribution/provenance to the original private assistant entry without adding a second answer body or changing signed thinking/text blocks. Rejected publication has no shared provenance.

Group reads occur before ordinary work and after current work, never between an in-flight call and its result. `syncGroupContext(agentId)` serializes idle delivery without a model call; busy runs catch up themselves. Idle synchronization failures are recorded and make `getState()` fail with `persistence_failure` until successful synchronization or restoration. A message read alone does not advance durable incorporation.

React Harness user-input reactions run after incorporation, at the safe boundary before ordinary model work, and during idle delivery. Agent indexes pending real-user messages and marks handled inputs after reactions. Private generated messages, shared summaries, member reports and publication feedback do not recursively trigger user-input reactions. A cumulative completed-message append count survives replacement/compaction and restart; refresh-generated context can explicitly exclude itself. File React Harness owns its dependency discovery, 64-message trigger and replacement content. At each real user-input reaction, it also inserts a generated instruction when no current visible generated-instruction entry exists; initialization, restart and idle synchronization alone do not insert one.

## Persistence and recovery guarantees

`AgentData` owns schema/migrations, ordered `agent_context_entries`, immutable `messages`, runs, compaction journals and generic component state. `residentContext()` coalesces initial reads and reuses the owned model. Normal append inserts new rows and advances bookkeeping; patches update only specified entries/metadata. Full replacement is explicit or compaction-related. Context reads follow the `(agent_id, position)` primary-key order, avoiding JSON-body sorting. Startup migration converts legacy whole-context storage and retains message identities and content.

`commitMessage`, `patchContext`, `commitComponentMessage` and `commitComponentContext` expose acknowledged owner operations. The component variants pair message/context changes with expected-revision state updates atomically. Context metadata changes do not rewrite stable history. `inTransaction(connection)` lets Core compose narrow owner operations on an existing transaction; resident context cannot be loaded from an uncommitted transaction. `executionState`, admission/completion, completed-message lookup and reset operations support Team coordination without giving Team Agent SQL knowledge.

Resident advancement is registered after the outer commit. Rollback does not publish speculative state. An uncertain acknowledgement invalidates the resident; callers restore the durable outcome rather than replay a tool or repeat a filesystem effect. Context/component revision mismatch raises `context_conflict`. Durable runtime finalization failures remain visible through state/follow/completion APIs, including a preparation failure after an ordinary final was already accepted.

Restart does not replay model/tool effects. During incorporation/restoration, an assistant call without a recorded result receives a context-only error explaining that the operation may have had effects and was not replayed. This protocol repair leaves immutable history unchanged. Uncommitted stream chunks are not recoverable durable messages. Explicit conversation reset clears retained context, consumption/provenance, history/run/compaction/component data together; ordinary finalization does not reset it.

## Compaction

Compaction requires a positive safe-integer token threshold and nonempty maintained prompt. Agent estimates the complete normalized model request with Pi's public estimator, including system instructions, tool declarations, images and effective Harness projections. The same strict `estimate > threshold` check occurs before each ordinary model call after previous tools settle, and after work finishes and buffered shared input is incorporated.

Preparation is private to the owning activation. It keeps the old context available, adds a control prompt, runs normal tools/model calls in `compaction` mode and journals every completed preparation message. It bypasses ordinary continuation/publication hooks. The maintained prompt permits inspection and preservation only: no unfinished implementation, fixes, commits, background work or delegation. This restriction is an instruction contract; normal tool capability remains available. A naturally completed nonempty final ends preparation; length-limited, empty or interrupted output cannot authorize cutover.

Successful cutover atomically replaces retained context with shared context through the Agent's already incorporated boundary, followed by all preparation messages after the control prompt. Team can supply summary/tail or archived originals for that boundary. The old private prefix and control prompt drop out of model context; retained assistant usage is invalidated there. Immutable original records/signatures remain. React Harnesses prepare isolated component-state candidates from their committed state; the File Harness carries forward its accumulated dependency discoveries and reconciles file references against the replacement context. Context, metadata and component-state candidates commit together, then become live in memory. Before-call preparation resumes the same ordinary loop; finishing preparation leaves it idle. It does not recursively compact or immediately retry the same checkpoint.

Failed preparation discards the candidate context, metadata and React Harness state; the previously committed context and accumulated dependency discoveries remain unchanged. Preparation messages and external tool effects are retained in immutable execution history for inspection, but are not replayed or incorporated into retained context. Pre-call failure fails ordinary execution; an acknowledged finishing-preparation failure can preserve the prior ordinary outcome. An uncertain begin/message/cutover acknowledgement raises `compaction_persistence_failure` and permits no competing fallback replacement. Startup recovers outstanding journals by discarding their candidates without replaying external effects. After a successful cutover, the next real user-input reaction can create the missing generated instruction; compaction itself never inserts it. Shared history alone can still exceed a provider limit; compaction guarantees no unlimited-context remedy.

## Inspection and progress

`inspectContext(agentId, {offset?, limit?, revision?})` is a detached, read-only durable page: `{revision, offset, total, nextOffset, entries}`. Default limit is 50, allowed range 1–100. Later pages require the original revision; changed context returns `context_changed`, an out-of-range offset fails, and incomplete migration returns `runtime_unavailable`. Inspection works without the runtime lease and performs no synchronization, protocol repair, model/tool work or compaction. It exposes retained native entries and metadata, including projection visibility metadata; it does not synthesize system prompts/tool schemas or unfinished chunks.

`follow(agentId, {runId?, after?, signal?})` combines completed history with a bounded in-memory progress lane. Version-2 events include `message`, `sync`, `state`, `chunk`, `gap` and `end`. History position advances only with complete durable messages; chunk sequences start at zero per active message. If the consumer falls behind the FIFO, a `gap` identifies missing progress; the later completed native record is authoritative. Disconnecting a follower cancels observation, not execution. Runtime closure/lease loss ends availability.

## Examples

```ts
// Host composition supplies initialized owner data, model configuration and stream.
const runtime = new AgentRuntime(agentData, runConfigSource, policy, stream);
await runtime.open();
const admitted = await runtime.start(agentId, 'Inspect the current contract.');
const terminal = await runtime.finished(agentId, admitted.runId);

// Read-only pagination can also be used without opening runtime execution.
const first = await runtime.inspectContext(agentId, {limit: 50});
if (first.nextOffset !== null) {
  await runtime.inspectContext(agentId, {
    offset: first.nextOffset, revision: first.revision, limit: 50,
  });
}
await runtime.close();
```

For an in-memory caller, create `AgentExecution` with the native model/configuration, a fresh running `RunState`, `{revision: 0, entries: []}`, history position `0`, `fixedPolicy(model, tools)`, and a Pi-compatible stream; omit observer persistence and call `run(signal)`. The included `agent-execution.test.ts` provides complete executable fixtures. Included paths supplement this contract; their source is not automatically expanded.
