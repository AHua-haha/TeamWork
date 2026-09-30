<!-- Task proposal; current contract is under docs/systems/ -->

# Agent runtime system

## Purpose and boundary

The agent runtime is written in TypeScript. It runs agents and provides the frontend-facing run protocol. It owns one agent-loop implementation for all agents: choosing the model and available tools, constructing every model request, calling the model, executing tools, and managing the agent's stored context history. The frontend submits input and observes runs; it does not drive the loop.

The runtime uses Pi AI (`@earendil-works/pi-ai`) for its unified `Message` and `Tool` formats, model-provider connections, and model-call API. It uses these Pi capabilities directly; Pi Agent Core does not run the loop.

## Inputs and preconditions

- A caller identifies an agent and submits user input to start or continue its work.
- The runtime reads that agent's canonical stored context history. Each context entry wraps a Pi AI `Message` with runtime-owned metadata.
- A frontend may open a long-lived follow request when it opens or refreshes an agent view, reconnects, or sends input. It may provide its last completed-message position for incremental synchronization.
- Input submission supplies the new user input and routing identifiers. The runtime obtains the model-context history from its own storage rather than requiring the frontend to submit that history.
- Multiple frontends may follow an agent. Their connection state does not determine whether the agent run continues or when temporary chunks are removed.

## Outputs and observable effects

### Agent execution

- For every model call, the runtime constructs a Pi AI `Context` from the current stored context history, runtime decisions, and available Pi AI `Tool` definitions. It controls the timing and contents of each call through Pi AI's model API.
- The runtime handles model output, invokes chosen tools itself, records tool outcomes, updates the stored context history, and decides whether the shared loop continues or stops.
- A context update, including compaction, changes later model requests. It does not change the completed message history presented to the frontend.
- When a frontend-facing message completes, the runtime persists its whole stable record before announcing that completion to followers.

### Frontend follow protocol

- Completed-message payloads use Pi AI's message format, and live payloads use Pi's event format. Backend envelopes add runtime metadata, identities, ordering information, and synchronization or run-lifecycle signals. Conversion into a UI library's presentation format belongs to the frontend.
- Each follow connection is scoped to one run. It sends the final available updates and ends when that run finishes. If there is no active run, it synchronizes completed history and ends. Following a subsequent run opens another connection; a Pi model-call completion event does not itself finish the agent run.
- Each follow connection has a **sync phase** followed by a **live phase**. In the sync phase, the runtime sends completed frontend messages as whole records, after the caller's completed-message position or from the beginning when none is supplied. It then marks sync complete and sends live chunks as they become available.
- A message has the same `messageId` in live chunks and in its completed record. Chunks have ordered positions within that message. A completed-message record carries a stable history position.
- A message that completes during the sync-to-live handoff appears in the completed sync or the subsequent live output. Duplicate delivery, if any, is identifiable by `messageId` and stable history position.
- The runtime retains only a bounded range of live chunks, under its own retention policy. It may prune chunks while a frontend is following or disconnected. It reports a missing range explicitly rather than presenting a truncated range as the complete stream.
- If the buffer still contains an active message from its first chunk, a new follower may receive those retained chunks before following new ones. If the initial chunks are missing, the follower is told of the gap and later receives the complete message when it is committed.
- The runtime sends the whole committed message to connected followers. A reconnecting frontend can also obtain it through the sync phase even if it missed the completion notification.
- The frontend discards an incomplete local draft on reconnect or on a reported chunk gap. It replaces that draft with the completed message when available. If the message is still active, it waits; a temporary absence of that message is allowed.
- The frontend can request current runtime state separately from completed history. Current state describes what is true now rather than what happened in the timeline.

### HTTP operations

| Operation | Request | Response |
| --- | --- | --- |
| Create an agent | `POST /agents`, JSON `{agentId?}` | 201, current state with an empty history/context |
| Submit input | `POST /agents/:agentId/runs`, JSON `{input}` | 202, `{runId, run, followUrl}` after input is persisted |
| Follow | `GET /agents/:agentId/follow?runId=...&after=...` | SSE stream of sync/history/live/run events |
| Current state | `GET /agents/:agentId/state` | 200, `{agentId, contextRevision, historyPosition, run}` |
| Cancel | `POST /agents/:agentId/runs/:runId/cancel` | 202, cancellation requested; final status arrives through follow/state |

`input` is Pi user content: text or an array of text/image blocks. The server supplies the message role, timestamp, identity and metadata. Unknown submission fields, including context/history, are rejected. JSON requests have a 2 MiB limit. Agent/run/message IDs use 1–64 ASCII letters, digits, underscores or hyphens. The HTTP server binds to loopback by default and has no built-in user authentication or tenant authorization.

Follow omits `runId` to select the latest run when it starts. With no run, it synchronizes history and ends. The selected run never changes during a connection. `after` is the last completed-message position applied by the client; omitted or 0 starts from the beginning. It is not a live-chunk cursor. A cursor ahead of the selected run is rejected with 409. A client reconnects by discarding partials and using its completed-history cursor. SSE comment heartbeats keep idle connections open; they do not poll the database or extend a completed run.

Every SSE data event contains `{version: 1, type, agentId, runId}`. The SSE `event` field equals `type`. Event-specific fields are:

