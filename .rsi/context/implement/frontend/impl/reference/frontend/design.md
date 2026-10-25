> Existing behavior reference inside the aggregate implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

# Frontend system

## Purpose and boundary

The frontend lets a user:

- add a workspace, converse with its team in shared group chat, inspect folded member work, and configure workspace model choices/default, inspect active members and review member configuration changes;
- read the current project designs and their implementation mappings, inspect members and their harnesses, and view and edit the workspace's files: its context base and the project's own files;
- open a conversation with an agent that belongs to no workspace, follow its run, and choose its model and reasoning;
- manage the provider connections from which models are available.

It uses a light, restrained layout with a compact navigation rail, a contextual secondary sidebar, a large content area, and, on a workspace page, a panel that slides in from the right and holds current designs, the team and files. The frontend does not own the agent's model-facing context or change the backend's one-history-per-agent identity.

A **workspace** is a registered project with one shared group chat and a team containing its lead. User messages and accepted member final responses form shared communication. Each member keeps its own private working history, inspectable by the user inside a folded section. A **solo conversation** belongs to one agent outside a workspace and keeps its existing private conversation behavior.

The backend owns execution, durable group history and response ordering, private history, model context and file authority. The frontend reads these through APIs. Its group client reconciles persisted entry updates; its solo client and assistant-ui adapter handle private solo conversations. Config and workspace clients own settings and Design/Team/Files operations, including separate member configuration review and user commit/activation controls.

## Inputs and preconditions

- The backend supplies the registered workspaces; for each, a team of members, with the lead first; a list of agents that belong to no workspace; a persisted group timeline with immediate member reservations, immutable final references and working ranges; private history per agent and a sync-then-follow operation for a run; agent config records for solo agents with revisions and validation issues; provider connection records; and model choices for each connection.
- A team member has a name, role, responsibility, working/dependency design references and an effective execution policy, run settings, a revision, issues that stop it from running, and whether it is running now, as the [Team design](../../../../backend/core/team/impl/reference/workspace-agent/team/design.md) defines. Each member ID also identifies its private execution history.
- A model selection is identified by both the provider connection ID and model ID. Names and model IDs alone need not be unique across connections.
- A connection includes its display name, provider, request protocol, endpoint URL, and whether a key is configured. The API key is write-only to the backend; read responses do not contain it.
- A model choice supplies its display label, its reasoning levels (the shared scale `off, low, medium, high, xhigh` for reasoning models, none otherwise), the level each scale step is actually sent as for that model, its effective default level, maximum output, context window, and whether its metadata is verified. A listed model is an available choice, not proof that a credential can invoke it.
- A solo agent's config holds the selected model and a separate settings entry per model for that conversation: reasoning, maximum output tokens, temperature, and context budget. Each member’s run settings hold the same fields, as the [Config design](../../../../backend/core/team/impl/reference/config/design.md) defines, and come from stable active backend configuration. Member-file acceptance does not activate settings; the backend offers separate user-controlled idle activation. A separate Changes tab provides explicit user commit and activation controls; active-member details remain read-only. Omitted values use the model's defaults. Existing configs may also contain prompts and tools; this UI revision does not expose editors for them and preserves their saved values.
- For solo conversations, sending a message supplies user input only. The backend resolves a copy of the agent's saved config at run start and constructs the model request from its own context history. Edits made during a run take effect from the next run.
- The backend supplies a current design catalog with valid user-design summaries, independent of membership and explicitly marked when truncated, plus current selected design content or an invalid-record issue.
- The backend supplies registered workspaces and their project files as the [Workspace design](../../../../backend/core/workspace/impl/reference/workspace-agent/workspace/design.md) defines, and each workspace's context base as the [Context base design](../../../../backend/core/workspace/impl/reference/workspace-agent/context-base/design.md) defines. Both include listings, reads, saves guarded by revisions, and find. The context base also supplies moves, deletes, history, and an ordered change feed. Design and metadata files are writable through the frontend; implementation context is read-only.

## Outputs and observable effects

### Navigation and page layout

