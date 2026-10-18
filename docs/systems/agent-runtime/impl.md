# Agent runtime implementation

## Contract

[Agent runtime design](design.md). One backend-owned loop, runtime-controlled requests/tools/context, persist-before-completion, and one-run sync/follow streams.

## Responsibilities and decomposition

The runtime composes the [database system](../database/design.md) with Pi AI model streaming. Runtime policy hooks choose model, request, tools, context mutations, tool execution, and continuation. HTTP is a transport adapter within this system; the follow generator is also usable in-process.

The [config system](../config/design.md) supplies one run snapshot of editable selections. The runtime chooses the resolution point before accepting input and applies that copy through all loop steps. Policy hooks remain the extension point for request construction and context changes.

The agent server also carries the [workspace](../workspace-agent/workspace/design.md) endpoints. It sends every `/workspaces` request to the workspace routes, except those under a workspace's `team`, which go to the [team](../workspace-agent/team/design.md) routes; agent, config, workspace, and team routes share one set of HTTP helpers.

The team supplies member config resolution and wraps the runtime policy for current harness tools, file context and role/roster instructions. Direct HTTP member input is refused. TeamRunner resolves snapshots with `prepareRun`, creates runs through atomic group publication, then invokes `launch` on the single runtime loop. Final member responses are submitted to publication in `shouldContinue`, which receives the exact CompletedMessage returned by commitMessage; expected refusals append private feedback and continue. Accepted publication completes the sender durably before recipient execution; idempotent terminal finalization returns the existing terminal state. `finished` and `finalText` remain private inspection helpers. No private member-call tool remains.

## Coordination and data flow

Accept input transactionally, run the shared loop independently of frontend connections, reread canonical context before each call, publish serialized Pi events, commit final messages, execute tools, and decide continuation. A versioned in-process notification wakes followers after database commits; the context base uses the same notification for its followers. Each follow iteration reads a consistent database snapshot; generation checks avoid lost wakeups during reads. Slow readers hold no event queue. A terminal run's history bound prevents delivery from a later run.

`start` asks the config source to resolve and validate a snapshot before the database accepts input. The snapshot is stored in the run's in-memory step scope. `configuredPolicy` builds Pi requests from that snapshot and the current canonical context. The API layer delegates config CRUD to `ConfigService`, including optimistic revision conflicts. App config governs agent creation and per-request input size.

## Decisions and constraints

Node.js/TypeScript and Pi AI 0.87.1 directly; no Agent Core loop. One active run per agent; sequential tools. POST input and GET follow are separate, with the returned run ID joining them. SSE transports JSON envelopes. Partial failed/cancelled model output is transient and discarded. Unexpected shutdown leaves committed records intact and marks abandoned runs interrupted on restart. No provider/tool side effects are automatically retried. Default maximum 32 model calls per run.

## Code map

- [src/runtime.ts](../../../backend/src/runtime.ts): shared loop, policy hooks, Pi provider adapter, cancellation, follow generator.
- [src/changes.ts](../../../backend/src/changes.ts): versioned notification shared with the context base.
- [Config service](../config/impl.md): editable choices, validation, and consistent run resolution.
- [src/http.ts](../../../backend/src/http.ts): agent and config endpoints, and routing of `/workspaces` to the [workspace routes](../workspace-agent/workspace/impl.md).
- [src/http-helpers.ts](../../../backend/src/http-helpers.ts): request validation, bounded body reads, JSON/SSE transport, heartbeat comments, socket backpressure, and connection abort handling.
- [src/main.ts](../../../backend/src/main.ts): environment configuration, provider catalog, workspace service, team system, initialization and graceful shutdown.
- [src/types.ts](../../../backend/src/types.ts): records, errors and versioned backend protocol.
- [src/index.ts](../../../backend/src/index.ts): in-process exports.
- [README.md](../../../backend/README.md): setup and caller examples.
- [package.json](../../../backend/package.json), [tsconfig.json](../../../backend/tsconfig.json): pinned Pi version and build commands.
- [scripts/verify.mjs](../../../backend/scripts/verify.mjs), [scripts/mysql-test.mjs](../../../backend/scripts/mysql-test.mjs): verification evidence and disposable database lifecycle.

