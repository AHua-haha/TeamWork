# Agent runtime system

## Purpose and boundary

The agent runtime is written in TypeScript. It runs agents and provides the frontend-facing run protocol. It owns one agent-loop implementation for all agents: choosing the model and available tools, constructing every model request, calling the model, executing tools, and managing the agent's stored context history. The frontend submits input and observes runs; it does not drive the loop. For harness-equipped members, harnesses define capabilities, authority, context and operating rules; the runtime supplies execution mechanisms and assembles their environment.

The runtime uses Pi AI (`@earendil-works/pi-ai`) for its unified `Message` and `Tool` formats, model-provider connections, and model-call API. It uses these Pi capabilities directly; Pi Agent Core does not run the loop.

## Inputs and preconditions

- A caller identifies an agent and submits user input to start or continue its work.
- The runtime reads that agent's canonical stored context history. Each context entry wraps a Pi AI `Message` with runtime-owned metadata.
- A frontend may open a long-lived follow request when it opens or refreshes an agent view, reconnects, or sends input. It may provide its last completed-message position for incremental synchronization.
- Input submission supplies the new user input and routing identifiers. The runtime obtains the model-context history from its own storage rather than requiring the frontend to submit that history.
- Multiple frontends may follow an agent. Their connection state does not determine whether the agent run continues or when temporary chunks are removed.
- Before accepting input, the runtime resolves that agent's run snapshot from its config source: the [config system](../config/design.md) for an agent outside any team, or the member's settings for a [team](../workspace-agent/team/design.md) member, which the team supplies by the same rules. The agent must explicitly select a resolvable provider connection and model; selected tools, prompt templates, instructions, and call options must be valid.
- A team member retains private execution history. The team admits activations from its group chat and supplies already-persisted run records and resolved configuration snapshots for execution. The runtime enforces one active model/tool run per agent.

## Outputs and observable effects

### Agent execution

- For every model call, the runtime constructs a Pi AI `Context` from the current stored context history, runtime decisions, and available Pi AI `Tool` definitions. It controls the timing and contents of each call through Pi AI's model API.
- The runtime handles model output, invokes chosen tools itself, records tool outcomes, updates the stored context history, and decides whether the shared loop continues or stops.
- A context update, including compaction, changes later model requests. It does not change the completed message history presented to the frontend.
- When a frontend-facing message completes, the runtime persists its whole stable record before announcing that completion to followers.
- The runtime keeps one resolved config snapshot through the run. The standard policy uses its model, catalog tools, standing instructions and call options; a team policy replaces tools and adds current harness/team instructions for each member model call. Member file authority and command allowances are rechecked at tool execution. It resolves current config again for the next run. This does not freeze canonical message context, which the runtime may reread between calls.

### Harness lifecycle

Team members run file/command tools in their separate harness worktrees. Purpose and maintenance rule prompts are assembled into the system prompt. Tools are reusable; current harness authority and per-part commit policy determine their permitted effects. Implementation commits can be agent-authorized; design commits require user acceptance. The runtime does not interpret approval from conversation text or run completion.

The `afterRun` lifecycle callback executes after outstanding policy/tool effects settle, before terminal persistence. It receives agent/run identity and completed/failed/cancelled status; interrupted-run startup recovery invokes it before marking abandoned runs interrupted. Errors fail normal finalization or prevent startup recovery. The team checkpoints before final group publication because that publication durably completes its sender before recipient launch; finalization skips that already completed checkpoint. Failed/cancelled runs still checkpoint their pending file state.

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
| List agents | `GET /agents` | 200, summaries with names and config readiness for the agents outside teams; team members are listed by their team |
| Create an agent | `POST /agents`, JSON `{agentId?}` | 201, current state with empty history/context and incomplete config |
| Submit input | `POST /agents/:agentId/runs`, JSON `{input}` | 202, `{runId, run, followUrl}` after input is persisted; 409 `member_conversation` for every team member; use its workspace group chat |
| Follow | `GET /agents/:agentId/follow?runId=...&after=...` | SSE stream of sync/history/live/run events |
| Current state | `GET /agents/:agentId/state` | 200, `{agentId, contextRevision, historyPosition, run}` |
| Cancel | `POST /agents/:agentId/runs/:runId/cancel` | 202, cancellation requested; final status arrives through follow/state |