- The fixed first-level rail has two destinations, **Conversations** and **Config**. Each icon has a text tooltip and accessible name. The active destination remains visibly marked even when its secondary sidebar is collapsed.
- Selecting a destination opens its secondary sidebar. Selecting the active icon again collapses that sidebar while leaving the current page visible. The rail remains available. The sidebar's open state is a view preference; the selected destination and conversation remain addressable through the URL and browser history.
- Returning from Config to Conversations reopens the previously viewed conversation when one has been selected in this browser session.
- On a narrow screen, the secondary sidebar appears over the content and can be dismissed without losing the current page. On wider screens it occupies space beside the rail. Opening or closing it does not cancel an agent run or reset a composer draft.
- A workspace page has a **Show design, team and files** button at the right of its header, shown while the panel is closed. It opens the panel on the right of the conversation; the panel's own bar has the buttons that close it and that expand it. The panel is not a destination: it changes neither the route nor the left sidebar. A solo conversation has no panel and no such button.
- The address names the page: `?workspace=<id>` for a workspace, `?agent=<id>` for a solo conversation, and `?page=providers` for Config.
- On wide screens the panel takes space beside the conversation, and **Expand** widens it over the conversation's space until **Restore** returns it. On narrower screens it slides over the page, clicking outside it closes it, and Expand widens it to the whole width beside the rail. On the narrowest screens it covers the page beside the rail, opening it collapses the left sidebar, and Expand is not offered.
- Closing the panel keeps its open files and unsaved edits for the next time it opens. Whether the panel is open and expanded carries over when the user moves to another workspace; its contents belong to each workspace. Opening, closing, or expanding the panel does not cancel an agent run or reset a composer draft.
- The conversation view gives message content the main area, keeps the composer at the bottom, and keeps navigation chrome subdued. Long messages and tool content remain readable without widening the navigation rail.

### Conversations destination

- The secondary sidebar has two sections that are not nested: **Workspaces**, with an **Add workspace** action and the registered workspaces ordered by name, and **Conversations**, with a **New conversation** action and the solo agents. Each entry opens its page. A solo agent is listed by its saved name, or a neutral short-ID fallback. Neither list claims to be sorted by recent activity because the backend does not provide activity time. The sidebar does not list team members.
- **Add workspace** opens a dialog for a name, an absolute folder on the backend's machine, and a choice between creating a new folder and using an existing one, and workspace model choices with a default. On success it opens the new workspace, whose lead is initialized with that default. A refused request keeps the dialog open with the backend's message.
- A solo conversation may be renamed from its sidebar entry by editing the agent's saved name, preserving every other config field. The UI does not offer deleting or renaming workspaces or deleting conversations in this revision because the backend has no operation for them.
- **New conversation** creates a backend agent and initializes its config with empty optional fields. It opens immediately, shows the model choices needed before sending, and starts no run on creation. If app config disallows agent creation, the action is disabled and explains why.
- The main area shows the selected conversation's visible message history and current run state. Opening, refreshing, or reconnecting synchronizes completed history before following available live output. Leaving and returning to a conversation does not cancel its run.
- A workspace page opens shared group chat. Inspect member models and configure workspace model choices in Team. The composer can address free members while others work; refused busy/unready mentions preserve the draft. Stop team cancels current group work.
- Leaving a workspace page, by the sidebar, the rail, or the browser's back and forward, while one of its open files has unsaved edits first asks to discard them. Staying keeps the conversation, its files, and the edits.

### Config destination and Providers page

- Config's secondary sidebar is headed **Providers** and lists configured connections as shortcuts into the overview. It creates no extra config page. The main page is a provider overview, not a generic catalog form. App Settings, prompt templates, tools, and advanced agent configuration have no visible editor in this navigation; their saved backend data remains intact.
- The overview shows every configured connection as a spacious card in a single readable column. One card represents one backend connection, even when several connections use the same provider. Its header shows the display name and actions; its body shows provider, request protocol, endpoint URL, key-configured status, and model availability where the backend has returned a model list. Its read-only model choices and metadata expand beneath the summary. The page has clear empty, loading, and read-error states.
- Each connection offers actions to edit, refresh its model choices, and delete. **Add provider** and **Edit** open a focused dialog rather than expanding an inline general form. The dialog edits display name, provider, request protocol, endpoint URL, and API key. For edits, the key field starts blank and means “keep existing”; replacing or explicitly clearing the key are distinct actions. The dialog explains protocol-specific URL expectations.
- Provider presets may prefill provider, protocol, and endpoint, but all saved values remain reviewable before submission. Refresh attempts endpoint model discovery. The page distinguishes Pi-known models from endpoint-discovered models and indicates unverified metadata. A refresh failure leaves the connection and any previously saved choices visible when still applicable.
- Delete asks for confirmation and explains that agents using the connection will need another model before their next run. The page never displays a raw API key. After a successful add, edit, refresh, or delete, the overview uses backend results rather than pretending a request succeeded before confirmation.

