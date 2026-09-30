<!-- Task proposal; current contract is under docs/systems/ -->

# Frontend system

## Purpose and boundary

The frontend displays an agent's completed message history and updates messages while following a live run. Opening, refreshing, or reconnecting a conversation synchronizes it with the backend before following live output. Each follow stream ends with its associated run.

The frontend has two parts with explicit integration boundaries:

1. **Agent client:** requests backend operations and receives, processes, and maintains backend message data in the backend's format.
2. **assistant-ui adapter:** converts the client's data into assistant-ui presentation data and connects UI actions to client commands.

assistant-ui supplies the rendering components. The client is usable independently of assistant-ui; the adapter is specific to assistant-ui.

The backend owns agent execution, model requests, tool execution, persisted history, and model context management. The frontend sends new user input and observes backend output. Its visible conversation history is distinct from the backend's model-facing context history; context compaction does not rewrite the visible history.

### Responsibility boundary

| Concern | Owner |
| --- | --- |
| Backend requests and follow-stream lifecycle | Agent client |
| Completed message records and live Pi message state | Agent client |
| Pi event processing and construction of partial Pi messages | Agent client |
| Synchronization, ordering, deduplication, and reconnect recovery | Agent client |
| Run state and connection state | Agent client |
| Pi message conversion into assistant-ui messages | Adapter |
| Display association between tool calls and tool results | Adapter |
| Mapping message and run lifecycle into UI statuses | Adapter |
| Mapping UI actions to client commands | Adapter |
| Layout and custom message or tool rendering | assistant-ui components |

## Inputs and preconditions

### Backend data and operations

- A conversation is identified by the backend's agent or conversation identity and, when following a run, its run identity.
- Sending a message supplies new user input and the identifiers needed to route the request. The backend constructs its model context from its own stored history.
- Completed records contain Pi AI messages and backend-owned metadata. Live payloads use the backend's Pi event format. Transport envelopes supply message identity, run identity, ordering information, and synchronization signals as required by the backend protocol.
- A live message and its completed record share a stable message identity. Completed history has a stable order. Missing chunk ranges are detectable from the backend protocol.
- The backend synchronizes completed records before live following. A message completing during that handoff remains available through synchronization or subsequent stream delivery.
- A backend completion notification identifies a persisted whole-message record. A Pi model-call completion event alone does not establish persistence or completion of the agent run.

### Client-to-adapter contract

The client exposes a current snapshot and a way to subscribe to changes. Its snapshot provides:

- Completed message records, preserving Pi payloads and backend metadata.
- Current partial messages in Pi's message format, associated with their backend identities and order.
- Message lifecycle information sufficient to distinguish active output from completed records.
- Current run state and connection or synchronization state, separately from historical messages.

Applying Pi events to maintain a partial Pi message is client protocol processing. It preserves Pi as the message format. Any event data exposed by the client also preserves the backend's event format.

The adapter can obtain the current display from the latest client snapshot without replaying an independent event history. Client commands cover sending input, following a run, and other operations supported by the backend, such as cancellation when available. Exact method names and TypeScript signatures remain implementation decisions.

## Outputs and observable effects

### Synchronization and following

| Trigger or input | Client effect | Display effect |
| --- | --- | --- |
| Open or refresh a conversation | Open the follow operation and synchronize completed history; then follow available live output. | Show whole completed messages and subsequent live updates. |
| Reconnect | Discard previous partial messages and synchronize completed history again, using a completed-history position when available. | Replace stale partial output with synchronized records and any reconstructible live output. |
| Send new user input | Submit the input and follow the resulting run through the backend's sync-then-live operation. | Reflect the backend's accepted messages and subsequent output. |
| Receive a live Pi event | Update the corresponding partial Pi message and notify subscribers. | Update the existing displayed message under its stable identity. |
| Receive a completed record | Reconcile it with completed history and remove any partial message with the same identity. | Display the whole completed message once. |
| Encounter a missing chunk range | Discard the affected partial message. Obtain its completed record through continued following or resynchronization. | Allow the partial message to disappear and the whole message to appear when available. |
| Receive run completion | Apply the run's final delivered updates and finish following. | Preserve completed history and reflect the final run state. |
| Synchronize with no active run | Complete history synchronization and finish the connection. | Show the synchronized completed history. |

When an active message can be reconstructed from retained chunks, the client may rebuild it and continue live updates. When the required initial chunks are unavailable, it waits for the whole completed record. It does not treat an incomplete tail as a complete message.

Following uses a long-lived stream for one run. The connection ends when that run finishes; a subsequent run opens a new connection. Periodic polling is outside this design. Whether input submission and following use one request or separate requests remains a backend API decision.

### Adapter output

