# Frontend system

## Purpose and boundary

The frontend lets a user:

- add a workspace, a project folder, and talk to its lead, follow the lead's run, and choose the lead's model and reasoning;
- see the workspace's team, and view and edit the workspace's files: its context base and the project's own files;
- open a conversation with an agent that belongs to no workspace, follow its run, and choose its model and reasoning;
- manage the provider connections from which models are available.

It uses a light, restrained layout with a compact navigation rail, a contextual secondary sidebar, a large content area, and, on a workspace page, a panel that slides in from the right and holds the team and the files. The frontend does not own the agent's model-facing context or change the backend's one-history-per-agent identity.

A **workspace** is a project the user has added. Adding one creates its team and its **lead**, and the workspace's conversation is the lead's: one backend agent and its single visible message history. The user talks only to the lead; the lead forms and manages the rest of the team, and the UI shows the team without managing it. A **solo conversation** is a backend agent that belongs to no workspace and has no team or files. In both cases a conversation is one agent and its single visible message history. The UI does not promise several conversations with one lead, generated titles, or a separate conversation entity.

The conversation data flow retains two boundaries:

1. The agent client requests backend operations and maintains completed Pi messages, live Pi message state, synchronization, run state, and connection state in the backend's format.
2. The assistant-ui adapter converts client snapshots into display messages and routes UI actions to client commands.

A separate config client reads and edits backend config records. Navigation, provider forms, and the composer config controls of a solo conversation use it; the assistant-ui adapter does not own config or choose the model for a run. A workspace client requests workspace, team, project-file, and context-base operations and follows a workspace's context change records. The workspace page and its panel use it; it is independent of the conversation data flow. The backend owns agent execution, persisted history, context management, and the files.

## Inputs and preconditions

- The backend supplies the registered workspaces; for each, a team of members, with the lead first; a list of agents that belong to no workspace; one history per agent, including each lead; a sync-then-follow operation for a run; agent config records for solo agents with revisions and validation issues; provider connection records; and model choices for each connection.
- A team member has a name, role, responsibility, scope paths, run settings, a revision, issues that stop it from running, and whether it is running now, as the [Team design](../workspace-agent/team/design.md) defines. The lead's conversation is the agent whose ID is the lead's member ID.
- A model selection is identified by both the provider connection ID and model ID. Names and model IDs alone need not be unique across connections.
- A connection includes its display name, provider, request protocol, endpoint URL, and whether a key is configured. The API key is write-only to the backend; read responses do not contain it.
- A model choice supplies its display label, its reasoning levels (the shared scale `off, low, medium, high, xhigh` for reasoning models, none otherwise), the level each scale step is actually sent as for that model, its effective default level, maximum output, context window, and whether its metadata is verified. A listed model is an available choice, not proof that a credential can invoke it.
- A solo agent's config holds the selected model and a separate settings entry per model for that conversation: reasoning, maximum output tokens, temperature, and context budget. The lead's run settings hold the same fields, as the [Config design](../config/design.md) defines, and are saved through the lead's member record. Omitted values use the model's defaults. Existing configs may also contain prompts and tools; this UI revision does not expose editors for them and preserves their saved values.
- Sending a message supplies user input only. The backend resolves a copy of the agent's saved config at run start and constructs the model request from its own context history. Edits made during a run take effect from the next run.
- The backend supplies registered workspaces and their project files as the [Workspace design](../workspace-agent/workspace/design.md) defines, and each workspace's context base as the [Context base design](../workspace-agent/context-base/design.md) defines. Both include listings, reads, saves guarded by revisions, and find. The context base also supplies moves, deletes, history, and an ordered change feed. User context is writable through the frontend; agent context is read-only.

## Outputs and observable effects

### Navigation and page layout