### Solo composer model and reasoning controls

- The composer contains one compact trigger showing the selected model and reasoning state. With a selected model, opening its popover shows a compact model button and reasoning control; the full model list starts collapsed. Clicking that model expands the list to switch models. With no selected model, the list opens directly. The list includes models from **all** configured connections, grouped or labeled by connection. It does not require a provider selection step. A selected row has a checkmark; duplicate model names remain distinguishable by connection label. An unavailable saved choice is shown as unavailable rather than silently replaced.
- A search icon at the top of the popover reveals or hides the model search field; the field starts hidden. Revealing search also expands the model list. Selecting a model saves its connection ID and model ID, then folds the list back to the compact view.
- Model-call settings are per conversation and per model. The popover always shows and edits the selected model's settings for this conversation. Switching models shows that model's own saved settings, or its defaults if this conversation has none; switching back restores the earlier model's settings. Another conversation's settings for the same model are unaffected. Because each model has its own settings, a model switch never asks to reconcile or clear values.
- The reasoning control is a compact stepped slider with the same five stops for every reasoning model: Off, Low, Medium, High, XHigh. It has a slim pill-shaped track, a blue filled portion with subtle sparkle dots, a round white thumb, and small dots marking the unfilled stops. The current level's name appears prominently in the header button above the model name. With no saved level, the slider shows Off without writing it. Dragging or keyboard adjustment saves the named level when the interaction finishes. When the selected model does not support the chosen level, a small “Sent as …” note under the slider names the level actually sent. A model without reasoning support shows “No reasoning” instead of a slider. The slider never sends an arbitrary numeric value.
- Below the slider, a **More settings** section edits maximum output tokens, temperature, and context budget for the selected model. These change rarely, so the section is folded each time the popover opens, and each field defaults to unset. When folded, it indicates how many of the selected model's values are customized. When expanded, each unset field reads Default with the model's limit (maximum output and context window, or 0–2 for temperature), and each customized field can be cleared back to Default. Its edits are staged and applied as one update for that model; invalid values are explained before saving. Context budget is labeled as saved for future context management.
- Choosing a model, reasoning level, or More settings change persists it for this conversation's later runs once the save succeeds. During a run, a changed choice is labeled as applying to the next run. In a solo conversation, Send is unavailable while a model or settings change is unsaved, saving, failed, or invalid, or while the selected model's saved settings no longer fit it. The composer does not offer provider selection.
- Workspace active-member details show active member model settings read-only. Workspace models controls edit initialization choices/default; group-chat avatars edit user-owned member model preferences. The lead chooses initial member models through configuration files. Active runs keep their starting settings.
- On opening the picker, the frontend refreshes the connection list and model choices. Config writes use the revision last read. A stale revision requires reviewing the latest stored value before saving; the UI does not overwrite another edit without review.

### Conversation synchronization and display

| Trigger or input | Client effect | Display effect |
| --- | --- | --- |
| Open or refresh a conversation | Synchronize completed records, then follow an active run if present. | Show whole completed messages before live updates. |
| Reconnect | Discard previous partial messages and resynchronize completed history. | Replace stale partial output with current records and reconstructible live output. |
| Send input | Submit user input, then follow that run through the backend operation. | Show backend-accepted messages and subsequent output. |
| Receive a compact progress frame | Update the corresponding partial Pi message by backend identity. | Update one displayed message in place. |
| Receive a completed record | Reconcile it with history and remove a partial with the same identity. | Show the whole message once. |
| Encounter a missing chunk range | Discard the affected partial. | Show the completed record when it becomes available. |
| Receive run completion | Apply final updates and finish following. | Preserve history and final run state. |

The Design view exposes accepted designs; Team displays active members. Changes reviews pending design and member files with independent approvals and separate member activation. General design-version history UI remains deferred. Existing generic file history remains available.

### Workspace group chat

