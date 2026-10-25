# Frontend implementation context

## Result summary

The React client consumes stable API history and compact progress; retained detailed references document presentation and synchronization.

Design: [Frontend](../../../design/frontend/design.md).

### Coordination and ownership

Client modules fetch history/inspection and merge live deltas; adapters derive display state; UI components render conversations, review and configuration. API responses are the frontend contract, not backend object internals.

### Implemented contract

**Input:** HTTP JSON/binary/SSE records, user interaction, cursor/revision state.

**Output:** Browser views and explicit requests carrying user decisions.

**Effect and failure:** Owns browser state and presentation; durable business state is owned by Backend Core.

**Usage example:** Use the running frontend URL. Submit a message; the reserved member section streams visible text/tool work, then folds work when the accepted final message is known. Refresh reads durable records.

### Context-preserving workspace initialization

**Input:** WorkspaceClient.inspectInitialization({directory,adopt}) and createWorkspace(input, including optional cleanupRevision through WorkspaceInput). CreateWorkspaceDialog uses the same name/folder/adopt/models form.

**Output:** When inspection reports nonempty metadata, the existing modal lists canonical directory/cleanupPaths, explains preservation, and offers Cancel, Back and Clean up and initialize. Empty/context-only inspections proceed directly to normal creation.

**Effect and failure:** No create request is sent during review/cancellation. Confirmation submits the captured creation input with its reviewed revision; changing form inputs requires returning from review. On cleanup_required, return to the form and display the conflict so resubmission performs a fresh inspection. Other errors remain visible. No browser-native confirmation or silent cleanup is used.

**Usage example:** choose Use an existing folder, configure a default model, click Create workspace, review the cleanup paths and explicitly confirm. Backend handles durable/file effects; the browser stores only form/review state.

### Workspace deletion confirmation

**Input:** WorkspaceClient.deleteWorkspace(workspaceId) sends DELETE without a body; the sidebar supplies a selected WorkspaceRecord to the existing ConfirmDialog.

**Output:** A trash action next to each workspace row, a confirmation naming the project and kept directory/.rsi files, explicit busy/backend errors, and updated navigation after acknowledged success.

**Effect and failure:** Cancellation sends no request. Failures retain the row and confirmation. Successful deletion filters the selected row, invalidates older list-request generations, clears saved lastChat when it names that workspace, and returns home only if viewing the deleted workspace. Its open file/chat components unmount; confirmed unsaved edits are discarded. Deleting an inactive workspace keeps unrelated navigation/lastChat. Mobile non-hover controls stay visible. No filesystem path is sent to the deletion endpoint.

**Usage example:** hover a workspace row (or use its visible mobile action), click its trash icon, review the kept-files explanation and click Delete workspace. Busy refusal asks the user to stop work and retry. Mock-browser checks cover cancel, refusal, stale list responses, active deletion and inactive deletion.

## File lookup

- [frontend](../../../../../frontend): owned implementation.
- [reference/frontend/design.md](reference/frontend/design.md): migrated existing behavior/code reference, not a child design.
- [reference/frontend/group-chat/design.md](reference/frontend/group-chat/design.md): migrated existing behavior/code reference, not a child design.
- [reference/frontend/group-chat/impl.md](reference/frontend/group-chat/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/frontend/impl.md](reference/frontend/impl.md): migrated existing behavior/code reference, not a child design.
- [Frontend tests](../../../../../frontend/test): client, adapter and UI regression checks.

## Automatic retrieval

```json
{"commands": []}
```