- The fixed first-level rail has two destinations, **Conversations** and **Config**. Each icon has a text tooltip and accessible name. The active destination remains visibly marked even when its secondary sidebar is collapsed.
- Selecting a destination opens its secondary sidebar. Selecting the active icon again collapses that sidebar while leaving the current page visible. The rail remains available. The sidebar's open state is a view preference; the selected destination and conversation remain addressable through the URL and browser history.
- Returning from Config to Conversations reopens the previously viewed conversation when one has been selected in this browser session.
- On a narrow screen, the secondary sidebar appears over the content and can be dismissed without losing the current page. On wider screens it occupies space beside the rail. Opening or closing it does not cancel an agent run or reset a composer draft.
- A workspace page has a **Show team and files** button at the right of its header, shown while the panel is closed. It opens the panel on the right of the conversation; the panel's own bar has the buttons that close it and that expand it. The panel is not a destination: it changes neither the route nor the left sidebar. A solo conversation has no panel and no such button.
- The address names the page: `?workspace=<id>` for a workspace, `?agent=<id>` for a solo conversation, and `?page=providers` for Config.
- On wide screens the panel takes space beside the conversation, and **Expand** widens it over the conversation's space until **Restore** returns it. On narrower screens it slides over the page, clicking outside it closes it, and Expand widens it to the whole width beside the rail. On the narrowest screens it covers the page beside the rail, opening it collapses the left sidebar, and Expand is not offered.
- Closing the panel keeps its open files and unsaved edits for the next time it opens. Whether the panel is open and expanded carries over when the user moves to another workspace; its contents belong to each workspace. Opening, closing, or expanding the panel does not cancel an agent run or reset a composer draft.
- The conversation view gives message content the main area, keeps the composer at the bottom, and keeps navigation chrome subdued. Long messages and tool content remain readable without widening the navigation rail.

### Conversations destination

- The secondary sidebar has two sections that are not nested: **Workspaces**, with an **Add workspace** action and the registered workspaces ordered by name, and **Conversations**, with a **New conversation** action and the solo agents. Each entry opens its page. A solo agent is listed by its saved name, or a neutral short-ID fallback. Neither list claims to be sorted by recent activity because the backend does not provide activity time. The sidebar does not list team members.
- **Add workspace** opens a dialog for a name, an absolute folder on the backend's machine, and a choice between creating a new folder and using an existing one. On success it opens the new workspace, whose lead is ready to be given a model. A refused request keeps the dialog open with the backend's message.
- A solo conversation may be renamed from its sidebar entry by editing the agent's saved name, preserving every other config field. The UI does not offer deleting or renaming workspaces or deleting conversations in this revision because the backend has no operation for them.
- **New conversation** creates a backend agent and initializes its config with empty optional fields. It opens immediately, shows the model choices needed before sending, and starts no run on creation. If app config disallows agent creation, the action is disabled and explains why.
- The main area shows the selected conversation's visible message history and current run state. Opening, refreshing, or reconnecting synchronizes completed history before following available live output. Leaving and returning to a conversation does not cancel its run.
- A workspace page opens the lead's conversation. While the lead has no model, its issue list says to select a provider and model, and Send stays unavailable until the model is saved. While the lead runs, including while it waits for a call, Send is unavailable and Stop is offered; input sent from another window is refused by the backend as busy, and the page shows that.
- Leaving a workspace page, by the sidebar, the rail, or the browser's back and forward, while one of its open files has unsaved edits first asks to discard them. Staying keeps the conversation, its files, and the edits.

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
- On a workspace page the controls edit the lead's run settings, saved through the lead's member record; the lead's model is chosen here, by the user. No other member's model is chosen in the application. Everything above applies to the lead in the same way, and its issues, such as having no model, are shown in the same place.
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

A call from the lead to another member appears like any tool call, with a header that names the recipient, such as **→ Backend**. Its input is the text sent, and its result is the recipient's final response, shown when the call returns; while it waits the card says Running. The recipient's own reasoning, tool calls, and files are not shown in the conversation, and the application offers no way to open another member's conversation.

One follow stream ends with one run; another run opens a new stream. The UI does not periodically poll for live chunks. The assistant-ui adapter derives its messages from the client snapshot, preserves Pi content order and backend message identity, and associates tool results with their displayed tool calls. A completed record supersedes its partial presentation. The visible history does not change when the backend compacts model-facing context.

### Workspace panel

- **The workspace.** The panel always shows the workspace of the page it belongs to; the workspace is known from the address, so the panel never asks for one. It loads nothing until it is first opened.
- **Layout.** The panel has three parts:
  - a **bar** across the top, with a **Team** tab that is always first and cannot be closed, then a tab for each open file and an **Open a file** (+) button, and the file-tree toggle, Expand or Restore, and Hide on the right;
  - the **viewer** in the center, which shows the active tab: the team, or an open file; the Team tab is active when the panel first opens and whenever no file tab is;
  - the **file tree**, a column floating at the right of the panel, headed by the workspace's name and folder, with the filter field above the trees. The tree toggle hides and shows it, and Open a file shows it and puts the cursor in the filter. The tree is available with the Team tab as well, so the user can browse files while looking at the team; opening a file from it switches to the file's tab. On the narrowest screens the tree covers the viewer, and opening a file hides it.