`input` is Pi user content: text or an array of text/image blocks. The server supplies the message role, timestamp, identity and metadata. Unknown submission fields, including context/history, are rejected. The app config sets the request size limit up to 2 MiB and can disable agent creation. Agent/run/message IDs use 1–64 ASCII letters, digits, underscores or hyphens. The HTTP server binds to loopback by default and has no built-in user authentication or tenant authorization.

Direct member input is refused, including input to the lead. The team owns shared chat publication and activation. State, follow and cancel still inspect private execution for every member. Group history/follow is separate and exposes only accepted final shared responses and activation state. A team member has no agent config; its `/agents/:agentId/config` requests report not found.

The config API exposes `GET`/`PUT /config/app`, `GET /config/capabilities`, `GET`/`POST /config/connections`, `GET`/`PUT`/`DELETE /config/connections/:id`, `GET /config/connections/:id/models`, `POST /config/connections/:id/models/refresh`, `GET`/`POST /config/catalog`, `GET`/`PUT`/`DELETE /config/catalog/:id`, and `GET`/`POST`/`PUT`/`DELETE /agents/:agentId/config`. Writes return record revisions and reject stale revisions. The config system defines the meaning of these editable records; deployment system config is not exposed here.

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

The standard policy builds each request from the run snapshot and the stored context. A caller may wrap it to replace tools and augment instructions for each model call, as the team does using member harnesses. An in-process caller may wait for a run to end and read its final state, and then read the run's last assistant text. A tool may start another agent's run and wait for it, and a cancellation of the tool's own run reaches the tool through its abort signal. Defaults are one active run per agent, sequential tools, continuation when a response contains tool calls, and a limit of 32 model calls. These limits and the policy are configurable. Under the standard policy, model responses without tool calls stop the run; a response truncated by token length is persisted with Pi's `length` reason. Deferred provider jobs are not supported. Tool arguments are validated against the tool declarations in the constructed request before runtime execution.

The default buffer retains up to 256 events and 8 MiB of serialized event data for the active model response. Completion clears its chunks transactionally. A slow follower may receive a gap or go directly from partial output to a full committed record. After a gap, that connection suppresses the incomplete tail of that message. No follower acknowledgement or independent replay log is required.

## Failure behavior

- A model, tool, or persistence failure is observable as a run failure or interrupted state; the runtime does not announce a completed message before its stable record is stored.
- A follow connection may disconnect without stopping the run. The frontend reconnects through the same sync-then-live operation.
- When chunks have been pruned, the runtime reports a gap. It does not hold the buffer for a slow follower or wait for follower acknowledgements.
- If the complete message has not yet been committed when a gap occurs, the frontend waits for completion rather than showing an incomplete tail as a whole message.
- Model errors, invalid tool calls, tool failures and step-limit exhaustion fail the run. A tool failure is persisted as an error tool-result message when storage is available. Completed records already committed are preserved. Uncommitted model partials are discarded on failure/cancellation; a committed tool-call record may remain without a result if execution was cancelled.
- Cancellation aborts ongoing model/tool operations and eventually marks the run cancelled. Custom tools/hooks must honor the abort signal; external effects already performed cannot be rolled back. Losing a frontend connection never requests cancellation.
- Submission is not idempotent: the caller must not blindly retry an input whose acceptance is uncertain. Concurrent input for an active agent returns 409. No automatic application retries or durable run resumption are provided.
- Direct input from the user to any team member is refused with 409 `member_conversation` before anything is stored.
- If the agent's model or another selected catalog option cannot resolve, run submission returns 409 without accepting input. Editing or deleting a selected option never interrupts a run already using an earlier snapshot.
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
6. An agent starts a run with model A. Its provider connection and instructions are edited while the run is active. Later steps in that run keep the original config; the next run resolves the new values.
7. Private member history is followed like any agent. Direct input to Lead or Backend returns 409 `member_conversation`; shared workspace input can trigger either according to the team rule. `GET /agents` lists neither.

Team coordination resolves configurations using `prepareRun`, persists run creation atomically with group publication, and starts execution using `launch`. Expected publication refusals are recorded by `feedback` as private user messages and let the same loop continue. Successful publication can persist terminal sender state before recipient launch; subsequent runtime terminal finalization returns that stored state. Group-message delivery changes canonical context separately from private display history.

## Unified streaming and model completion

The follow API returns stored Pi messages and chunks without a separate response-action annotation. Text, thinking, tool blocks and native signatures are preserved for callers. The team policy uses completed model output for continuation and publication; the generic loop does not classify partial text for the UI.
