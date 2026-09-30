# Agent runtime implementation

## Contract

[Agent runtime design](design.md). One backend-owned loop, runtime-controlled requests/tools/context, persist-before-completion, and one-run sync/follow streams.

## Responsibilities and decomposition

The runtime composes the [database system](../database/design.md) with Pi AI model streaming. Runtime policy hooks choose model, request, tools, context mutations, tool execution, and continuation. HTTP is a transport adapter within this system; the follow generator is also usable in-process.

## Coordination and data flow

Accept input transactionally, run the shared loop independently of frontend connections, reread canonical context before each call, publish serialized Pi events, commit final messages, execute tools, and decide continuation. A versioned in-process notification wakes followers after database commits. Each follow iteration reads a consistent database snapshot; generation checks avoid lost wakeups during reads. Slow readers hold no event queue. A terminal run's history bound prevents delivery from a later run.

## Decisions and constraints

Node.js/TypeScript and Pi AI 0.87.1 directly; no Agent Core loop. One active run per agent; sequential tools. POST input and GET follow are separate, with the returned run ID joining them. SSE transports JSON envelopes. Partial failed/cancelled model output is transient and discarded. Unexpected shutdown leaves committed records intact and marks abandoned runs interrupted on restart. No provider/tool side effects are automatically retried. Default maximum 32 model calls per run.

## Code map

- [src/runtime.ts](../../../backend/src/runtime.ts): shared loop, policy hooks, Pi provider adapter, cancellation, versioned notification, follow generator.
- [src/http.ts](../../../backend/src/http.ts): request validation, bounded body reads, JSON/SSE transport, heartbeat comments, socket backpressure, and connection abort handling.
- [src/main.ts](../../../backend/src/main.ts): environment configuration, provider catalog, initialization and graceful shutdown.
- [src/types.ts](../../../backend/src/types.ts): records, errors and versioned backend protocol.
- [src/index.ts](../../../backend/src/index.ts): in-process exports.
- [README.md](../../../backend/README.md): setup and caller examples.
- [package.json](../../../backend/package.json), [tsconfig.json](../../../backend/tsconfig.json): pinned Pi version and build commands.
- [scripts/verify.mjs](../../../backend/scripts/verify.mjs), [scripts/mysql-test.mjs](../../../backend/scripts/mysql-test.mjs): verification evidence and disposable database lifecycle.

## Verification

Deterministic Pi event streams test request construction, tools, context changes, termination, failure, cancellation, reconnect, pruning, and handoff races against MySQL. HTTP integration checks whole-record synchronization, SSE termination, input validation, and connection independence. Live provider calls require caller credentials and are outside automated tests. [Integration tests](../../../backend/test/integration/backend.test.ts) exercise the real Pi provider collection using its deterministic faux provider, alongside controlled Pi event sources for timing-sensitive cases. From `backend/`, run `node scripts/verify.mjs npm run check`, `node scripts/verify.mjs npm run test:mysql`, and `node scripts/verify.mjs npm run build`.

Submission registers background work after the input transaction commits. Shutdown first waits for in-flight submissions, then aborts jobs and releases ownership. Followers never drive the loop. Their generation check surrounds each database snapshot and prevents a completion notification being lost before waiting. A slow follower holds at most the current snapshot; there is no growing subscriber event queue. On a gap it suppresses that message's tail and still reads committed history. Pi terminal events and backend committed-message events remain distinct.

Failed terminal persistence is remembered locally and exposed as unavailable, not a fabricated durable state. The next runtime owner recovers unfinished durable runs as interrupted. Tools, custom hooks and custom streams must honor the run abort signal; their external effects are not transactional with MySQL. The default executable registers no application tools and does not implement a compaction policy. HTTP exposes new input and observation, while context replacement is an in-process backend operation.