- **Team tab.** It lists the workspace's members, the lead first, each as a card:
  - the name, with the lead marked, and the role;
  - a status: **Working** while the member is running, **Idle** when it can run, or **Cannot run** with the reasons when it has issues; the lead without a model says to select one in the composer;
  - the responsibility, the selected model, and the scope as paths;
  - a scope path that exists opens in a file tab, a folder by revealing it in the tree.

  A note says that the lead manages the team and the user asks the lead for changes. The tab offers no way to create, change, or retire a member. It reads the team when the panel opens and when the tab is shown. While the lead's run is active it reads again every few seconds, and when the run ends, so **Working** follows who is being called. A failed read shows the backend's message with Retry, keeping the last team shown.
- **Trees.** The tree shows two sections:
  - **Context base**: the **User context** tree with its file count, and the read-only **Agent context** tree. A status shows whether changes arrive live: Connecting, Live, Reconnecting, or Updates stopped. Files the backend cannot serve are listed, folded, with the reason for each.
  - **Project**: the workspace folder's files, as the backend lists them, with a refresh action.

  Folders open and close in place and load their entries when first opened. Folders come before files. A truncated listing says how many entries it shows. User-context entries offer new file (folders only), rename or move, and delete. Project folders offer new file. Agent-context entries offer no changes.
- **Find files.** A filter field finds paths containing the text, without regard to letter case, in both the context base and the project. While it has text, the trees give way to the matches, grouped by source with their counts. Opening a match opens the file and reveals it in its tree.
- **Tabs.** Opening a file from the tree, a match, or a link activates its tab, adding a tab if the file is not open yet. Several files may be open at once, and each tab keeps its own view, draft, and history state while another tab is active. A tab shows the file name, a marker when it has unsaved edits, and its location on hover. Its × button, or a middle click, closes it, and the next tab becomes active. Closing a tab with unsaved edits first asks to discard them.
- **File viewer.** The viewer's header shows the file's location as a breadcrumb: the workspace name, **Context base** for a context file, the folders, and the file name, with the unsaved-edits marker. Icon actions follow on the right: Preview and Text for Markdown, history for a context file or Reload for a project file, Copy, and, for a user-context file, Rename and Delete. Save and Discard appear while there are unsaved edits. A footer shows:
  - when the file was last updated and its size;
  - for a context file, who changed it last (in the app or on disk) and the reason, if any;
  - whether it is read-only.

  Markdown files (`.md`, `.markdown`) open in **Preview** and can switch to **Text**. Other files show only Text. **Copy** copies the shown content.
- **Preview** renders headings, paragraphs, emphasis, strikethrough, inline and fenced code, quotes, nested and numbered lists, tables, rules, and links. Raw HTML is shown as text, and an image shows its alt text. A relative link opens the file it names in the same tree. It never leaves the user or agent category for a context file, or the workspace for a project file. Web and mail links open in a new tab. Other links do nothing.
- **Text** is a plain-text editor for user-context and project files. It is read-only for agent context and for earlier versions.
  - **Save** (or Ctrl/Cmd+S) stores the content based on the revision the viewer loaded. **Discard** returns to that content.
  - A marker shows unsaved changes in the header and on the tab. Opening another file keeps them in their tab. Closing that tab, or leaving the workspace page, first asks to discard them, and leaving the page asks the browser to warn.
- **New file.** The new-file action asks for a path, starting with the folder and `untitled.md`. It creates an empty file and opens it in a new tab in Text. A context path must be in user context. A project path may name missing folders, which are created.
- **Rename, move, and delete.** These apply to user-context files and folders, from the tree or from the open file. Moving a folder moves every file in it, and open tabs follow their files to the new paths. A move never replaces an existing path. Delete asks for confirmation and names what it deletes. Tabs of deleted files close unless they have unsaved edits; such a tab stays open and says the file was deleted.
- **History.** A context file's history lists its versions, newest first. Each version shows its action (created, edited, moved from another path, or deleted), time, author, and reason. **Load older** pages back. Selecting a version shows it read-only. For a user-context file, **Restore this version** saves that version's content as current, with a reason naming its time. Every earlier version is kept.
- **Project files.** **Reload** reads the open project file again. The project tree's refresh re-reads its open folders. Project files have no history, move, delete, or live updates.
- **Live updates.** While the panel shows a workspace, the frontend follows the workspace's context change records. Each record refreshes the open context folders, the file counts, and the problem list. When a context file open in a tab changes:
  - without unsaved edits, the viewer shows the new version;
  - after a move, the viewer follows the file to its new path;
  - after a delete, the viewer keeps the content and says the file was deleted.

