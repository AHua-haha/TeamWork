# Database system

## Purpose and boundary

The database system persists and retrieves agent runtime data in MySQL 8.4. Its caller is the TypeScript agent runtime. It owns serialization and deserialization of stored records and exposes logical operations for completed frontend messages, model-facing context history, current runtime state, and temporarily retained live chunks. The runtime decides what data to write, when to update context, and how much chunk history to retain.

The completed frontend message history and the model-facing context history are distinct data sets. A context change, including compaction, does not rewrite or remove a completed frontend message.

The database also persists editable app, provider-connection, tool/prompt catalog, and per-agent config records, plus saved model-discovery results. It preserves their values and revisions; the config system interprets and validates them.

It also persists workspace model choices/default with revisions, the workspace registry and, for each workspace's context base, the index of current files, every file version, version content, and the ordered change records. The workspace module and the context base decide what to store; the files themselves stay on disk.

It persists each workspace's team members: a member record with its revision, and the member's conversation, which is an agent in the runtime's sense. The team decides what a member record holds; the database keeps the lead unique and the names of active members unique.

## Inputs and preconditions

- Records are scoped by agent identity and, where applicable, run and message identity.
- A context-history entry contains a Pi AI `Message` wrapped in runtime-owned metadata. The database system accepts and returns that wrapper without interpreting the metadata.
- The runtime may append a completed frontend message, read completed messages in stable order, read or update the canonical context history, read or update current runtime state, and append, read, or prune live chunks.
- Every live chunk names its message and has an ordered position within that message. The runtime supplies a completed message with the same identity when that message finishes.
- The runtime supplies chunk retention decisions. A read may request chunks after a position, including positions that have already been pruned.
- Config writes identify a record scope and stable ID. Updates and deletes supply the previously read revision. A config-bundle read identifies the agent whose run config is being resolved.
- Workspace records and context-base changes are scoped by workspace identity. A context change names the sequence number it builds on and supplies its versions, content, index changes, and change record together.

## Outputs and observable effects

- A successful completed-message append makes the whole message available to subsequent history reads. History reads return completed messages in stable order, with enough position information for incremental reads and deduplication.
- Reading context history returns the current canonical list of wrapped messages. A successful context update changes the list used by later runtime reads. It does not alter completed frontend history.
- Reading current state returns the latest stored state for the requested scope, independently of historical messages.
- A live-chunk read returns available chunks in order and identifies the earliest retained position. If requested chunks have been pruned, the result explicitly identifies the gap.
- Pruning removes only temporary chunks. It does not remove a completed message or silently make a truncated chunk range appear complete.
- Serialization and deserialization preserve the supported Pi AI message payload and runtime metadata across a successful round trip.
- Config reads return stored values with revisions. Creates, updates, and deletes commit atomically; a bundle read sees one consistent committed view of the app, agent, catalog, connection, and saved model-discovery records. Creating an agent also creates its initially incomplete config record.
- A committed context change advances the workspace's sequence number by one and makes its versions, content, index, and change record visible together.
- Creating a member also creates its conversation, in one transaction. Member records are read by workspace or by ID, and are updated or retired with the previously read revision. A member's conversation is an agent for every runtime operation but is not returned by `listAgents`, has no agent config record, and cannot be given one. Retiring a member keeps its record and conversation.

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
- `getConfig`, `listConfigs`, `createConfig`, `updateConfig`, and `deleteConfig` operate on app, connection, model-cache, catalog, and agent scopes. `configBundle(agentId)` returns the app record, that agent's record when an agent is named, and the catalog, connections, and model caches from one consistent read. `listAgents` returns the IDs of existing agents that are not team members.
- `createMember`, `getMember`, `listMembers(workspaceId)`, `updateMember`, and `retireMember` serve the team. A member record is `{id, workspaceId, revision, value}`, where `id` is also the conversation's agent ID and `value` is opaque JSON supplied by the team. The store also keeps whether the member is the lead and its active name, as the team supplies them, to enforce uniqueness.

**Workspaces and context bases.**
- **Workspace registry:**
  - `listWorkspaces` returns `{workspaceId, name, directory, createdAt}` records ordered by name.
  - `getWorkspace` returns one record, or null.
  - `createWorkspace(record, directoryKey, lead, models?)` stores a record, its model settings when supplied, and its team's lead with the lead's conversation in one transaction. Optional models support low-level legacy import; normal workspace creation supplies them. `directoryKey` identifies the directory, and no two workspaces share one. If any part fails, nothing is stored.
