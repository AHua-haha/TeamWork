<!-- Task proposal; current contract is under docs/systems/ -->

# Frontend system

## Purpose and boundary

The frontend displays an agent's completed message history and updates messages while following a live run. Opening, refreshing, or reconnecting a conversation synchronizes it with the backend before following live output. Each follow stream ends with its associated run.

The frontend also lets users browse agents and edit the application config, global agent config catalog, and each agent's config through backend APIs. The Agents area contains the agent list, catalog, agent conversation, and agent configuration. App Settings is a separate destination. Backend system config has no frontend editor.

The conversation flow has two parts with explicit integration boundaries:

1. **Agent client:** requests backend operations and receives, processes, and maintains backend message data in the backend's format.
2. **assistant-ui adapter:** converts the client's data into assistant-ui presentation data and connects UI actions to client commands.

assistant-ui supplies the rendering components. The client is usable independently of assistant-ui; the adapter is specific to assistant-ui.

A separate config client handles config reads and edits in the backend's format. Configuration pages and the chat-composer controls use that client. The assistant-ui adapter does not own config data or choose the model for a run.

The backend owns agent execution, model requests, tool execution, persisted history, and model context management. The frontend sends new user input and observes backend output. Its visible conversation history is distinct from the backend's model-facing context history; context compaction does not rewrite the visible history.

### Responsibility boundary

| Concern | Owner |
| --- | --- |
| Backend requests and follow-stream lifecycle | Agent client |
| Completed message records and live Pi message state | Agent client |
| Pi event processing and construction of partial Pi messages | Agent client |
| Synchronization, ordering, deduplication, and reconnect recovery | Agent client |
| Run state and connection state | Agent client |
| App, catalog, and agent-config reads and edits | Config client |
| Editable form state, save status, and revision-conflict presentation | Config UI |
| Agent navigation, catalog editor, app settings, and composer config controls | UI components |
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

### Config data and operations

- The backend supplies an agent-list operation, config read/edit operations, permitted catalog options, provider connections, backend-owned model choices, record revisions, and validation errors. The UI does not infer the available model or tool universe from provider names or hard-coded lists.
- The global catalog is a set of permitted choices rather than agent defaults. Each agent selects a provider connection and a backend-listed model explicitly. A new agent may be created with incomplete config, but a run cannot start until the backend can resolve it.
- Config writes may happen at any time. The backend resolves a copy of the run-affecting config at run start; later edits affect the next run, not the active one. The frontend never owns the runtime's model-facing context history.
- System config, including the database connection and key used to encrypt provider secrets, is not editable from the frontend. App Settings exposes product-wide UI and API settings. The global Models tab edits provider connection details, including a write-only API key.

### Client-to-adapter contract

The client exposes a current snapshot and a way to subscribe to changes. Its snapshot provides:

- Completed message records, preserving Pi payloads and backend metadata.
- Current partial messages in Pi's message format, associated with their backend identities and order.
- Message lifecycle information sufficient to distinguish active output from completed records.
- Current run state and connection or synchronization state, separately from historical messages.

Applying Pi events to maintain a partial Pi message is client protocol processing. It preserves Pi as the message format. Any event data exposed by the client also preserves the backend's event format.

The adapter can obtain the current display from the latest client snapshot without replaying an independent event history. Client commands cover sending input, following a run, and other operations supported by the backend, such as cancellation when available. Exact method names and TypeScript signatures remain implementation decisions.

## Outputs and observable effects

### Config navigation and editing

- The Agents destination provides an agent list and a global catalog editor with separate Models, Prompts, and Tools tabs. Each tab has a list and a form specific to its kind; there is no generic Kind selector. Runtime-policy tabs appear only when that kind is available. Editing a catalog entry changes data available to later resolutions; it does not create executable tool handlers.
- The Models tab manages provider connections. Its editor sets a name, provider, endpoint URL, request protocol (OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages), and a write-only API key. The selected protocol applies to calls for all models on that connection, including Pi-known models. Selecting a known Pi provider initially fills its endpoint and default protocol; an Anthropic-compatible endpoint uses its provider root URL. Read views show only whether a key is configured. Selecting a connection displays a searchable, read-only model list supplied by the backend: Pi-known models plus models saved by endpoint discovery. The list shows context window, output limit, reasoning support, and whether metadata is verified, and clarifies that listing does not confirm credential access. There is no global model profile editor or model-ID text input.
- Saving a known Pi provider shows its built-in models immediately. Saving an unknown provider attempts endpoint discovery and keeps the connection when discovery fails. The Models tab also offers an explicit refresh action. A discovery error leaves previously saved choices visible when the connection identity still matches. Changing provider, URL, or protocol invalidates old discovered choices.
- An agent detail view provides Conversation and Configuration views. Configuration covers the agent's prompt, selected model, tools, model-call options, and future runtime settings. It shows missing or unavailable selections instead of silently replacing them.
- A newly created agent opens with a clear setup state. The conversation composer offers an explicit model selection, and Send is unavailable until required agent config is saved and valid. Creating an agent does not automatically start a run.
- App Settings provides one place to read and edit app-wide settings. There is no System Config page.
- Leaving Conversation for a config view does not cancel an active backend run. Returning to Conversation uses the normal history synchronization and follow flow.

### Chat-composer config controls

