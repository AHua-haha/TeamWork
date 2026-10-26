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
- **Context** — one read-only inspection tab for the original Group context and each workspace member's current persisted Agent context. The source list selects Group or a member; the selected source is paginated at one pinned revision and displayed as a chronological message list with detail. Text, thinking, images, tool calls/results and unknown/raw message data remain inspectable. On `context_changed`, discard the mixed revision and explicitly reload from offset zero. These reads do not start or cancel Agent work.

This list describes initial organization; preserve existing backend capabilities and user workflows. These sections are composed inside Workspace and do not expand global navigation.

## Interface contract

Workspace uses the shared backend client and composes shared UI with workspace-scoped state and interactions. It submits required identities/revisions and presents backend refusals explicitly. Backend owns workspace registration, files, design/member records, validation and durable effects.

**Input:** selected workspace identity, backend records, revisions and user actions. Context inspection accepts a source selection (`group` or a workspace member) and the backend's bounded pagination cursor/revision.

**Output:** tabbed workspace information, explicit requests and visible success/conflict/error outcomes. The Context tab renders the selected source's native Pi message entries through a two-pane chronological inspector with readable assistant-ui detail rendering and raw inspection.

**Effect:** browser-side selection/tab state and user-authorized backend requests; no frontend authority over durable project state. Context reads are read-only, do not start or cancel runs, and refresh from offset zero after a revision conflict.

**Usage example:** after selecting a workspace from Home, a user opens its Design, Team or Context tab. In Context, the left source list offers Group and the workspace's members; selecting one loads ordered message pages at a pinned revision and displays the current message detail. If the backend reports `context_changed`, the feature reports the conflict and reloads that source from the beginning.

### Workspace context inspection

Workspace provides a Context tab selecting either Group context or a workspace member's current Agent context. Its source list is Group plus the current roster. The feature paginates read-only Pi message entries using a pinned revision, displays chronological entries and selected-message detail, and allows explicit refresh. A `context_changed` response is visible and requires restarting that source at offset zero; pages from different revisions must never be combined. Text/thinking, native images, tool calls and results, metadata and raw message inspection are presented read-only using assistant-ui-compatible rendering. The feature must not start, modify or cancel Agent runs.

### Workspace initialization review

Workspace creation/adoption must use the existing review flow: inspect the target directory first; when non-context `.rsi` metadata is nonempty, show the canonical directory and cleanup paths, explain that context and source are preserved, and require explicit revision-bound confirmation before cleanup. Cancel makes no create request; a changed cleanup revision requires a fresh review. See the Frontend overview and accepted Workspace design for the full contract.

## Temporary lightweight mode

`workspaceDetailsEnabled` is temporarily false. Workspace composes group chat with a narrow member roster and a manually opened panel for Context, activation and commit review. Existing Design, Team, Changes and Files implementations remain available in source but are not mounted, including after closing/reopening the panel. Their context feeds, design/harness inspection, full team polling and file diffs must not start while this mode is off. Context inspection is the explicit exception: it is available on demand, read-only, and uses the narrow roster plus the dedicated group/member context endpoints. Re-enable the switch to restore the existing detailed composition.

Activation checks run only when the user selects Check committed members, and activation sends the exact reviewed revision/digest through the existing idle-team validation. Opening the panel, focus and elapsed time do not request activation review. Explicit commit approval/review remains available. Backend run and activation permission/configuration validation remains mandatory.
