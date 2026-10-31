---
summary: Workspace-scoped group chat with on-demand context inspection, member activation, model settings and resizable browser panel state.
include:
  - frontend/src/features/workspace/
  - frontend/src/shared/backend-client/
  - frontend/src/shared/ui/
---

# Workspace usage contract

`WorkspacePage` accepts a workspace id, optional display name and a `FilesControl` panel control. It follows the lightweight workspace roster, renders `GroupChat`, and offers a panel containing Context, Member activation and Workspace models tools. The panel can close, expand/restore and resize within the browser session.

Context is read-only. The source list selects Group chat, Group summary or a current member; pages are read at a pinned revision, show chronological entries and details, and expose loaded/total counts plus Load more. A `context_changed` response marks the view stale and requires an explicit reload from offset zero. Summary inspection uses the separate summary view. Context reads never start, modify or cancel agent work.

Member activation is one explicit backend request, disabled while a run or request is active; success refreshes the roster and failures remain actionable. Workspace model settings use the shared workspace client. Backend owns workspace identity, files, design/member records, validation and durable effects.

Inputs are workspace identity/name, panel controls, roster records, context pages, revisions and user actions. Outputs are group conversation UI, tool-panel views and explicit backend requests. Initial roster/context failures are shown with retry; an empty result is not inferred from a failed request. In the current implementation the broader optional Overview, Files, Design, Changes and Settings tabs are not mounted in this lightweight page.

Example:

```tsx
<WorkspacePage workspaceId={id} name={workspaceName} files={workspacePanel} />
```

The panel's layout state affects presentation only. Changing width, opening tools or selecting a source does not reload unrelated data or initiate backend work.