- **Workspace models.** `getWorkspaceModels` returns `{revision,value}` or null. `saveWorkspaceModels(workspaceId, expectedRevision, value, initializeLead)` writes the validated choices/default atomically; a null revision requires an absent record, otherwise the revision must match. With initializeLead, a lead with both connection/model unassigned receives the default and its accepted source bundle in that same transaction. Other members are unchanged. Stale writes fail with `config_conflict` and change nothing.
- **Run results.** `runMessages(agentId, runId)` returns the completed messages of one run in order, so a caller can read a run's last assistant message without reading the agent's whole history.
- **Loading.** `loadContext(workspaceId)` returns the workspace's sequence number and its current files from one consistent read. Each file has its path, file ID, revision, content hash, size, modification time, and its version's time, author, and reason.
- **Committing.** `commitContext(workspaceId, expectedSeq, commit)` stores one change in one transaction:
  - the new sequence number;
  - content blobs, stored once per workspace and hash;
  - new versions;
  - the current-file rows removed and added;
  - the change record.
- **Reads:**
  - `blob` returns content by hash;
  - `version` returns a version by revision;
  - `history(fileId, before, limit)` returns one file's versions, newest first, before a sequence number;
  - `lastFileId(pathKey)` returns the most recent file that had a path;
  - `records(after, limit)` returns change records in sequence order.
- **Authors.** Stored context authors accept user, external, or lead with memberId/runId. They are preserved across file, history, record and reload reads; malformed authors fail explicitly. Design content and implementation mappings remain opaque text to storage.
- **Keys.** Paths are matched by a lower-cased key, so two paths that differ only in letter case name one current file. A revision is unique within a workspace.

## Failure behavior

- Invalid identities, unsupported or corrupt serialized data, and conflicting writes fail explicitly. Deserialization does not silently discard unknown required message content or runtime metadata.
- A failed completed-message append is not reported as committed. A failed context or state update leaves the last committed value available.
- A request for pruned chunks reports their unavailability; the caller may use completed history or wait for the message to complete.
- Failure to prune chunks may retain extra temporary data but does not change completed history.
- A context replacement requires the revision returned by its earlier read. A stale revision produces `context_conflict` and changes nothing. Duplicate agent/message identities or an attempt to start another active run fail with a conflict. A failed transaction leaves all its changes uncommitted.
- A second lead for a workspace fails with 409 `lead_exists`. A name used by another active member of the workspace fails with 409 `member_exists`. A stale member revision fails with 409 `config_conflict`. A member ID that is not found fails with 404 `not_found`.
- A stale config revision produces `config_conflict` with no write. A duplicate config identity also conflicts. A missing config record fails a direct read explicitly; the bundle reports missing app/agent records for its caller to reject.
- A duplicate workspace ID or directory key fails with 409 `workspace_exists`. Loading a missing workspace fails with 404 `not_found`.
- A context commit whose expected sequence number is not the stored one fails with 503 `backend_error` and writes nothing. Any other failure in the commit also leaves nothing written.
- A stored change record or author that cannot be read fails with 500 `corrupt_data`.

## Guarantees and limits

- Completed frontend messages are stable historical records. Their order and identity do not change when the agent context is edited or compacted.
- The canonical context history is mutable by the runtime. It is the stored context from which the runtime constructs later model requests.
- Live chunks are temporary. The database system does not guarantee that every chunk remains available until a frontend consumes it, and it does not track frontend acknowledgements.
- The retention boundary is observable: callers can distinguish a complete chunk range from one with missing earlier chunks.
- Starting a run, committing a message, finishing a run, replacing context, and appending/pruning a chunk each form an atomic transaction. Context revision changes with every append or replacement. Persistence operations do not perform automatic application-level retries and are not generally idempotent.
- One runtime process owns a database through an exclusive session lock. Another owner is rejected. On restart, abandoned active runs become `interrupted`; completed records and context survive, while transient partial output is cleared. Recovery does not rerun models or tools.
- Durability is that of the configured MySQL/InnoDB deployment. Full-history reads are currently unpaginated; online schema upgrades beyond the prototype group-history import are outside this version.
- Config edits do not lock records for the lifetime of any consuming run. A run that already copied config may continue after its source records are changed or deleted.
- Context-base change records are numbered from 1 without gaps. Versions, content, and records are never removed. Removing or renaming a workspace is not supported.

## Acceptance examples

