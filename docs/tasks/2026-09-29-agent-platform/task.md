# 2026-09-29-agent-platform

Status: complete
Task start commit: 3e88309e0d8c33bfaa554775ddcf4bafb0229254
Review boundaries: [database](drafts/database/design.md), [agent runtime](drafts/agent-runtime/design.md), and [frontend](drafts/frontend/design.md)

## Design outcomes

- [delivered] [Database system](drafts/database/design.md): MySQL persistence, independent context/display history, versioned serialization and bounded chunks; [canonical contract](../../systems/database/design.md).
- [delivered] [Agent runtime](drafts/agent-runtime/design.md): TypeScript/Pi AI backend-owned loop, policy hooks, run-scoped SSE, cancellation and recovery; [canonical contract](../../systems/agent-runtime/design.md).
- [delivered] [Frontend system](drafts/frontend/design.md): Pi-format agent client, assistant-ui adapter, synchronization and live updates, and light theme; [canonical contract](../../systems/frontend/design.md).

## Decisions and open questions

- The backend comprises two systems: database and agent runtime. The agent runtime owns the backend side of the frontend protocol. The frontend is a separate review boundary added during the design discussion.
- The required request control is the messages sent to the model on every call, including management of one agent's context history; raw provider HTTP payload control is not required.
- The agent runtime backend is TypeScript and uses Pi AI (`@earendil-works/pi-ai`) for unified messages, tool definitions, provider connections, and model calls. Pi Agent Core does not own the loop.
- The frontend display history is a stable record of completed messages. Context compaction changes only the model-facing context history.
- Frontends use a long-lived follow API on open, refresh, reconnect, and send. Each connection synchronizes completed messages first, then follows live chunks.
- A follow stream ends with its associated run. With no active run, synchronization finishes and the connection ends. A subsequent run opens a new stream; the frontend does not periodically poll.
- The frontend has two parts: an agent client that owns requests, synchronized backend data, Pi event processing, and recovery; and an adapter that converts client data and actions for assistant-ui.
- The frontend presentation uses a light theme, as requested during implementation review. The user authorized the reviewed frontend commit.
- The client preserves backend Pi messages, events, and metadata. It maintains partial Pi messages as events arrive; only the adapter converts them into assistant-ui presentation data.
- The adapter supplies current accumulated message content with stable identities. Completed records replace partial messages under the same identity, and tool-result presentation is derived without mutating completed Pi records.
- The frontend submits new user input; model-context history remains backend-owned. Reconnecting discards previous partial messages and synchronizes completed history before following available live output.
- The runtime keeps a bounded chunk buffer and may prune it while a frontend follows. The frontend detects a gap, drops its partial draft, and waits for the completed message. The backend does not retain chunks for each follower or require acknowledgements.
- The backend must own and implement the agent loop, including construction of each model request, model calls, context-history decisions, and tool execution. The frontend calls the backend's run interface. A package-owned agent loop does not satisfy this requirement.
- Pi AI supplies the unified message format and connections to multiple model providers. The database stores an agent's context-history messages; the backend runtime builds each model request from that stored history.
- Pi AI also supplies the unified tool format and model request API. The backend runtime defines which tools are available, implements their execution, constructs each model request, manages context, and controls the loop.
- The backend uses one agent loop implementation for all agents.
- The runtime compacts the context history stored in the database. A model call is built from that stored current history, not from a separate selected view of an unmodified history.
- The user proposes an application message type that wraps each Pi AI message with runtime-maintained metadata. The metadata controls context management, including compaction and automatic hiding.
- Context replacement writes the supplied canonical list with revision checking. Removed entries are no longer in model context; completed display history remains intact. A future compaction policy chooses the contents and metadata of the replacement.
- Implementation defaults: one active run per agent (concurrent input rejected), sequential tools, stop after a response without tool calls, fail after 32 model calls unless configured otherwise. Policy hooks customize requests, tools, metadata, context writes, and continuation.
- Backend implementation authorized on 2026-09-29 with MySQL and TypeScript/Pi AI. HTTP uses POST input then GET SSE follow. Streams are scoped by run ID and completed-history cursor; failed/cancelled partial model output is discarded. Default retention is 256 events / 8 MiB for the active message; completed-message chunks are cleared transactionally.
- One runtime process owns a MySQL database; a session lock rejects a second owner. Restart marks abandoned runs interrupted. There are no automatic input retries or durable run resumption. Deployment authentication, history pagination, and additional timeline event types remain future work.

## Checkpoints and remaining work

- [delivered in this checkpoint] Moved MySQL setup, package, runtime source, tests, and backend scripts to `backend/`. Added `frontend/` with a link to its draft design. Shared system contracts remain under `docs/systems/`. Backend behavior is unchanged. Increment start commit: `5301eb6c075da653c5d7ddb6925324d4e993f40f`. Backend checks and 18 tests passed from the new directory; [verification evidence](tests.jsonl).

- Backend checkpoint prepared on `codex/backend-runtime`. Existing untracked design documents were preserved in `/tmp/rsi-agent-designs.bgEaQM` before edits. No prior application code existed.
- At the backend checkpoint, canonical database/runtime contracts were promoted and verified; the frontend was still a proposal.
- Backend choices: Pi AI 0.87.1 provider collections; MySQL 8.4 via mysql2; Node.js HTTP/SSE; one database owner, no automatic resumption. Context compaction is supported by canonical replacement hooks; a compaction algorithm and application tools are not supplied.
- Initial type checks caught MySQL parameter typing, ID default inference and a test narrowing issue; all were corrected. Integration testing found and corrected ownership-listener cleanup. Additional review corrected oversized-request handling so it returns HTTP 413 without destroying the response socket.
- Backend verification passed: TypeScript check/build, 2 codec tests, 16 real-MySQL integration tests, disposable database test orchestration, and compiled entry-point startup/SIGTERM shutdown. Pi integration uses its deterministic provider; live paid-provider requests were not made.
- Final review also ensured runtime reopening clears recovered failure state and shutdown cleans up connections if releasing ownership fails. The full affected suite was rerun.
- The reviewed frontend implementation adds the agent client, assistant-ui adapter, app, tests, and light theme. This final checkpoint promotes its canonical frontend documents with those files. No backend contract decision remains blocked.
- Initial frontend-only documentation review and all backend test runs (including earlier failures) are recorded in [verification evidence](tests.jsonl). The backend commit carries `Task-ID: 2026-09-29-agent-platform`; Git history identifies its resulting SHA.
