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