1. The runtime stores a wrapped Pi AI message, reads it back, and receives the same supported message content and metadata.
2. The runtime changes context history during compaction; a frontend history read still returns the original completed display messages.
3. Chunks 0–9 are written for message `m1`; chunks 0–4 are pruned. A read starting at 0 reports a gap and returns only the retained range.
4. The runtime stores completed message `m1`, then prunes all its chunks. A history read still returns the complete `m1`.
5. Two editors read config revision 2. The first updates it to revision 3. The second update with revision 2 fails without changing the stored value.
6. A config-bundle read concurrent with an edit returns either one complete prior state or one complete new state.
7. A context base commits change 1, creating `user/a.md`, then change 2, moving it to `user/b.md`. Loading the workspace returns `seq` 2 and one current file at `user/b.md`, and the file's history returns both versions.
8. A workspace gets a lead and then a second member `Backend`. A second lead, or a second `backend`, is refused. `listAgents` returns neither member, and creating an agent config for the lead's ID is refused. Retiring Backend frees the name `Backend` and keeps its conversation readable.
9. Two commits both expect sequence number 2. The first stores change 3. The second fails, and the records still end at 3.

## Workspace group chat persistence

The database also persists one shared transcript per workspace, chat settings, per-exchange activation budgets/stopped flags, run/exchange associations, and member delivery positions. `publishChat` atomically validates busy recipients and exchange budget, appends an authored shared message, ends a successfully publishing sender, delivers messages to idle member contexts, and creates all recipient run records. Invalid admission rolls back all these effects. Model snapshots are resolved before this operation and execution starts afterward.

`chatSnapshot` returns database-backed group history pages and run status independent of member execution. `syncChatMember` appends unread shared messages to idle context only. Busy members retain their delivery position until terminal completion drains messages after private work. These appends do not manufacture private display-history records. Member creation inherits group history; retirement records its final delivery position, so later messages do not reach the retired member. Message identities/order and private history remain unchanged by context replacement.

`configureChat` sets the 1–1,000 activation limit for subsequent exchanges. `stopChat` fences existing exchanges and returns active run records for cancellation. `finishRun` returns an already-terminal state without writing again, allowing sender publication and loop finalization to compose. Restart interrupts abandoned runs and drains pending group delivery without replaying triggers.

Group admission additionally reserves ordered user/member timeline entries atomically. Successful member publication references the exact immutable assistant record rather than duplicating the response body, completes its reserved entry and pins its private working range. Terminal failure/recovery retain entries without accepted finals. Reads resolve accepted public text; they do not expose private traces. Immutable entry-change records have a contiguous cursor independent of stable display positions. Older entry completion can be replayed after newer entries exist. Retiring members and replacing context do not delete referenced history.

## Unified streaming and model completion

New member final publications reference the latest committed assistant message of that activation and exact ordered contentIndices for its final text blocks. Publication validates natural completion, absence of tool calls, final text selection and text equality before accepting. Native commentary is excluded. Existing historical plain-text and response-tool references remain read-only immutable history; new publications never use the retired tool format.

## Atomic member configuration activation

activateMembers(workspaceId, {expected, modelsRevision, create, update}) applies a validated complete member change set in one transaction. The active ID/revision set and workspace-model revision must match, and no workspace member may have an active run. It inserts new member conversations/shared history, updates stable exact source/settings together and retires deleted members without erasing prior history. Retirements release names for reviewed replacement creation in that transaction. A busy/stale/conflicting/failed batch persists no partial changes. This trusted backend operation does not infer user approval; team coordination supplies user authority, exact committed review and local finalization gating.

## Configuration activation tracking

The store retains the workspace's latest activated member-config revision/time independently of individual member source metadata. It changes atomically with member activation under the workspace lock and participates in stale-review checks, including no-member-change activations. A failed activation preserves both roster and activation marker. Existing member source snapshots remain durable and independently usable for agent execution.


## Fresh workspace baseline persistence

Normal workspace creation supplies a prepared bootstrap context change and member activation marker. createWorkspace stores them in the same transaction as workspace, models and lead. The initial context sequence is 1 with the root design; source metadata pins the lead's member-config baseline. A failure rolls back all database effects. Low-level storage imports may omit bootstrap, but the application create/adopt endpoint always supplies it. Administrative reset requires exclusive runtime ownership and removes runtime/workspace records and agent config records while retaining provider, app, catalog and model-cache records.

Accepted group final references may include a backend-owned bodyOffset into the selected final text. Reads return the accepted body slice while keeping the raw assistant source immutable. Older references without an offset retain their prior accepted text. Invalid offsets/selection metadata fail explicitly.
