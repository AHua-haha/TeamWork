## Result summary

Inspected accepted Agent design and current `runtime.ts` / `progress.ts`. Agent implements the model/tool execution loop and an in-memory progress buffer, with persistence and tools supplied via injected dependencies. Source only; no modifications or tests.

## File lookup

| Path | Description |
|---|---|
| `backend/src/domain/agent/runtime.ts` | `AgentRuntime`, stream/policy types and Pi model adapter. |
| `backend/src/domain/agent/progress.ts` | `ProgressStore` FIFO and change notifications. |
| `.rsi/context/design/backend/domain/agent/design.md` | Accepted subsystem design. |

## Implemented contract

`piModelStream(models)` adapts Pi AI `Models` to a `ModelStream` accepting a `ModelRequest` and `AbortSignal`, yielding assistant stream events. `fixedPolicy(model, tools?, systemPrompt?, options?)` builds a fixed runtime policy; `configuredPolicy()` builds a policy from the run configuration source. `AgentRuntime` owns active jobs and exposes lifecycle operations consumed by TeamRunner: preparation/start, launch, cancellation, completion/state, feedback and progress clearing. Inputs include agent/run IDs, user message/context and abort signal as applicable. Outputs are run state and streamed progress; errors are represented in terminal run state or propagated from persistence/dependencies. Effects include injected storage writes, model calls, tool dispatch and in-process progress notification. Example: TeamRunner prepares a run, launches it, and calls cancel on the runtime when requested.

`ProgressStore` tracks per-agent lanes with sequence-numbered `ProgressChunk` values containing message/run identity, history position and event. It maintains a bounded FIFO (design limit 1,024) with eviction and exposes change notifications/cursor reads. Buffer contents are memory-only and clear on process restart. Example: append events as the model streams, then retrieve chunks after the follower's last sequence.

## Implementation notes

Runtime contracts are dependency-injected; this subsystem does not own Harness authority or HTTP/SSE framing. Design describes sync-then-follow framing at system level, while actual HTTP framing belongs elsewhere. Confirm exact method argument forms in `runtime.ts` before adding callers. Cancellation stops through abort signaling; abandoned-run restart handling is outside this in-memory runtime and requires composition/storage verification.

## Verification and continuation

Inspected exports and source structure only; no tests/build run. Open: verify exact FIFO capacity/eviction boundary, follow snapshot consistency, terminal persistence and restart interruption behavior against tests and Runtime composition.

## Automatic retrieval

```json
{"commands":[]}
```
