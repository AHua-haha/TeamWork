# Frontend implementation context

## Result summary

Frontend design is now decomposed into the agreed tree: App, Shared (UI and Backend Client), and Features (Home, Providers, Chat and Workspace). The implementation remains in its existing source layout; this tree records ownership and target boundaries without claiming a source migration is complete.

Design: [Frontend](../../../design/frontend/design.md).

### Coordination and ownership

The source migration now follows the design tree:

- `frontend/src/app/` owns startup, route parsing, the shell and global navigation.
- `frontend/src/shared/backend-client/` owns the decomposed backend transport modules and the `BackendClient` facade/singleton.
- `frontend/src/shared/ui/` owns presentation-only reusable visual primitives. `SequenceInspector` provides the context-viewer two-pane list/detail interaction; feature renderers supply their own data and content.
- `frontend/src/features/providers/` owns Providers.
- `frontend/src/features/chat/` owns solo/team conversation UI, adapters and chat state.
- `frontend/src/features/workspace/` owns the workspace page and its Files, Design, Team, Changes and related sections.
- `frontend/src/features/home/` owns the Home landing page, workspace overview/list and quick actions.

The migration moves source ownership without changing routes, API payloads, SSE behavior or user-facing workflows. Features use the shared `backendClient` facade while resource implementations remain internally decomposed.

Client modules fetch history/inspection and merge live deltas; adapters derive display state; UI components render conversations, review and configuration. API responses are the frontend contract, not backend object internals.

### Implemented contract

**Input:** HTTP JSON/binary/SSE records, user interaction, cursor/revision state.

**Shared UI contract:** Shared UI is a visual component and presentation-effects surface, not a fixed data-model SDK. Features use it around the data models they own, through generic visual props, children, slots, render callbacks and interaction callbacks. Shared UI does not require AgentMessage or any other feature/domain type, interpret records, fetch data, or own workflows. A feature may compose the shared visual pattern or implement additional feature-specific UI around it while retaining its own model and behavior.

**Agent context viewer design:** The Shared UI design now specifies a two-pane chronological viewer for the Agent's current persisted Pi message list, with selectable rows, a right detail panel, assistant-ui presentation integration, readable supported content and optional raw-data inspection. This specific viewer may use Pi's public message type without establishing a universal Shared data model. Shared owns visual rendering and local interactions; the feature owns loading, mapping, lifecycle and feature meaning. This is a design contract only; no component implementation has been added.

**Output:** Browser views and explicit requests carrying user decisions.

**Effect and failure:** Owns browser state and presentation; durable business state is owned by Backend Core.

**Usage example:** Use the running frontend URL. Submit a message; the reserved member section streams visible text/tool work, then folds work when the accepted final message is known. Refresh reads durable records.

### Context-preserving workspace initialization

**Input:** WorkspaceClient.inspectInitialization({directory,adopt}) and createWorkspace(input, including optional cleanupRevision through WorkspaceInput). CreateWorkspaceDialog uses the same name/folder/adopt/models form.

**Output:** When inspection reports nonempty metadata, the existing modal lists canonical directory/cleanupPaths, explains preservation, and offers Cancel, Back and Clean up and initialize. Empty/context-only inspections proceed directly to normal creation.

**Effect and failure:** No create request is sent during review/cancellation. Confirmation submits the captured creation input with its reviewed revision; changing form inputs requires returning from review. On cleanup_required, return to the form and display the conflict so resubmission performs a fresh inspection. Other errors remain visible. No browser-native confirmation or silent cleanup is used.

**Usage example:** choose Use an existing folder, configure a default model, click Create workspace, review the cleanup paths and explicitly confirm. Backend handles durable/file effects; the browser stores only form/review state.

## File lookup

- [Frontend source](../../../../../frontend/src): migrated implementation organized under `app/`, `shared/backend-client/`, `shared/ui/` (intentionally empty), and `features/`.
- [App](../../../../../frontend/src/app): startup, shell and routes.
- [Backend Client](../../../../../frontend/src/shared/backend-client): transport modules and public facade.
- [Shared UI](../../../../../frontend/src/shared/ui): presentation-only `SequenceInspector` list/detail component and its Storybook stories.
- [Shared UI Storybook](../../../../../frontend/.storybook): isolated visual development configuration; run `npm run storybook --prefix frontend` and open `http://127.0.0.1:6006`.
- [Home](../../../../../frontend/src/features/home), [Providers](../../../../../frontend/src/features/providers), [Chat](../../../../../frontend/src/features/chat), [Workspace](../../../../../frontend/src/features/workspace): feature implementations.
- [Frontend tests](../../../../../frontend/test): client, adapter and UI regression checks.

Legacy reference documents remain available under the existing `reference/` paths; they are migrated behavior/code references, not child designs.

## Automatic retrieval

```json
{"commands": []}
```