- Every accepted activation immediately reserves a member response section in backend-defined order. Its work updates there and its accepted final fills that same section. Parallel completion, later input and reload never move it. Refused messages create no entries.
- User input appears in a subtle bubble on the right with left-aligned text. Each member run has an open response area with no background, enclosing border or shadow; both header pills sit above a thin light divider exactly on the response area’s top edge, without crossing the avatar gutter. The member avatar keeps the same top-edge reference and fixed center rule as the user avatar beside its bubble. With work folded, the first paragraph or heading line is vertically centered on the member avatar, including when that line wraps into a longer message. A member avatar and name beneath it sit in the left outside gutter; the complete response uses a centered, constrained reading column within the padded response area; the complete Markdown final fills that column, with horizontally scrollable code/tables. User avatars sit outside their right-aligned bubbles on the right, with their identity name beneath; the prototype uses You. Input bubbles contain only the submitted message text. Their right edge aligns with the member response area’s right edge; both avatars use smaller visible circles scaled around their established one-line-reference centers, with equal gaps to the message. A single-line bubble and its avatar retain the same vertical center; longer messages retain that anchor near their start. Message and name positions stay fixed as avatars shrink. The composer aligns with the reading column, which shrinks for narrower panes.
- Compact capsules sit above the response area with their row’s left edge aligned to its left edge; they show run information: one passive tag for status, duration and start time, and an adjacent Work button with a standard chevron. The borderless status tag uses a muted green fill/text for completion, muted red for failed/interrupted runs and neutral gray otherwise. Duration and start time stay muted gray. Work has a transparent neutral background and faint gray border, with subtle hover and expanded fills and a visible keyboard focus ring. Both use matching small capsule geometry and center their content vertically; they wrap on narrow panes. The header has no tinted band. The response area’s top divider remains below the pills and above expanded work, without moving when work expands. Status words remain visible alongside these semantic colors. Only the Work button expands private work by click or keyboard; its chevron points right folded and down expanded. Work starts expanded for an active run. Text streams in one ordered activity flow with collapsible tool sets, while thinking remains hidden. Accepted final publication folds earlier work once and leaves the final report fully visible. Reopening Work shows earlier text, tools and refused candidates from only this activation, excluding accepted final text. Manual collapse does not stop active observation. Completed runs start collapsed on reload and load private history on demand.
- Enter sends; Shift+Enter adds a newline. @ suggestions list members and availability. User drafts remain editable during work. No mention routes to Lead; explicit mentions select those members. Server admission validates readiness and busy recipients.
- A rejected send preserves its draft/reference and shows the backend reason beside the composer. An accepted send clears only the submitted draft/reference, preserving edits made while submitting.
- Stop team requests cancellation of current group work. Failed, cancelled and interrupted activations retain their positions, status/error and recorded work without a fabricated final response.
- Group observation remains open between activations and reconnects from the last contiguous change cursor. Display position and synchronization cursor differ: completion of an older response must be applied. POST and feed duplicates do not duplicate entries; older acknowledgements cannot replace a newer final.
- Solo follow streams keep their existing run-scoped behavior. Group private inspection uses the same stable Pi record protocol, without sharing traces with colleagues.
- Old prototype group history is imported in original publication order. New activations use reservation order.

### Workspace panel

- **The workspace.** The panel always shows the workspace of the page it belongs to; the workspace is known from the address, so the panel never asks for one. It loads nothing until it is first opened.
- **Layout.** The panel has permanent Design, Team, Changes and Files tabs, followed by open file tabs and panel controls. Design is selected on first opening and after the last open file closes. The file tree is available through Files and a tree toggle; it starts hidden so the design or member content has room. Files opens the tree and lets the user open files or reveal directories. Narrow screens preserve the existing overlay behavior; Discuss with lead restores the conversation when the panel covers it.
- **Design view.** It lists every discovered valid user-context design record, including those without assigned members. Paths organize the list; a first Markdown heading can label the current design, otherwise the file name is used. Selecting a design renders its current Markdown content and lists corresponding implementation files/directories with navigation links. It shows members configured with that design as working, and those using it as a dependency, each linked to its active member details. No member assignment is required for the design to remain visible. The view is read-only and has Discuss with lead; it has no version or diff controls.
- **Current updates.** Context change notifications and window focus refresh the design catalog and current selected design. Successful design refresh also rechecks member readiness so an invalid or missing design appears in its member issues. A renamed/deleted/invalid design is displayed with its current issue rather than old content. An explicit Refresh handles recovery; truncated discovery is labeled. Missing or unreadable selected references show the backend reason. A design list failure keeps previously loaded information with a visible error, without claiming it is live.
- **Discuss with lead.** A design or member action adds a removable reference to the group composer without sending a message or discarding typed text. The next user-submitted message includes that reference in its text. It works while members are busy, but submission follows the normal busy/readiness rules. A successful accepted submission clears its reference; a refused submission preserves it. References belong to their workspace and reset when leaving it.
- **Team view.** A member tree follows the folders of the current accepted design catalog. It displays active members at their working designs, with avatar, name, role and responsibility. Hover or focus on an avatar previews active scope/harness information; clicking it opens the selected member's full active information in the right panel. Configuration changes are reviewed in a separate view. The [member display contract](#member-tree-active-details-and-configuration-changes) defines the three information levels and their separation.

  The user edits workspace model choices/default through Workspace models and discusses member proposals with the lead. Team reads refresh on group updates and focus, every three seconds during team work, and when work ends. Failed reads show Retry and retain the last team shown with an error indication. Opening or navigating the tree, preview or details never starts a member run.