## Verification

Deterministic Pi event streams test request construction, tools, context changes, termination, failure, cancellation, reconnect, pruning, and handoff races against MySQL. HTTP integration checks whole-record synchronization, SSE termination, input validation, and connection independence. Live provider calls require caller credentials and are outside automated tests. [Integration tests](../../../backend/test/integration/backend.test.ts) exercise the real Pi provider collection using its deterministic faux provider, alongside controlled Pi event sources for timing-sensitive cases. The [workspace route tests](../../../backend/test/workspace-routes.test.ts) send `/workspaces` requests through the agent server. From `backend/`, set `VERIFY_TASK_ID=2026-10-07-workspace-agent` and run `node scripts/verify.mjs npm run check`, `node scripts/verify.mjs npm test`, `node scripts/verify.mjs npm run test:mysql`, and `node scripts/verify.mjs npm run build`.

Submission registers background work after the input transaction commits. Shutdown first waits for in-flight submissions, then aborts jobs and releases ownership. Followers never drive the loop. Their generation check surrounds each database snapshot and prevents a completion notification being lost before waiting. A slow follower holds at most the current snapshot; there is no growing subscriber event queue. On a gap it suppresses that message's tail and still reads committed history. Pi terminal events and backend committed-message events remain distinct.

Config integration tests in [backend.test.ts](../../../backend/test/integration/backend.test.ts) verify invalid config rejects a run before input is stored, mid-run edits do not change later calls, and next runs resolve changed or deleted options.

Failed terminal persistence is remembered locally and exposed as unavailable, not a fabricated durable state. The next runtime owner recovers unfinished durable runs as interrupted. Tools, custom hooks and custom streams must honor the run abort signal; their external effects are not transactional with MySQL. The default executable registers no solo-agent catalog tools and does not implement a compaction policy. Workspace member tools are supplied by the harness, with lead design/team tools eligible by role. HTTP exposes new input and observation, while context replacement is an in-process backend operation.

Group delivery cursors append individual shared messages to idle contexts, defer delivery while agents have active runs, and drain at terminal completion/restart. Runtime history and group history remain separate from mutable model context. Team shutdown waits for in-flight publications before runtime shutdown waits/aborts jobs.

Continuation policies receive the committed assistant record as their fourth argument. Team policy passes its messageId to final publication; it does not infer identity from response text or the member’s latest history. Database terminal writes finalize any associated group entry and its working range. Private follow can start at the group entry’s history start boundary; shared delivery still updates context only.

Harness integration uses the generic `afterRun` lifecycle callback. The loop tracks in-flight policy/tool promises and waits for their effects before running finalization, including after cancellation. Callback failure becomes an explicit failed run. Startup passes the callback to database interruption recovery; a failed callback prevents marking that run recovered. TeamSystem checkpoints before successful group publication and remembers that run to avoid racing a successor activation's files during finalization. All file/history/approval policy stays in HarnessService rather than the loop.

## Unified streaming and model completion

The follow API returns stored Pi messages and chunks without a separate response-action annotation. Text, thinking, tool blocks and native signatures are preserved for callers. The team policy uses completed model output for continuation and publication; the generic loop does not classify partial text for the UI.

TeamRunner retains separate per-run jobs until runtime.finished settles, in addition to mention-slot tracking. User configuration activation checks these jobs so publication's early sender release does not make finalizing file/policy work appear idle. Runtime itself does not implement member approval/activation or a second loop.

Group routing remains a team publication concern. The runtime persists raw assistant output, including any routing header, and the team publishes only its parsed body. Private refusal feedback continues the same run on malformed headers; no new completion tool or runtime-specific header parser is introduced.

## Workspace conversation reset boundary

TeamRunner only resets an idle workspace after all tracked jobs, including afterRun finalization, have settled. MySqlStore.resetChat owns deletion; the runtime has no retained conversation cache to clear because requests/history read canonical storage. Old member response views unmount on the group reset event, closing their private follows. No reset tool or alternate run loop is added.
