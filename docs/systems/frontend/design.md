# Frontend system

## Purpose and boundary

The frontend lets a user open one agent's conversation, follow its run, choose that agent's model and reasoning, and manage the provider connections from which models are available. It uses a light, restrained layout with a compact navigation rail, a contextual secondary sidebar, and a large content area. The frontend does not own the agent's model-facing context or change the backend's one-history-per-agent identity.

One **conversation** in this UI is one backend **agent** and its single visible message history. Creating a conversation creates an agent. The UI does not promise multiple conversations under one agent, generated titles, or a separate conversation entity.

The conversation data flow retains two boundaries:

1. The agent client requests backend operations and maintains completed Pi messages, live Pi message state, synchronization, run state, and connection state in the backend's format.
2. The assistant-ui adapter converts client snapshots into display messages and routes UI actions to client commands.

A separate config client reads and edits backend config records. Navigation, provider forms, and composer config controls use it; the assistant-ui adapter does not own config or choose the model for a run. The backend owns agent execution, persisted history, and context management.

## Inputs and preconditions

- The backend supplies an agent list, one history per agent, a sync-then-follow operation for a run, agent config records with revisions and validation issues, provider connection records, and model choices for each connection.
- A model selection is identified by both the provider connection ID and model ID. Names and model IDs alone need not be unique across connections.
- A connection includes its display name, provider, request protocol, endpoint URL, and whether a key is configured. The API key is write-only to the backend; read responses do not contain it.
- A model choice supplies its display label, its reasoning levels (the shared scale `off, low, medium, high, xhigh` for reasoning models, none otherwise), the level each scale step is actually sent as for that model, its effective default level, maximum output, context window, and whether its metadata is verified. A listed model is an available choice, not proof that a credential can invoke it.
- An agent config holds the selected model and a separate settings entry per model for that conversation: reasoning, maximum output tokens, temperature, and context budget. Omitted values use the model's defaults. Existing agent configs may also contain prompts and tools; this UI revision does not expose editors for them and preserves their saved values.
- Sending a message supplies user input only. The backend resolves a copy of the agent's saved config at run start and constructs the model request from its own context history. Edits made during a run take effect from the next run.

## Outputs and observable effects

### Navigation and page layout

- The fixed first-level rail has exactly two destinations: **Conversations** and **Config**. Each icon has a text tooltip and accessible name. The active destination remains visibly marked even when its secondary sidebar is collapsed.
- Selecting a destination opens its secondary sidebar. Selecting the active icon again collapses that sidebar while leaving the current page visible. The rail remains available. The sidebar's open state is a view preference; the selected destination and conversation remain addressable through the URL and browser history.
- Returning from Config to Conversations reopens the previously viewed conversation when one has been selected in this browser session.
- On a narrow screen, the secondary sidebar appears over the content and can be dismissed without losing the current page. On wider screens it occupies space beside the rail. Opening or closing it does not cancel an agent run or reset a composer draft.
- The conversation view gives message content the main area, keeps the composer at the bottom, and keeps navigation chrome subdued. Long messages and tool content remain readable without widening the navigation rail.

### Conversations destination

- The secondary sidebar has a **New conversation** action and an agent list. Each entry opens that agent's conversation. The list uses an agent's saved name, or a neutral short-ID fallback for an unnamed agent. It does not claim to be sorted by recent activity because the current agent-list API does not provide activity time.
- A conversation may be renamed from its sidebar entry by editing the agent's saved name. The edit preserves every other agent-config field. The UI does not offer conversation deletion in this revision because the backend has no operation that deletes the full agent history.
- **New conversation** creates a backend agent and initializes its agent config with empty optional fields if needed. The new conversation opens immediately, shows the model selection needed before sending, and starts no run on creation. If app config disallows agent creation, the action is disabled and explains why.
- The main area shows the selected agent's visible message history and current run state. Opening, refreshing, or reconnecting synchronizes completed history before following available live output. Leaving and returning to the conversation does not cancel its run.

### Config destination and Providers page