- **Trees.** The tree shows two sections:
  - **Context base**: the single **Project context** tree with its aggregate file count; implementation-context files are read-only. A status shows whether changes arrive live: Connecting, Live, Reconnecting, or Updates stopped. Files the backend cannot serve are listed, folded, with the reason for each.
  - **Project**: the workspace folder's files, as the backend lists them, with a refresh action.

  Folders open and close in place and load their entries when first opened. Folders come before files. A truncated listing says how many entries it shows. User-context entries offer new file (folders only), rename or move, and delete. Project folders offer new file. Agent-context entries offer no changes.
- **Find files.** A filter field finds paths containing the text, without regard to letter case, in both the context base and the project. While it has text, the trees give way to the matches, grouped by source with their counts. Opening a match opens the file and reveals it in its tree.
- **Tabs.** Opening a file from the tree, a match, or a link activates its tab, adding a tab if the file is not open yet. Several files may be open at once, and each tab keeps its own view, draft, and history state while another tab is active. A tab shows the file name, a marker when it has unsaved edits, and its location on hover. Its × button, or a middle click, closes it, and the next tab becomes active. Closing a tab with unsaved edits first asks to discard them.
- **File viewer.** The viewer's header shows the file's location as a breadcrumb: the workspace name, **Context base** for a context file, the folders, and the file name, with the unsaved-edits marker. Icon actions follow on the right: Preview and Text for Markdown, history for a context file or Reload for a project file, Copy, and, for a user-context file, Rename and Delete. Save and Discard appear while there are unsaved edits. A footer shows:
  - when the file was last updated and its size;
  - for a context file, who changed it last (in the app or on disk) and the reason, if any;
  - whether it is read-only.

  Markdown files (`.md`, `.markdown`) open in **Preview** and can switch to **Text**. Other files show only Text. **Copy** copies the shown content.
- **Preview** renders headings, paragraphs, emphasis, strikethrough, inline and fenced code, quotes, nested and numbered lists, tables, rules, and links. Raw HTML is shown as text, and an image shows its alt text. A relative link opens the file it names in the same tree. It never leaves the context root for a context file, or the workspace for a project file. Web and mail links open in a new tab. Other links do nothing.
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

- Completed group and private records are independent of mutable model context. Compaction does not change the displayed history or referenced final answers.
- Group ordering and lifecycle state come from backend persistence. Private run activity is streamed separately and never added to shared communication by the UI.
- Member color is stable by identity; names are readable and retain their publication attribution. Color alone does not convey identity.
- Model choices come from backend metadata. Settings are persistent per solo agent or member and per model; active runs keep their start configuration. Provider keys are write-only.
- Workspace model saves preserve existing member selections, identity, responsibility and harness. Member configuration/design changes are discussed with the lead. The frontend never changes model context or agent-context files.
- Workspace user-context/project edits use explicit revisions. File content is plain text or safely rendered Markdown without raw HTML execution.
- One group chat per workspace. No design-version UI, group attachments/edit/delete, automatic retry of refused publications, or automatic harness-context maintenance. Team readiness is refreshed on group updates, focus and every three seconds while team work is active.
- Full final reports have no excerpt/crop. Long histories remain loaded in the current page; initial group replay is paged by the backend but no transcript virtualization is promised. Existing file-tab persistence and supported Markdown limits remain.

## Acceptance examples

