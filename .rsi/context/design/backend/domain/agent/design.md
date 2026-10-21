# Domain: Agent

## Purpose, responsibilities and boundaries

Agent owns the model–tool execution loop mechanism, progress event buffering, run state management, and the follow protocol. It decides *how model requests are constructed*, *when tools are dispatched*, *whether to continue*, and *how progress reaches followers*.

Agent constructs model requests from stored context, calls model providers through Pi AI, dispatches tool results, manages the 1,024-event progress FIFO with eviction, decides loop continuation based on stop reasons, handles cancellation, and frames SSE follow events. It owns the run state machine (running/completed/failed/cancelled/interrupted) and the model/tools/finished phases.

Agent never decides file authority (that's Harness), never validates member configurations (that's Team), never persists directly (it calls Storage through interfaces), and never speaks HTTP transport (that's API). It receives tool authorization from Harness and calls Storage to commit messages and run states.

## Interface contract

**Purpose and supported interactions.** Agent provides:
- Run submission (start a new run for an agent with user input)
- Model loop execution (construct request, call model, dispatch tools, decide continuation)
- Progress buffering (maintain 1,024-event FIFO, evict oldest on overflow, expose for followers)
- Follow protocol (sync-then-follow: consistent snapshot + live stream with reconnect support)
- Run control (cancel active runs, query run state)
- Context history management (read/replace stored context, append completed messages)

**Required inputs and returned information.**
- `startRun(agentId, userMessage, runId?)` — atomically starts run, claims agent, appends input to history
- `executeLoop(agentId, runId)` — runs the model–tool loop until terminal state or cancellation
- `followRun(agentId, runId?, after?)` — returns consistent snapshot + SSE stream of progress/history events
- `cancelRun(agentId, runId)` — signals cancellation, transitions to cancelled state when loop acknowledges
- `getState(agentId)` — returns current run state, context revision, history position
- `replaceContext(agentId, expectedRevision, entries)` — atomically updates model-facing context

**Observable effects.** Agent calls Storage to persist run records, completed messages, context changes, and terminal states. It calls Harness for tool authorization. It calls model providers through Pi AI. Progress events flow through the in-process Changes bus. The loop reads abort signals and stops cleanly on cancellation.

**Failure behavior.** Active run conflicts, context revision mismatches, missing agents, invalid message formats fail explicitly (`agent_busy`, `context_conflict`, `not_found`, `invalid_input`). Model failures, tool errors, and timeout become terminal run status with error details, never fabricated successful responses. Restart marks abandoned runs `interrupted` without replaying them.

## Constraints, specifications and requirements

- Agent imports Foundation, Storage interfaces, and Harness (for tool execution)
- Must not import concrete `MySqlStore`, API, Team, or Workspace directly
- The progress FIFO is memory-only; it does not persist and is cleared on restart
- Follow streams support cursor-based reconnection; clients must handle eviction gaps
- Context replacement does not alter completed frontend history (separate stable records)
- Tool dispatch preserves Pi's native tool result format including structured details
- The loop spans both domain (mechanism) and runtime (live instance); this is recorded as acceptable for now
- One run per agent is active; attempts to start a second fail until the first is terminal
