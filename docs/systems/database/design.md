# Database system

## Purpose and boundary

The database system persists and retrieves agent runtime data in MySQL 8.4. Its caller is the TypeScript agent runtime. It owns serialization and deserialization of stored records and exposes logical operations for completed frontend messages, model-facing context history, current runtime state, and temporarily retained live chunks. The runtime decides what data to write, when to update context, and how much chunk history to retain.

The completed frontend message history and the model-facing context history are distinct data sets. A context change, including compaction, does not rewrite or remove a completed frontend message.

## Inputs and preconditions

- Records are scoped by agent identity and, where applicable, run and message identity.
- A context-history entry contains a Pi AI `Message` wrapped in runtime-owned metadata. The database system accepts and returns that wrapper without interpreting the metadata.
- The runtime may append a completed frontend message, read completed messages in stable order, read or update the canonical context history, read or update current runtime state, and append, read, or prune live chunks.
- Every live chunk names its message and has an ordered position within that message. The runtime supplies a completed message with the same identity when that message finishes.
- The runtime supplies chunk retention decisions. A read may request chunks after a position, including positions that have already been pruned.

## Outputs and observable effects

- A successful completed-message append makes the whole message available to subsequent history reads. History reads return completed messages in stable order, with enough position information for incremental reads and deduplication.
- Reading context history returns the current canonical list of wrapped messages. A successful context update changes the list used by later runtime reads. It does not alter completed frontend history.
- Reading current state returns the latest stored state for the requested scope, independently of historical messages.
- A live-chunk read returns available chunks in order and identifies the earliest retained position. If requested chunks have been pruned, the result explicitly identifies the gap.
- Pruning removes only temporary chunks. It does not remove a completed message or silently make a truncated chunk range appear complete.
- Serialization and deserialization preserve the supported Pi AI message payload and runtime metadata across a successful round trip.

### Supported operations and records

- `createAgent(agentId?, entries?)` creates an agent with optional initial model context. Initial context does not manufacture display history.
- `getContext(agentId)` returns `{revision, entries}`. An entry is `{messageId, message, metadata}`: a Pi `Message` plus a JSON metadata object. `replaceContext(agentId, revision, entries)` atomically replaces that list and increments the revision. Replacement may remove source entries entirely; interpretation of metadata and construction of summaries belong to the runtime.
- `startRun(agentId, userMessage, runId?)` atomically creates a running run, appends the input to display history and context, and claims the agent for that run. At most one run per agent is active.
- `beginMessage` registers the identity of the current model response. `appendChunk` stores a Pi event at the next sequence and applies the supplied maximum count and serialized-byte retention limits in the same transaction. Zero limits retain no chunks.
- `commitMessage` atomically appends a whole message to display history and current context. For the active assistant message it clears the temporary chunk range and active message marker in the same transaction. Only successful terminal assistant responses (`stop`, `length`, `toolUse`) are accepted as completed messages.
- `finishRun` records a terminal status and the run's final history position, clears transient data and frees the agent. Terminal state includes its error, if any. These mutations require the expected active run ID.
- `getState` reads the latest run and context/history positions. `followSnapshot(agentId, runId?, after?)` reads a consistent set of completed records, selected run state and its active chunk range. Omitting the run selects the latest run. A terminal run bounds history at its final position, so following it never includes a later run's messages.
- A completed record is `{agentId, runId, messageId, position, message, metadata}`. Positions start at 1 and are ordered within an agent. Position 0 means no completed records have been seen. Chunk sequences start at 0 per message. The range reports `firstAvailable`, `nextSequence` and retained chunks; a requested sequence below `firstAvailable` is a gap, including when every chunk has been removed.
- Current state is `{agentId, contextRevision, historyPosition, run}`. A run contains `agentId`, `runId`, `status`, `phase`, `step`, `startedAt`, `endedAt`, `endPosition`, `activeMessageId`, and `error`. Status is `running`, `completed`, `failed`, `cancelled`, or `interrupted`; phase is `model`, `tools`, or `finished`. Absent values are null. Timestamps are epoch milliseconds.
- IDs contain 1–64 ASCII letters, digits, underscores or hyphens; cursors and revisions are nonnegative safe integers. Pi message and event payloads use the pinned Pi AI 0.87.1 format. JSON-compatible extension fields are preserved. Functions, cycles, nonfinite numbers, bigint, class instances and unknown content-block kinds fail. Optional undefined object properties are omitted according to JSON serialization. Stored envelopes have version 1; unknown versions fail explicitly.

## Failure behavior

- Invalid identities, unsupported or corrupt serialized data, and conflicting writes fail explicitly. Deserialization does not silently discard unknown required message content or runtime metadata.
- A failed completed-message append is not reported as committed. A failed context or state update leaves the last committed value available.
- A request for pruned chunks reports their unavailability; the caller may use completed history or wait for the message to complete.
- Failure to prune chunks may retain extra temporary data but does not change completed history.
- A context replacement requires the revision returned by its earlier read. A stale revision produces `context_conflict` and changes nothing. Duplicate agent/message identities or an attempt to start another active run fail with a conflict. A failed transaction leaves all its changes uncommitted.

## Guarantees and limits

- Completed frontend messages are stable historical records. Their order and identity do not change when the agent context is edited or compacted.
- The canonical context history is mutable by the runtime. It is the stored context from which the runtime constructs later model requests.
- Live chunks are temporary. The database system does not guarantee that every chunk remains available until a frontend consumes it, and it does not track frontend acknowledgements.
- The retention boundary is observable: callers can distinguish a complete chunk range from one with missing earlier chunks.
- Starting a run, committing a message, finishing a run, replacing context, and appending/pruning a chunk each form an atomic transaction. Context revision changes with every append or replacement. Persistence operations do not perform automatic application-level retries and are not generally idempotent.
- One runtime process owns a database through an exclusive session lock. Another owner is rejected. On restart, abandoned active runs become `interrupted`; completed records and context survive, while transient partial output is cleared. Recovery does not rerun models or tools.
- Durability is that of the configured MySQL/InnoDB deployment. Full-history reads are currently unpaginated; additional durable timeline event types and online schema upgrades are outside this version.

## Acceptance examples

1. The runtime stores a wrapped Pi AI message, reads it back, and receives the same supported message content and metadata.
2. The runtime changes context history during compaction; a frontend history read still returns the original completed display messages.
3. Chunks 0–9 are written for message `m1`; chunks 0–4 are pruned. A read starting at 0 reports a gap and returns only the retained range.
4. The runtime stores completed message `m1`, then prunes all its chunks. A history read still returns the complete `m1`.