1. **Collapse navigation:** with a conversation open, the user collapses the Conversations sidebar. The icon rail and conversation remain; reopening the sidebar highlights the same conversation.
2. **Start a conversation:** New conversation creates an agent, opens its empty history, and asks for a model. No run begins until the user sends input with a valid saved config.
2a. **Add a workspace:** Add workspace with a name and a new folder registers the workspace and opens its page. The group chat is empty; the lead uses the selected workspace default and workspace model settings are available in Team; the sidebar lists the workspace under Workspaces and not under Conversations. After a member is configured, accepted input reserves its response and displays its final in place.
2b. **See the team:** the user opens Team and sees active members organized by working design folder hierarchy. Hovering an avatar previews active scope/harness information; clicking opens full active details. Proposed changes are reviewed and approved in Changes and enter the active tree after successful user activation. Shared final responses and folded work remain in group chat.
2c. **Observe a working lead:** while members are working, the user may address free members. Busy mentions are refused without losing the draft. Stop team cancels current branches.

3. **Choose a duplicate model name:** two connections expose the same model label. The picker shows both with connection labels; selecting one saves the correct connection ID and model ID.
4. **Choose reasoning:** every reasoning model shows five stops starting at Off, with Off as the default; selecting High saves `high`, never an intermediate number. On DeepSeek V4 Pro (Pi levels `off, high, max`), choosing Medium shows “Sent as High” and XHigh shows “Sent as Max”. A non-reasoning model shows “No reasoning”. Opening the picker writes nothing.
5. **Switch and switch back:** in one conversation the user sets model A to High with a 64k output limit, switches to model B, and sets it to XHigh. B starts from its own defaults; returning to A shows High and 64k again. No conflict prompt appears.
6. **Edit a provider:** the edit dialog shows that a key is configured but not its value. Saving with the key field blank retains it; replacing it sends the new key once and the resulting page still shows only configured status.
7. **Reconnect mid-run:** the frontend removes stale partial chunks, synchronizes stable messages, and resumes available live output or waits for the completed record.
8. **Open Config during a run:** provider edits do not alter the active run. Returning to Conversations synchronizes its history and follows the current run when possible.
9. **Separate conversations:** two conversations use model A. Changing A's reasoning in one leaves the other's A settings unchanged.
10. **Fold rarely changed settings:** opening the popover shows the model and reasoning slider with More settings folded. Expanding it shows Default for maximum output, temperature, and context budget; setting a temperature saves it for this conversation's model, and the folded row then indicates one customized value.
11. **Open the panel during a run:** the user selects Show design, team and files at the right of the workspace page's header. The panel slides in on the right while the run continues, with Design active. Hide closes it, and reopening it shows the same open tabs.
12. **Write design context:** the user adds a file in Project context, keeps the path `design/notes.md`, and types a heading in Text. Save stores it. Preview shows the heading, and the Project context count rises by one. The status stays Live.
13. **Outside edit:** the user changes the open, unedited `design/notes.md` in an editor. Within about a second the viewer shows the new content as changed on disk.
14. **Concurrent edits:** the user edits `design/notes.md` in two browser tabs and saves in the first. The second browser tab offers Load latest or Save mine over it. If the second tries to save first, it is told the file was not saved.
15. **Read agent context:** `backend/impl/README.md` opens in Preview. Its Text is read-only, and it offers no Save, Rename, or Delete.
16. **Restore:** from the history of `design/notes.md`, the user selects an earlier version and restores it. It becomes the current version with a reason naming its time, and the history still lists every version.
17. **Edit a project file:** the user finds `readme`, opens `README.md` from the Project matches, edits it, and saves. A binary file shows the backend's reason that it cannot be shown.
18. **Follow a link:** in the preview of `design/topics/plan.md`, the link `../notes.md` opens `design/notes.md`. A link to `https://example.com` opens a new tab.
19. **Two workspaces:** the user adds a second workspace and opens it. Its page has its own shared group chat, and its panel shows its own team and files. Going back to the first shows the first group history, and its open tabs are not shared with the second.
20. **Work in tabs:** the user opens `design/notes.md` and `README.md`. Both have tabs; the viewer shows the active one with the breadcrumb `Project › Context base › design › notes.md` for a workspace named Project. Editing `notes.md`, switching to `README.md`, and switching back keeps the draft. Closing the `notes.md` tab asks to discard it.
21. **Leave with unsaved edits:** with a draft in an open tab, the user picks another workspace or a solo conversation. A dialog asks to discard the changes; staying keeps the draft, and Discard and leave opens the other page.
22. **Expand and hide the tree:** Expand widens the panel over the conversation, and Restore returns it. The tree toggle hides the tree column so the viewer takes the panel's width; Open a file shows the tree again with the cursor in the filter.

