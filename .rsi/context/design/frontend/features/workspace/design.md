# Workspace

## Purpose and responsibilities

Workspace presents information and actions scoped to one selected workspace. It is the workspace-level container in the initial navigation model, with internal tabs/sections rather than separate top-level destinations. Workspace feature composition does not require every section to share one implementation or state model.

## Initial tab structure

The workspace page may provide these sections:

- **Overview** — workspace identity and summary.
- **Files** — browse and inspect workspace files.
- **Design** — inspect and manage design documents.
- **Team/Members** — inspect members and configuration, and expose existing review/activation controls.
- **Changes** — inspect changes and supported review/commit approval workflows.
- **Settings** — workspace-specific settings supported by the backend.
- **Context** — one read-only inspection tab for the current shared Group context and each workspace member's current persisted Agent context. The source list selects Group or a member; the selected source is paginated at one pinned revision and displayed as a chronological message list with detail. Text, thinking, images, tool calls/results and unknown/raw message data remain inspectable. On `context_changed`, discard the mixed revision and explicitly reload from offset zero. These reads do not start or cancel Agent work.

This list describes initial organization; preserve existing backend capabilities and user workflows. These sections are composed inside Workspace and do not expand global navigation.

## Interface contract

Workspace uses the shared backend client and composes shared UI with workspace-scoped state and interactions. It submits required identities/revisions and presents backend refusals explicitly. Backend owns workspace registration, files, design/member records, validation and durable effects.

**Input:** selected workspace identity, backend records, revisions and user actions. Context inspection accepts a source selection (`group` or a workspace member) and the backend's bounded pagination cursor/revision.

**Output:** tabbed workspace information, explicit requests and visible success/conflict/error outcomes. The Context tab renders the selected source's native Pi message entries through a two-pane chronological inspector with readable assistant-ui detail rendering and raw inspection.

**Effect:** browser-side selection/tab state and user-authorized backend requests; no frontend authority over durable project state. Context reads are read-only, do not start or cancel runs, and refresh from offset zero after a revision conflict.

**Usage example:** after selecting a workspace from Home, a user opens its Design, Team or Context tab. In Context, the left source list offers Group and the workspace's members; selecting one loads ordered message pages at a pinned revision and displays the current message detail. If the backend reports `context_changed`, the feature reports the conflict and reloads that source from the beginning.

### Workspace context inspection

The readable tool-result view renders only native content blocks (text/images). Do not append the tool’s internal `details` object as message content; it is not an additional model-visible result. Preserve the stored message unchanged, including `details` in explicit raw-data inspection.


Selected assistant message details expose each nonempty `thinkingSignature` in its own collapsed section, identified by the original content block number. Expanding shows the complete stored value: JSON signatures are formatted for reading, including `encrypted_content` and provider metadata; opaque non-JSON signatures remain unchanged. Signature-only thinking blocks are inspectable even without readable thinking text. No signature content is truncated, decrypted or modified, and opening the section needs no additional backend request.

Workspace provides a Context tab selecting either Group context or a workspace member's current Agent context. Its source list is Group plus the current roster. The feature paginates read-only Pi message entries using a pinned revision, displays chronological entries and selected-message detail, and allows explicit refresh. A `context_changed` response is visible and requires restarting that source at offset zero; pages from different revisions must never be combined. Text/thinking, native images, tool calls and results, metadata and raw message inspection are presented read-only using assistant-ui-compatible rendering. The feature must not start, modify or cancel Agent runs.

### Workspace initialization review

Workspace creation/adoption must use the existing review flow: inspect the target directory first; when non-context `.rsi` metadata is nonempty, show the canonical directory and cleanup paths, explain that context and source are preserved, and require explicit revision-bound confirmation before cleanup. Cancel makes no create request; a changed cleanup revision requires a fresh review. See the Frontend overview and accepted Workspace design for the full contract.

## Temporary lightweight mode

`workspaceDetailsEnabled` is temporarily false. Workspace composes group chat with a narrow member roster and a manually opened panel for Context, activation and commit review. Existing Design, Team, Changes and Files implementations remain available in source but are not mounted, including after closing/reopening the panel. Their context feeds, design/harness inspection, full team polling and file diffs must not start while this mode is off. Context inspection is the explicit exception: it is available on demand, read-only, and uses the narrow roster plus the dedicated group/member context endpoints. Re-enable the switch to restore the existing detailed composition.

Activation checks run only when the user selects Check committed members, and activation sends the exact reviewed revision/digest through the existing idle-team validation. Opening the panel, focus and elapsed time do not request activation review. Explicit commit approval/review remains available. Backend run and activation permission/configuration validation remains mandatory.

### Context sidebar interaction and rendering

Sidebar visibility is independent of its selected tab. The lightweight sidebar initially selects Context; selecting Member activation must not be overridden by opening the sidebar, and closing/reopening preserves the selected tab. Context rendering respects protocol roles: user/system inputs are not assistant completions. Native stored messages, signatures and metadata remain unchanged.

For each selected context, the chronological message list stays on the left and selected message data stays on the right, including in a docked or mobile sidebar. Both columns can shrink and scroll independently. On narrow sidebars the context source picker moves above this left–right inspector; it does not push the message detail below the message list.

### Resizable workspace panel

The right panel has a draggable left edge. Moving the edge left widens it; moving right narrows it. The edge is also a keyboard-accessible vertical separator. Width is a browser-session layout preference, preserved through closing/reopening and Expand/Restore. Bounds keep the panel within the viewport and reserve usable chat space when docked. Resizing changes presentation only and must not reload context or start backend inspection.

### Shared group summary inspection

The Context source list includes Group summary alongside Group chat and member contexts. Show one summary entry at left and its complete text, revision, summarized prefix, analyzed snapshot and retained-message count at right. No semantic tree or member-involvement information remains. Empty/loading/error states and explicit Refresh use the existing context inspector pattern. Group chat context inspection shows the shared summary followed by the retained original messages; stable chat history is unchanged.