## Failure behavior

- A connection loss is shown separately from an agent-run failure. An unexpected stream end does not establish run completion; reconnect synchronizes first.
- Missing live chunks may cause a partial message to disappear until its completed record arrives. Duplicate records or chunks do not create duplicate displayed messages.
- A failed provider save, discovery, model save, or rename remains visible with the uncommitted draft so the user can retry or discard it. Successful saves use the backend's returned revision and value.
- If a provider or model becomes unavailable, the selected choice remains visibly unavailable and Send remains disabled until the agent config is valid again. Existing completed history remains readable.
- Backend-reported agent-config issues remain visible. If the selected model's saved maximum output or context budget no longer fits it, or a reasoning level is saved for a model without reasoning, the popover marks that field and lets the user choose a supported value or clear it to Default; it does not change the value automatically. This revision does not add controls for prompts or tools or erase their saved values.
- **File conflicts.** A save refused because the file changed since it was loaded keeps the user's draft, says it was not saved, and loads the latest version. When a newer version arrives while the draft differs from both, the viewer keeps the draft and offers **Load latest**, which drops the draft, or **Save mine over it**, which saves the draft over the newer version. Nothing overwrites a newer version without that choice.
- **Deleted while open.** When the feed reports a delete, or a read finds the file missing, the viewer keeps the content and says the file was deleted. Saving a user-context or project file creates it again.
- **Change feed.** A lost connection shows Reconnecting and resumes after the last record applied, so no record is applied twice or skipped. A malformed stream, a gap in the records, or a refused request shows Updates stopped with **Retry**. Retry follows again from the current position and re-reads the trees, keeping the open tabs and their drafts. While updates are stopped, saves remain guarded by revisions.
- A failed listing, find, history page, file read, or dialog action shows the backend's message. Listings, reads, and history offer Retry; a dialog stays open with its input. A missing or unreadable workspace folder shows the backend's message with Retry. A file the backend cannot serve as text shows the backend's reason instead of content. A workspace that the backend does not know shows that message and a link back to the conversation list; a lead whose record cannot be read shows the error beside the composer rather than a model choice that could overwrite it.

## Guarantees and limits

- The frontend keeps backend Pi payloads and runtime metadata in the agent client. Only the adapter converts them into assistant-ui data.
- Completed history and transient live output remain distinct; current run and connection state are distinct from both.
- The model picker uses backend-listed choices. It never infers models, protocols, or reasoning levels solely from a provider name.
- Composer settings are edits to persistent agent config, not per-message overrides. An active run keeps its start-of-run config snapshot.
- Provider credentials are write-only from the frontend's perspective. The read view shows only whether a key is configured.
- The frontend never binds an agent to a workspace. A workspace's conversation is its lead's, a solo conversation has no workspace, and the panel shows only the workspace in the address.
- The frontend changes no team member except the lead's run settings, which the user chooses in the composer. It creates, changes, and retires no other member, and shows only the lead's conversation.
- The frontend never changes agent context. It changes user context only through the user's saves, moves, deletes, and restores, and project files only through the user's saves. Every save of an existing file names the revision it is based on.
- File content is shown as text or rendered from Markdown without raw HTML, so a file cannot add markup or scripts to the page.
- The frontend uses the workspace and context-base APIs and adds no other backend data entity. Exact animations, widths, icon artwork, local sidebar preference persistence, search ranking, model-list pagination, and Markdown styling are presentation details.
- Limits in this revision: a workspace has one lead conversation, which only grows; workspaces cannot be renamed or removed; other members' conversations are not shown; the team view updates by reading, not by a live feed; open tabs are not remembered after the workspace page is left or the page reloads, and cannot be reordered; the Markdown described above, without footnotes, task lists, math, or embedded HTML; no content search, proposals, or agent-context editing; project files without live updates.

## Acceptance examples