| Type | Additional fields | Meaning |
| --- | --- | --- |
| `message` | `record: {agentId, runId, messageId, position, message, metadata}` | Whole committed Pi message; may be history synchronization or a newly completed message |
| `sync` | `historyPosition, run` | Initial completed history has been delivered; subsequent output follows the run |
| `chunk` | `messageId, sequence, event` | Unmodified Pi `AssistantMessageEvent` payload, with per-message sequence starting at 0 |
| `gap` | `messageId, expectedSequence, firstAvailable` | Requested chunk range is missing; discard this partial and wait for its completed record |
| `state` | `run` | Current run-state snapshot, separate from the message timeline |
| `end` | `historyPosition, run` | All completed records through this run's terminal position were delivered; connection closes |

The `run` field is null before any run exists, otherwise it contains `agentId`, `runId`, `status`, `phase`, `step`, `startedAt`, `endedAt`, `endPosition`, `activeMessageId`, and `error`. Status is `running`, `completed`, `failed`, `cancelled`, or `interrupted`. Phase is `model`, `tools`, or `finished`. Step counts model calls from 1 (0 before the first call). Error is null or `{code, message}`; absent active-message/end fields are null. Timestamps are epoch milliseconds. Terminal `endPosition` is the last completed position belonging to the selected run's timeline prefix.

Before streaming begins, failures return JSON `{error: {code, message}}` with 400/413/415 for invalid input, 404 for missing identity, 409 for conflicts, or 503 for unavailable backend operations (corrupt stored data is 500). A failure after SSE opens sends `stream_error` with `version`, `type`, `code`, and `message`, then closes without claiming a normal end. An unexpected EOF is also a disconnect, not proof of run success.

### Runtime customization and defaults

The in-process TypeScript API exposes a single runtime loop with a policy. `beforeStep` can read/replace stored context with revision checking. The loop then rereads canonical context and passes it to `buildRequest`, which chooses the Pi model, messages, system instructions, declared tools and call options for this particular call. Runtime-defined tool handlers and an optional `executeTool` hook perform execution. `shouldContinue` decides whether to make another model call. `messageMetadata` supplies metadata for persisted model/tool messages. The model-stream function is injectable; the standard implementation delegates to Pi's provider collection. A per-run abort signal reaches these operations.

Defaults are one active run per agent, sequential tools, continuation when a response contains tool calls, and a limit of 32 model calls. These limits and the policy are configurable. Model responses without tool calls stop the run; a response truncated by token length is persisted with Pi's `length` reason. Deferred provider jobs are not supported. Tool arguments are validated against the tool declarations in the constructed request before runtime execution.

The default buffer retains up to 256 events and 8 MiB of serialized event data for the active model response. Completion clears its chunks transactionally. A slow follower may receive a gap or go directly from partial output to a full committed record. After a gap, that connection suppresses the incomplete tail of that message. No follower acknowledgement or independent replay log is required.

## Failure behavior

- A model, tool, or persistence failure is observable as a run failure or interrupted state; the runtime does not announce a completed message before its stable record is stored.
- A follow connection may disconnect without stopping the run. The frontend reconnects through the same sync-then-live operation.
- When chunks have been pruned, the runtime reports a gap. It does not hold the buffer for a slow follower or wait for follower acknowledgements.
- If the complete message has not yet been committed when a gap occurs, the frontend waits for completion rather than showing an incomplete tail as a whole message.
- Model errors, invalid tool calls, tool failures and step-limit exhaustion fail the run. A tool failure is persisted as an error tool-result message when storage is available. Completed records already committed are preserved. Uncommitted model partials are discarded on failure/cancellation; a committed tool-call record may remain without a result if execution was cancelled.
- Cancellation aborts ongoing model/tool operations and eventually marks the run cancelled. Custom tools/hooks must honor the abort signal; external effects already performed cannot be rolled back. Losing a frontend connection never requests cancellation.
- Submission is not idempotent: the caller must not blindly retry an input whose acceptance is uncertain. Concurrent input for an active agent returns 409. No automatic application retries or durable run resumption are provided.
- If terminal state cannot be persisted, state/follow operations report the run unavailable rather than claiming completion. After storage recovery, restart marks abandoned runs interrupted. Startup fails if another runtime owns the database; ownership loss stops accepting work and aborts local jobs.

## Guarantees and limits

- One TypeScript backend-owned loop implementation serves all agents; Pi Agent Core's model–tool loop is outside this design.
- The stored context history, not a temporary selected view of an unchanged history, is the source for each model request.
- Completed frontend history is stable and separate from mutable model context. Temporary chunks do not become historical messages.
- Completed-message synchronization is gap-free across the transition to live following. Live chunks are best effort within the bounded buffer and are not guaranteed to replay after eviction.
- Following uses a stream for one run, with no periodic polling requirement or connection spanning multiple runs.
- The backend runs as one process per database. Multiple agents and multiple frontend followers are supported within that process. Context edits affect requests constructed after the edit; an already-constructed provider request is not retroactively changed.
- Deployment access control, distributed workers, automatic compaction policy, metadata semantics, history pagination, resumable provider jobs and frontend implementation are outside this backend version.

## Acceptance examples

1. A frontend opens a follow connection with no history position. It receives completed messages as whole records, a sync-complete marker, and then new live chunks.
2. A frontend reconnects after missing a completion. Its partial draft is discarded, and the sync phase returns the completed message with the same `messageId`.
3. A follower falls behind and chunks for active message `m1` are pruned. It receives a gap signal, removes its partial `m1`, and waits until the complete `m1` is available.
4. A message completes during initial synchronization. It is delivered through the sync or live phase and is displayed once by identity.
5. The runtime compacts the agent's stored model context. Its next model request uses the changed context; completed frontend messages remain unchanged.