22. **Current design.** Open the workspace panel: Design is selected. Choose the backend design, read its rendered content and open a corresponding implementation file. No history or comparison is shown in Design.
23. **Relationships.** Select a design's Backend member: Team selects its avatar and opens full active details. Select its dependency design: Design opens the current dependency. Retiring Backend leaves the design in the catalog.
24. **Discussion.** Type a question, then choose Discuss with lead for a design. The composer preserves the question and shows the reference. Remove it or send explicitly; no automatic run starts. A failed send keeps the reference.
25. **Current failure.** A selected design is deleted or becomes invalid: show that condition and a read-only issue. Do not render the previous content as current.

26. **Reverse completion:** Backend and Frontend receive one accepted message. Both sections appear immediately; Frontend finishing first leaves it after Backend’s reserved section. Reload reproduces that order.
27. **Failure and inspection:** cancel a member with intermediate work. Its section shows Cancelled with inspectable activity; no final response is invented. A private-history error offers local retry and keeps completed reports readable.

## Workspace models and member inspection

Creating or adopting a workspace requires selecting its model choices and a default before submission. Provider/model discovery comes from configured providers. The same workspace models editor can update choices/default with revision protection from the Team view. Unsaved/error states remain visible; invalid choices are not silently replaced. A missing provider list explains how to configure providers. A default change affects future initialization; the editor explains that existing selections remain. A legacy unconfigured lead becomes usable when workspace models are saved.

Member details are read-only and loaded from active member inspection. Show model/run settings, Management/Implementation/Execute tools, scope and rules, supplementary prompts and the exact active manifest/prompt files. Pending or committed-but-inactive configuration and change operations belong to the separate Changes tab. Group-chat avatars offer user model settings through the dedicated model-only API; member lifecycle, prompt, responsibility and scope edits remain file-based. Workspace model editing and provider configuration remain available. Existing Design/Files review behavior is retained.

## Unified streaming and model completion

Workspace group chat follows each active run from stored history and in-memory progress and displays text plus collapsible tool sets in order, with thinking hidden. After accepted final identity arrives, it folds earlier work once and keeps the complete final report visible in the reserved section. Tool-only responses extend consecutive tool sets; visible text separates them. The child group-chat design owns presentation details.

## Member tree, active details and configuration changes

### Tree organization and member nodes

The Team view follows the design files' folder hierarchy. Folders and files form a conventional expandable file tree; member information cards attach to the right of the corresponding design nodes. The workspace root includes the lead card. Folder/file names remain the tree labels; member scope, avatar, name, role and responsibility appear in the attached cards. This is the folder structure of the current accepted design catalog, not an inferred parent/subdesign relation from Markdown content. No new parent-member or parent-design field is required.

Working design assignments determine member placement. Dependencies are shown in previews/details and do not create additional ownership positions. A member assigned several working designs appears at each applicable position; all occurrences retain the same identity and open the same active details. Several members assigned one working design appear together at that position. Designs with no assigned members remain visible with an unassigned indication. Members with no working designs, including a bootstrap lead, appear at workspace level. The lead appears at the workspace root for project-wide management; member placement beneath it continues to follow design folders, without introducing a reporting hierarchy or new ownership grants.

Each attached member card shows its design scope, avatar, name, role and responsibility. A short responsibility preview may use at most two lines, with full content available in active details. An activity/readiness indicator stays secondary to member identity. Activity updates do not reorder the hierarchy. Pending new members do not appear as active members; they are visible in Changes until activated. Catalog truncation, unresolved design references and read failures are shown explicitly, and members with unavailable references remain reachable rather than silently disappearing.

### Avatar hover preview

Hovering or keyboard-focusing an avatar opens a compact preview of active member information: activity/readiness, working designs, dependency designs and the Management/Implementation/Execute harness configuration. Scope summaries describe relevant implementation read/write access, the fixed broad Bash/network policy and commit policy. Long path lists may be summarized; full rules, supplementary prompts, source files and exact details remain available in full active information. Color is supplementary and does not replace readable member identity or status.

### Avatar click and full active information

Clicking an avatar opens that member's full active details in the right panel; keyboard activation provides the same action. On touch devices, tapping opens full details directly. Folder expansion and opening member details are distinct controls; browsing or opening details starts no work and changes no configuration.

Full details show identity, role, complete responsibility, activity/readiness issues, model/run settings, working/dependency designs, derived implementation permissions, each harness's tools/rules/scope/commit policy, supplementary prompts and exact active source files. Technical source metadata may be folded. Design and implementation links retain existing navigation, and Discuss with lead remains an explicit composer-reference action.