1. **Collapse navigation:** with a conversation open, the user collapses the Conversations sidebar. The icon rail and conversation remain; reopening the sidebar highlights the same conversation.
2. **Start a conversation:** New conversation creates an agent, opens its empty history, and asks for a model. No run begins until the user sends input with a valid saved config.
2a. **Add a workspace:** Add workspace with a name and a new folder registers the workspace and opens its page. The lead's conversation is empty and asks for a model; the sidebar lists the workspace under Workspaces and not under Conversations. After the user picks a model, sending a message starts the lead's run.
2b. **See the team:** the user opens the panel on a workspace page. The Team tab lists the lead, Idle. After the lead creates Backend and calls it, reopening the tab, or waiting a few seconds, shows Backend Working, then Idle when the call returns. The lead's conversation shows a **→ Backend** card with the text sent and, when it returns, Backend's final response, and nothing of Backend's steps.
2c. **Busy lead:** while the lead waits for Backend, Send is unavailable and Stop is offered. Stop ends the lead's run and Backend's. A message sent from another window is refused with the backend's busy message.
3. **Choose a duplicate model name:** two connections expose the same model label. The picker shows both with connection labels; selecting one saves the correct connection ID and model ID.
4. **Choose reasoning:** every reasoning model shows five stops starting at Off, with Off as the default; selecting High saves `high`, never an intermediate number. On DeepSeek V4 Pro (Pi levels `off, high, max`), choosing Medium shows “Sent as High” and XHigh shows “Sent as Max”. A non-reasoning model shows “No reasoning”. Opening the picker writes nothing.
5. **Switch and switch back:** in one conversation the user sets model A to High with a 64k output limit, switches to model B, and sets it to XHigh. B starts from its own defaults; returning to A shows High and 64k again. No conflict prompt appears.
6. **Edit a provider:** the edit dialog shows that a key is configured but not its value. Saving with the key field blank retains it; replacing it sends the new key once and the resulting page still shows only configured status.
7. **Reconnect mid-run:** the frontend removes stale partial chunks, synchronizes stable messages, and resumes available live output or waits for the completed record.
8. **Open Config during a run:** provider edits do not alter the active run. Returning to Conversations synchronizes its history and follows the current run when possible.
9. **Separate conversations:** two conversations use model A. Changing A's reasoning in one leaves the other's A settings unchanged.
10. **Fold rarely changed settings:** opening the popover shows the model and reasoning slider with More settings folded. Expanding it shows Default for maximum output, temperature, and context budget; setting a temperature saves it for this conversation's model, and the folded row then indicates one customized value.
11. **Open the panel during a run:** the user selects Show team and files at the right of the workspace page's header. The panel slides in on the right while the run continues, with the Team tab active. Hide closes it, and reopening it shows the same open tabs.
12. **Write user context:** the user adds a file in User context, keeps the path `user/goals.md`, and types a heading in Text. Save stores it. Preview shows the heading, and the User context count rises by one. The status stays Live.
13. **Outside edit:** the user changes the open, unedited `user/goals.md` in an editor. Within about a second the viewer shows the new content as changed on disk.
14. **Concurrent edits:** the user edits `user/goals.md` in two browser tabs and saves in the first. The second browser tab offers Load latest or Save mine over it. If the second tries to save first, it is told the file was not saved.
15. **Read agent context:** `agent/design/overview.md` opens in Preview. Its Text is read-only, and it offers no Save, Rename, or Delete.
16. **Restore:** from the history of `user/goals.md`, the user selects an earlier version and restores it. It becomes the current version with a reason naming its time, and the history still lists every version.
17. **Edit a project file:** the user finds `readme`, opens `README.md` from the Project matches, edits it, and saves. A binary file shows the backend's reason that it cannot be shown.
18. **Follow a link:** in the preview of `user/notes/plan.md`, the link `../goals.md` opens `user/goals.md`. A link to `https://example.com` opens a new tab.
19. **Two workspaces:** the user adds a second workspace and opens it. Its page has its own lead conversation, and its panel shows its own team and files. Going back to the first shows the first lead's history, and its open tabs are not shared with the second.
20. **Work in tabs:** the user opens `user/goals.md` and `README.md`. Both have tabs; the viewer shows the active one with the breadcrumb `Project › Context base › user › goals.md` for a workspace named Project. Editing `goals.md`, switching to `README.md`, and switching back keeps the draft. Closing the `goals.md` tab asks to discard it.
21. **Leave with unsaved edits:** with a draft in an open tab, the user picks another workspace or a solo conversation. A dialog asks to discard the changes; staying keeps the draft, and Discard and leave opens the other page.
22. **Expand and hide the tree:** Expand widens the panel over the conversation, and Restore returns it. The tree toggle hides the tree column so the viewer takes the panel's width; Open a file shows the tree again with the cursor in the filter.