The adapter supplies assistant-ui's `ExternalStoreRuntime` with the current ordered display messages, relevant statuses, and action callbacks. This is a local frontend integration contract; backend messages remain in Pi format.

Completed and live messages use the same content-conversion rules:

| Pi data | assistant-ui presentation |
| --- | --- |
| Text content | Text part |
| Thinking content | Reasoning part when included in the presentation |
| Tool call | Tool-call part with the same tool-call identity and current arguments |
| Separate tool-result record | Result and error information associated with its displayed tool call |
| Backend message identity | Stable display-message identity |
| Message lifecycle and run state | Corresponding message statuses and overall running state |

Conversion preserves content order. As the client publishes changes, the adapter supplies updated accumulated content for the same message identity. For example, `Hello`, `Hello world`, and the completed `Hello world!` are successive contents of one displayed message.

A tool-result record can update the tool presentation associated with an earlier assistant message. That presentation update does not mutate the underlying completed Pi records. Producing tool-call arguments and completing tool execution are distinct events.

The adapter maps composer input into the client's accepted user-input format and routes supported UI actions to client commands. Its presentation is derived from client data; synchronization and recovery remain client responsibilities. Message grouping and custom visual components are presentation choices that must preserve association with the underlying backend records.

## Failure behavior

- A connection failure is observable separately from agent-run failure. Losing the follow connection does not cancel the backend run.
- An unexpected end of the connection does not establish run completion. Reconnection synchronizes with the backend before following again.
- If synchronization fails, the client exposes that failure and does not claim that its retained completed history is current.
- Missing chunks cause the affected partial message to be discarded. Continuous animation is not guaranteed; replacement by a completed message is an accepted recovery outcome.
- Duplicate records or repeated chunks do not produce duplicate displayed messages or repeated content. The client uses backend identity and ordering information to reconcile them.
- Command failures are surfaced to the caller. The client does not report input as accepted without backend confirmation; input retry and idempotency semantics remain to be specified with the send API.
- Backend failures and cancellations are reflected as reported by the backend. Whether their partial output becomes a persisted record remains a backend contract decision; the frontend does not invent a completed historical record.

## Guarantees and limits

- The client preserves backend Pi payloads and runtime metadata. Conversion into assistant-ui types occurs at the adapter boundary.
- One client-owned representation governs synchronization, live Pi messages, and recovery. Adapter data is a derived presentation that can be rebuilt from a snapshot.
- Completed history and transient live output remain distinguishable. A completed record supersedes its partial message under the same identity.
- The frontend does not own or submit the agent's model-context history. Backend context changes do not alter the completed display timeline.
- Current run and connection state remain distinct from the timeline. Finishing one model call does not imply that the agent run has finished.
- Live delivery is best effort within the backend's retained chunk range. There are no follower acknowledgements or guarantees of complete chunk replay after eviction.
- Synchronization and following share one flow across open, refresh, reconnect, and send. Streams do not remain open across multiple runs.
- Exact endpoint paths, transport encoding, snapshot API signatures, retry timing, history pagination, local persistence, rendering cadence, message grouping, and additional UI controls remain unspecified. This specification does not establish an implementation or supported package-version range.

## Acceptance examples

1. **Open an idle conversation:** the client synchronizes completed messages, the adapter converts them into whole displayed messages, and the connection ends when synchronization finishes because there is no active run.
2. **Open during a run:** completed history arrives first. Available chunks reconstruct the active Pi message, and later chunks update the same displayed message.
3. **Stream text:** events change Pi message `m1` from `Hello` to `Hello world`. The adapter publishes successive assistant-ui messages with identity `m1`, and the screen shows one growing message.
4. **Complete a message:** the persisted whole record for `m1` replaces its partial data. It appears once, with its final content and appropriate status.
5. **Reconnect after missed completion:** the client drops its partial `m1`. Synchronization returns the completed `m1`, which is shown without replaying its old chunks.
6. **Lose retained chunks:** the backend reports a gap for active `m2`. The client removes its partial `m2`; the adapter reflects that removal. When the completed record arrives, the whole `m2` appears.
7. **Receive a tool result:** the client retains the Pi assistant tool call and separate Pi tool-result record. The adapter associates the result with the same displayed tool call while preserving both client records.
8. **Complete during handoff:** a message completes while the client is synchronizing. Delivery through either phase is reconciled by identity, so it appears once and is not lost between phases.
9. **Continue after one model response:** a Pi response completes and the backend executes a tool or starts another model call. The frontend continues following until the backend reports the run's end.
10. **Compact model context:** the backend changes its stored context for later requests. The frontend's completed message history remains unchanged.
11. **Recover after an unexpected disconnect:** the connection closes without a run-end signal. The client exposes the disconnect and synchronizes on reconnect instead of treating the run as successfully completed.