This view contains active information only. It does not contain pending configuration, commit history since activation, configuration diffs, Commit or Activate actions, or an embedded Changes tab. A changed pending or committed file does not replace any active detail before successful activation.

### Unified Changes tab

Changes is a permanent panel tab outside Team, with a flat design/member file list and unified committed-to-current text diffs. It has no scope approval buttons. Selecting a file changes only the diff; errors/truncation are explicit.

An explicit protected Git commit opens a compact decision input above the composer. Accept executes its exact candidate; Deny or Send feedback skips execution and returns the decision to the agent. Review opens commit details/diffs in the right panel. The popup contains no diff. Activate members remains a separate Changes action for valid committed configuration and requires the entire team idle. Stale/busy/invalid results preserve active state.

Acceptance: propose a child design and member configuration, stage their files and request a protected commit. Review opens the right-panel diff; Accept commits but activates nobody. Activate members applies valid committed configuration only when idle, leaving newer pending edits pending.

## Initialized workspace

After successful create/adopt, Design already shows metadata.json and Team shows the lead assigned there (also represented at the workspace root). Initial configuration review is clean and active; bootstrap does not require the user to commit or activate it. Empty group chat remains empty. Paths in discussion references and configuration file review use the managed .rsi/context and .rsi/members layout; logical context paths are relative to the single context root.

## Unified system context tree

Files presents one project-context tree with aggregate file count, alongside project files. Its actual roots are design/ and implement/; they are purposes rather than user/agent ownership groups. Existing file preview/edit/history/search and conflict behavior remain. Raw context editability follows the first purpose segment: design/ writable, implement/ read-only. Topic names inside documents do not change that rule. Backend refusal is authoritative for mixed folder operations.

Design catalog and member assignments identify systems by metadata.json paths; labels use the system folder (Project for root). design/ and impl/ document folders do not become systems or extra member rows. Active member cards follow system folder hierarchy, with root assignments on the workspace row. Current Design view displays each returned Markdown document, entry first, with source labels when there are several. Relative links resolve against each actual document path and can open other context files. Document-only changes refresh the catalog/view through the existing context feed. JSON metadata contains mappings only; Markdown holds all document content. Single-file and multi-document systems remain the same node.

## Group avatar model settings

Hovering over, focusing or clicking an active member avatar in group chat opens an interactive model picker. It remains open while using its controls and closes on Escape, outside click or leaving the avatar/panel. The panel uses the existing composer controls for provider/model selection, per-model reasoning, maximum output tokens, temperature and context budget. Opening it writes nothing. Model and reasoning save on selection; the additional options use Save/Discard. Colors and avatar geometry remain unchanged. Historical retired members cannot be configured.

Settings belong to that member, persist through reload and apply to its next run. In-flight runs retain their prepared configuration. Errors are visible and stale revisions require reviewing the latest values. A single panel is open at a time; it stays within the viewport and supports keyboard and touch interaction. Changes do not alter prompts, responsibility, tools or design assignments.

## Compact execution stream

Member and solo execution follows use version-2 envelopes with compact start/block/delta/end frames. Whole completed messages remain authoritative. The frontend incrementally reconstructs text, thinking and tool arguments by block index without receiving cumulative partials or replaying the entire frame list on each update. It preserves native signatures at block/message completion. Missing starts/evicted sequences discard only the affected partial; completed SQL history and a subsequent valid message start recover the display. Reconnect uses its completed-history cursor and SQL-to-retained-start cutover. Group timeline remains version 1 with existing reservation and final-reference/folding behavior.

## Simple Changes loading

Changes displays design/member current-versus-ordinary-committed diffs from one lightweight read. It retains old data during refresh and loads activation validation independently when committed bundles differ from active. Commit approval is the composer-adjacent pending request flow, without old scope revision/base mutation controls.

Only one Changes read is in flight per workspace view. Focus/polling coalesce; disposal ignores late reads. Activation errors remain visible and refresh the review without changing active state.

## Shared user pictures

Workspace group input accepts PNG/JPEG/WebP pictures through the composer file picker, clipboard and drop. Users can remove local previews and send pictures alone or with text. Refused sends preserve their draft. Sent pictures remain viewable after reload through durable backend attachment references. Picture input does not change solo-conversation input.


Workspace creation preserves existing .rsi/context documents and adds only missing root documents. Review POST /workspaces/initialization is read-only. Cancellation sends no create/cleanup request. Cleanup POST /workspaces includes the reviewed cleanupRevision; context/source are explicitly excluded from removal.
