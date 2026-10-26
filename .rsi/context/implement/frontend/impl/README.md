# Frontend implementation context

## Result summary

Frontend design is now decomposed into the agreed tree: App, Shared (UI and Backend Client), and Features (Home, Providers, Chat and Workspace). The implementation remains in its existing source layout; this tree records ownership and target boundaries without claiming a source migration is complete.

Design: [Frontend](../../../design/frontend/design.md).

### Coordination and ownership

The source migration now follows the design tree:

- `frontend/src/app/` owns startup, route parsing, the shell and global navigation. App is outside the Frontend Features member's ownership; Shared owns only the backend client and reusable UI.
- `frontend/src/shared/backend-client/` owns the decomposed backend transport modules and the `BackendClient` facade/singleton.
- `frontend/src/shared/ui/` owns presentation-only reusable visual primitives. `SequenceInspector` provides the context-viewer two-pane list/detail interaction; feature renderers supply their own data and content.
- `frontend/src/features/providers/` owns Providers; `frontend/src/features/chat/` owns solo/team conversation UI, adapters and chat state; `frontend/src/features/workspace/` owns the workspace page and its Files, Design, Team, Changes, Context and related sections; `frontend/src/features/home/` owns the Home landing page and quick actions. These Features areas are owned by the Frontend Features member.

The migration moves source ownership without changing routes, API payloads, SSE behavior or user-facing workflows. Features use the shared `backendClient` facade while resource implementations remain internally decomposed.

Client modules fetch history/inspection and merge live deltas; adapters derive display state; UI components render conversations, review and configuration. API responses are the frontend contract, not backend object internals.

### Implemented contract

**Input:** HTTP JSON/binary/SSE records, user interaction, cursor/revision state.

**Shared UI contract:** Shared UI provides direct visual component implementations and examples rather than a UI-library SDK contract. A component may use a concrete example input shape, but features may copy, adapt, extend or replace the code around their own data models. Shared owns only the visual result and local interaction behavior; it does not fetch data, interpret feature records, or own workflows.

**Agent context viewer design:** The Shared UI design specifies a two-pane chronological viewer for the Agent's current persisted Pi message list, with selectable rows, a right detail panel, assistant-ui presentation integration, readable supported content and optional raw-data inspection. Pi messages and example content are a concrete visual example for this viewer, not a universal Shared data model. Feature developers may further develop the direct component code around their own requirements. This is a design and presentation implementation; feature loading and lifecycle remain outside Shared.

**Workspace context inspection:** Workspace has one Context tab for both the original group-chat context and member Agent contexts. Its left context list selects Group or a workspace member; the selected ordered message context is rendered with the Shared UI viewer. The Workspace feature owns pagination, revision-scoped refresh, source selection, loading/error/conflict handling, and Pi-message presentation. Group and member context revisions are independent; on `context_changed`, restart that source from offset zero. Reads are debug inspection only and do not alter, synchronize, or cancel execution.

**Backend context client:** `BackendClient.context.group(workspaceId, options)` and `.member(workspaceId, memberId, options)` perform read-only paged inspection. They preserve the backend page envelope (`revision`, `offset`, `total`, `nextOffset`, `entries`); each entry's `message` is typed as Pi's public `Message` from `@earendil-works/pi-ai`. The client validates the page and context-entry envelope/message role without transforming message content, sends GET with no-cache request headers, and preserves typed `BackendError` codes including `context_changed`.

**Verification:** Frontend type check, production build and full test suite pass; 92 tests pass, including four focused context-client tests for URL/query behavior, Pi-typed entry envelope, `context_changed`, malformed pages and invalid identities. `git diff --check` passes. Production build reports the existing large-chunk advisory.

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
- [Backend Client](../../../../../frontend/src/shared/backend-client): transport modules, public facade and read-only context page client (`context-client.ts`).
- [Shared UI](../../../../../frontend/src/shared/ui): presentation-only `SequenceInspector` list/detail component and its Storybook stories.
- Workspace Context tab UI: [ContextTab](../../../../../frontend/src/features/workspace/ContextTab.tsx) pages group/member Pi context with revision pinning; [context-message](../../../../../frontend/src/features/workspace/context-message.tsx) maps Pi messages into a read-only assistant-ui detail renderer, including thinking, text, images, tool calls/results and raw JSON.
- [Shared UI Storybook](../../../../../frontend/.storybook): isolated visual development configuration; run `npm run storybook --prefix frontend` and open `http://127.0.0.1:6006`.
- [Home](../../../../../frontend/src/features/home), [Providers](../../../../../frontend/src/features/providers), [Chat](../../../../../frontend/src/features/chat), [Workspace](../../../../../frontend/src/features/workspace): feature implementations.
- Workspace Context tab UI: `ContextTab.tsx` pages group/member Pi context with revision pinning; `context-message.tsx` maps Pi messages into a read-only assistant-ui detail renderer, including thinking, text, images, tool calls/results and raw JSON.
- [Frontend tests](../../../../../frontend/test): client, adapter and UI regression checks, including context-client page/revision behavior.

### Context tab implementation

**Input:** workspace ID, current member roster, and the shared `ContextClient` facade.

**Output:** a Workspace `Context` tab with a left source selector (Group plus each workspace member), a chronological message inspector, and a selected message detail pane.

**Effect:** performs read-only paginated context GET requests. It pins subsequent page requests to the first page's revision, discards late responses after source switches/unmount, exposes errors, and requires a restart from offset zero after `context_changed`. No run is started, changed or cancelled.

**Usage:** open Workspace → Context, select Group or a member, inspect messages; use Load more for subsequent pages and Refresh to read a consistent current snapshot.

**Verification:** `npm run check --prefix frontend`, `npm test --prefix frontend` (92 passed), `npm run build --prefix frontend`, and `git diff --check` pass. Production build reports the main JavaScript chunk-size advisory (>500 kB).

Legacy reference documents remain available under the existing `reference/` paths; they are migrated behavior/code references, not child designs.

## Automatic retrieval

```json
{"commands": []}
```