- Config's secondary sidebar is headed **Providers** and lists configured connections as shortcuts into the overview. It creates no extra config page. The main page is a provider overview, not a generic catalog form. App Settings, prompt templates, tools, and advanced agent configuration have no visible editor in this navigation; their saved backend data remains intact.
- The overview shows every configured connection as a spacious card in a single readable column. One card represents one backend connection, even when several connections use the same provider. Its header shows the display name and actions; its body shows provider, request protocol, endpoint URL, key-configured status, and model availability where the backend has returned a model list. Its read-only model choices and metadata expand beneath the summary. The page has clear empty, loading, and read-error states.
- Each connection offers actions to edit, refresh its model choices, and delete. **Add provider** and **Edit** open a focused dialog rather than expanding an inline general form. The dialog edits display name, provider, request protocol, endpoint URL, and API key. For edits, the key field starts blank and means “keep existing”; replacing or explicitly clearing the key are distinct actions. The dialog explains protocol-specific URL expectations.
- Provider presets may prefill provider, protocol, and endpoint, but all saved values remain reviewable before submission. Refresh attempts endpoint model discovery. The page distinguishes Pi-known models from endpoint-discovered models and indicates unverified metadata. A refresh failure leaves the connection and any previously saved choices visible when still applicable.
- Delete asks for confirmation and explains that agents using the connection will need another model before their next run. The page never displays a raw API key. After a successful add, edit, refresh, or delete, the overview uses backend results rather than pretending a request succeeded before confirmation.

### Composer model and reasoning controls

- The composer contains one compact trigger showing the selected model and reasoning state. With a selected model, opening its popover shows a compact model button and reasoning control; the full model list starts collapsed. Clicking that model expands the list to switch models. With no selected model, the list opens directly. The list includes models from **all** configured connections, grouped or labeled by connection. It does not require a provider selection step. A selected row has a checkmark; duplicate model names remain distinguishable by connection label. An unavailable saved choice is shown as unavailable rather than silently replaced.
- A search icon at the top of the popover reveals or hides the model search field; the field starts hidden. Revealing search also expands the model list. Selecting a model saves its connection ID and model ID, then folds the list back to the compact view.
- Model-call settings are per conversation and per model. The popover always shows and edits the selected model's settings for this conversation. Switching models shows that model's own saved settings, or its defaults if this conversation has none; switching back restores the earlier model's settings. Another conversation's settings for the same model are unaffected. Because each model has its own settings, a model switch never asks to reconcile or clear values.
- The reasoning control is a compact stepped slider with the same five stops for every reasoning model: Off, Low, Medium, High, XHigh. It has a slim pill-shaped track, a blue filled portion with subtle sparkle dots, a round white thumb, and small dots marking the unfilled stops. The current level's name appears prominently in the header button above the model name. With no saved level, the slider shows Off without writing it. Dragging or keyboard adjustment saves the named level when the interaction finishes. When the selected model does not support the chosen level, a small “Sent as …” note under the slider names the level actually sent. A model without reasoning support shows “No reasoning” instead of a slider. The slider never sends an arbitrary numeric value.
- Below the slider, a **More settings** section edits maximum output tokens, temperature, and context budget for the selected model. These change rarely, so the section is folded each time the popover opens, and each field defaults to unset. When folded, it indicates how many of the selected model's values are customized. When expanded, each unset field reads Default with the model's limit (maximum output and context window, or 0–2 for temperature), and each customized field can be cleared back to Default. Its edits are staged and applied as one update for that model; invalid values are explained before saving. Context budget is labeled as saved for future context management.
- Choosing a model, reasoning level, or More settings change persists it for this conversation's later runs once the save succeeds. During a run, a changed choice is labeled as applying to the next run. Send is unavailable while a model or settings change is unsaved, saving, failed, or invalid, or while the selected model's saved settings no longer fit it. The composer does not offer provider selection.
- On opening the picker, the frontend refreshes the connection list and model choices. Config writes use the revision last read. A stale revision requires reviewing the latest stored value before saving; the UI does not overwrite another edit without review.

### Conversation synchronization and display