- A model selector beside the input offers configured provider connections and each connection's backend-listed models. The current reasoning selection is visible beside the model, with other supported model-call options available from a nearby control. The controls remain usable at desktop and mobile sizes.
- These controls edit the same persisted agent-config record as the Configuration view. They are not per-run overrides and do not send a model-context history or a model request with the user's message. There is no implicit Default model choice.
- The agent Configuration page selects a provider connection and then one of its models. It edits context budget, maximum output tokens, temperature, and reasoning for that agent. Context budget is marked as saved for future context management; automatic compaction is not yet provided. Unknown discovered models are labeled unverified and do not offer reasoning.
- Opening the model selector refreshes the permitted choices. Only options supported by the selected model are offered. When a model change makes a selected option invalid, the UI shows what must be changed; it does not silently substitute a value.
- Choosing a model or reasoning level saves immediately when the resulting config is valid. If a model change requires another option to change, the UI stages those choices and saves them together after the user resolves the incompatibility. The advanced model-call options panel stages multiple fields and applies them as one update. While a save is pending or has failed, Send cannot start a run using an unconfirmed choice. The UI distinguishes saved values from unsaved edits and reports failures without claiming success.
- A config edit made during an active run is labeled for the next run. The active run continues with its earlier snapshot. The composer and full Configuration view display the same saved selections after synchronization with the backend.
- Config forms submit the revision they last read. A stale-revision conflict asks the user to review the latest stored values; the UI does not overwrite another editor's change without review. Reopening or refocusing a config view refreshes its records; the feature does not require a continuous config stream or periodic polling.

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

The adapter supplies assistant-ui's `ExternalStoreRuntime` with the current ordered display messages, relevant statuses, and action callbacks. This is a local frontend integration contract; backend messages remain in Pi format. The frontend presents the conversation in a light theme at desktop and mobile widths.

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

The composer config controls use the config client independently of the assistant-ui adapter. Sending input waits for any pending config save. The backend then resolves the latest committed config for the new run; the frontend does not construct or submit that resolved config itself.

## Failure behavior

- A connection failure is observable separately from agent-run failure. Losing the follow connection does not cancel the backend run.
- An unexpected end of the connection does not establish run completion. Reconnection synchronizes with the backend before following again.
- If synchronization fails, the client exposes that failure and does not claim that its retained completed history is current.
- Missing chunks cause the affected partial message to be discarded. Continuous animation is not guaranteed; replacement by a completed message is an accepted recovery outcome.
- Duplicate records or repeated chunks do not produce duplicate displayed messages or repeated content. The client uses backend identity and ordering information to reconcile them.
- Command failures are surfaced to the caller. The client does not report input as accepted without backend confirmation; input retry and idempotency semantics remain to be specified with the send API.
- Backend failures and cancellations are reflected as reported by the backend. Whether their partial output becomes a persisted record remains a backend contract decision; the frontend does not invent a completed historical record.
- Config read, validation, and save errors remain visible in the relevant editor. An unsuccessful save does not appear as a saved selection or enable Send on an incomplete agent.
- If a selected catalog option, provider connection, or model is deleted, an active run remains visible and continues according to the backend's run snapshot. The agent's next run is unavailable until its config is repaired; the UI shows the missing selection and a path to choose an available option.
- A stale config revision produces a reviewable conflict. Unsaved user input and form edits are not silently discarded when the UI reloads the latest stored record.

## Guarantees and limits

- The client preserves backend Pi payloads and runtime metadata. Conversion into assistant-ui types occurs at the adapter boundary.
- One client-owned representation governs synchronization, live Pi messages, and recovery. Adapter data is a derived presentation that can be rebuilt from a snapshot.
- Completed history and transient live output remain distinguishable. A completed record supersedes its partial message under the same identity.
- The frontend does not own or submit the agent's model-context history. Backend context changes do not alter the completed display timeline.
- Current run and connection state remain distinct from the timeline. Finishing one model call does not imply that the agent run has finished.
- Live delivery is best effort within the backend's retained chunk range. There are no follower acknowledgements or guarantees of complete chunk replay after eviction.
- Synchronization and following share one flow across open, refresh, reconnect, and send. Streams do not remain open across multiple runs.
- Catalog and agent-config editing use one backend source of truth. The composer is a shortcut into the agent's persistent config, not a second config store. A UI config edit never changes the snapshot of an active run.
- App Settings and catalog editing are separate from backend system config. The API key is sent only when entered or replaced; backend responses and retained frontend config data contain no raw provider credentials.
- Exact endpoint paths, transport encoding, snapshot API signatures, retry timing, history pagination, local persistence, rendering cadence, and message grouping remain unspecified. This specification does not establish an implementation or supported package-version range.

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
12. **Configure a new agent:** the user creates an agent, sees that a model is required, selects a permitted model in the composer, and can send input after the selection is saved and validated.
13. **Change the model during a run:** the user selects another model in the composer. The saved agent config changes, the current run keeps its earlier model snapshot, and the next run uses the new selection.
14. **Edit from two views:** the user changes reasoning in the composer, then opens Configuration. The Configuration view shows the same saved agent value, subject to a refresh if another editor changed it.
15. **Handle a removed option:** a provider connection selected by an idle agent is deleted. The agent view shows the unavailable selection, does not choose another connection automatically, and requires a valid selection before Send.
16. **Handle a conflicting edit:** two editors read the same agent config. One saves; the other's save reports a revision conflict and preserves its unsaved form for review.
17. **Navigate during a run:** the user opens App Settings or the catalog while an agent is running. The backend run continues; returning to Conversation resynchronizes its completed messages and follows remaining live output.
18. **Create a selectable model:** the user creates a provider connection and its backend-listed models appear in agent model selectors. No model ID or model profile is entered.
19. **Replace a connection key:** the user sees that a key is configured but not its value, enters a replacement, and saves. A running agent keeps its earlier key snapshot; later runs use the new key.