| Trigger or input | Client effect | Display effect |
| --- | --- | --- |
| Open or refresh a conversation | Synchronize completed records, then follow an active run if present. | Show whole completed messages before live updates. |
| Reconnect | Discard previous partial messages and resynchronize completed history. | Replace stale partial output with current records and reconstructible live output. |
| Send input | Submit user input, then follow that run through the backend operation. | Show backend-accepted messages and subsequent output. |
| Receive a live Pi event | Update the corresponding partial Pi message by backend identity. | Update one displayed message in place. |
| Receive a completed record | Reconcile it with history and remove a partial with the same identity. | Show the whole message once. |
| Encounter a missing chunk range | Discard the affected partial. | Show the completed record when it becomes available. |
| Receive run completion | Apply final updates and finish following. | Preserve history and final run state. |

One follow stream ends with one run; another run opens a new stream. The UI does not periodically poll for live chunks. The assistant-ui adapter derives its messages from the client snapshot, preserves Pi content order and backend message identity, and associates tool results with their displayed tool calls. A completed record supersedes its partial presentation. The visible history does not change when the backend compacts model-facing context.

## Failure behavior

- A connection loss is shown separately from an agent-run failure. An unexpected stream end does not establish run completion; reconnect synchronizes first.
- Missing live chunks may cause a partial message to disappear until its completed record arrives. Duplicate records or chunks do not create duplicate displayed messages.
- A failed provider save, discovery, model save, or rename remains visible with the uncommitted draft so the user can retry or discard it. Successful saves use the backend's returned revision and value.
- If a provider or model becomes unavailable, the selected choice remains visibly unavailable and Send remains disabled until the agent config is valid again. Existing completed history remains readable.
- Backend-reported agent-config issues remain visible. If the selected model's saved maximum output or context budget no longer fits it, or a reasoning level is saved for a model without reasoning, the popover marks that field and lets the user choose a supported value or clear it to Default; it does not change the value automatically. This revision does not add controls for prompts or tools or erase their saved values.

## Guarantees and limits

- The frontend keeps backend Pi payloads and runtime metadata in the agent client. Only the adapter converts them into assistant-ui data.
- Completed history and transient live output remain distinct; current run and connection state are distinct from both.
- The model picker uses backend-listed choices. It never infers models, protocols, or reasoning levels solely from a provider name.
- Composer settings are edits to persistent agent config, not per-message overrides. An active run keeps its start-of-run config snapshot.
- Provider credentials are write-only from the frontend's perspective. The read view shows only whether a key is configured.
- The frontend adds no backend data entity or API requirement in this revision. Exact animations, widths, icon artwork, local sidebar preference persistence, search ranking, and model-list pagination are presentation details.

## Acceptance examples

1. **Collapse navigation:** with a conversation open, the user collapses the Conversations sidebar. The icon rail and conversation remain; reopening the sidebar highlights the same conversation.
2. **Start a conversation:** New conversation creates an agent, opens its empty history, and asks for a model. No run begins until the user sends input with a valid saved config.
3. **Choose a duplicate model name:** two connections expose the same model label. The picker shows both with connection labels; selecting one saves the correct connection ID and model ID.
4. **Choose reasoning:** every reasoning model shows five stops starting at Off, with Off as the default; selecting High saves `high`, never an intermediate number. On DeepSeek V4 Pro (Pi levels `off, high, max`), choosing Medium shows “Sent as High” and XHigh shows “Sent as Max”. A non-reasoning model shows “No reasoning”. Opening the picker writes nothing.
5. **Switch and switch back:** in one conversation the user sets model A to High with a 64k output limit, switches to model B, and sets it to XHigh. B starts from its own defaults; returning to A shows High and 64k again. No conflict prompt appears.
6. **Edit a provider:** the edit dialog shows that a key is configured but not its value. Saving with the key field blank retains it; replacing it sends the new key once and the resulting page still shows only configured status.
7. **Reconnect mid-run:** the frontend removes stale partial chunks, synchronizes stable messages, and resumes available live output or waits for the completed record.
8. **Open Config during a run:** provider edits do not alter the active run. Returning to Conversations synchronizes its history and follows the current run when possible.
9. **Separate conversations:** two conversations use model A. Changing A's reasoning in one leaves the other's A settings unchanged.
10. **Fold rarely changed settings:** opening the popover shows the model and reasoning slider with More settings folded. Expanding it shows Default for maximum output, temperature, and context budget; setting a temperature saves it for this conversation's model, and the folded row then indicates one customized value.
