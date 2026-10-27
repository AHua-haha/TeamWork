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

**Workspace context inspection:** Temporary lightweight workspace mode keeps expensive Design, Team, Changes and Files inspection disabled, while the manually opened panel provides Context (read-only Group/member message context), Member activation and explicit commit review. Opening/focusing the panel does not trigger activation validation; context reads occur only when Context is selected.

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

## Temporary lightweight workspace mode

**Input/config:** `src/features/workspace/workspace-features.ts` exports `workspaceDetailsEnabled=false`. Set it true and rebuild to restore the original detailed workspace. No deployment environment variable or backend permission switch is changed.

**Output/effect:** `WorkspacePage` chooses `ChatWorkspacePage`; the retained `DetailedWorkspacePage` and its `WorkspacePanel/useTeam/useDesigns/ChangesTab` effects are not mounted. `useChatRoster`/`ChatRoster` uses GET team/roster with one request in flight and no timer. Chat timeline changes and explicit mutations refresh that narrow roster. Mentions display Select when readiness is unknown; backend admission remains authoritative. Model hover controls accept only member identity/name/running state.

`MemberActivationPanel` loads nothing automatically. Check committed members explicitly calls committedMemberReview; Activate members submits its exact revision/digest. Concurrent clicks are blocked, invalid/no-change reviews cannot activate, failures discard the review and require another explicit check. Backend validates workspace idle state and stale reviews. On success refresh the roster. Explicit Git commit approval and a manually opened CommitReviewTab are retained. Hiding this temporary panel unmounts its content.

**Usage:** open a workspace and chat normally. Open Member activation, click Check committed members, wait for work to finish, then Activate members. Design/Team/Changes/Files tabs are temporarily absent. No diffs, design catalog, workspace context feed or full team polling are started by this view.

**Verification:** `test/temporary-workspace.test.ts` covers roster request coalescing/disposal/retry and explicit activation guards/tokens; mocked browser network verification covers active chat, panel open/close, stop, manual activation and narrow layout.

## Context sidebar rendering correction

`ContextClient.summary(workspaceId)` reads `/workspaces/:id/team/chat/summary` and validates text, identity, revision, source coverage and the fixed 30-message retained tail. `ContextTab` offers Group summary alongside Group chat and member contexts, without issuing message-page requests for that source. `GroupSummaryView` provides loading/empty/error states and explicit Refresh. `GroupSummaryInspector` uses the existing left-list/right-detail SequenceInspector to show the complete summary, covered prefix, analyzed boundary, revision, retained count and inspectable digest/time metadata. The old semantic client, tree renderer and range styles are removed. Group chat context inspection now displays the effective shared summary plus original tail returned by the backend; main chat history is unchanged.

`ContextMessageDetail` also renders a collapsed `ThinkingSignature` disclosure for every nonempty native assistant thinking signature, labeled with its original content block number. Expanding lazily parses/formats JSON (including encrypted content and provider-specific fields), with an unchanged-text fallback for opaque signatures. The complete value is available in a wrapping, scrollable code area; signature-only blocks are included. This uses the existing context response without new requests or persistence changes, and full raw-message inspection remains available.

`context-message.tsx` maps native Pi messages with `contextThreadMessage`: only assistant presentation messages (including the tool-result presentation adapter) receive assistant-ui completion status. User/system messages omit status. Each selected message is rendered inside `MessageByIndexProvider index={0}` within its read-only AssistantRuntimeProvider. The provider selects the single adapter message and supplies MessagePrimitive.Root/Parts with message scope. Stored Pi messages, opaque signatures and metadata are not rewritten. Tool results map only their native text/image content; internal `details` are not appended as a rendered text block. The explicit raw-data toggle still displays the complete original message, including `details`.

`ChatWorkspacePage.showPanel` changes visibility only; `contextOpen` owns tab selection independently and defaults true. Member activation no longer flips back to Context; Context is not marked active while commit review is shown. Expensive Design/Team/Changes/Files views remain disabled. `test/context-message.test.ts` covers role/status mapping and multimodal non-mutation; browser verification reproduces the old crash and checks group/member rendering, raw signatures, tab switching and reopen behavior.

The workspace panel is a named inline-size container. The Context tab overrides Shared SequenceInspector with a persistent two-column grid: `minmax(96px,30%) minmax(0,1fr)`, with independent list/detail scrolling and zero minimum detail width. At panel widths up to 700px, only the source picker moves above the inspector as wrapping compact buttons. Message list remains left and detail right on docked desktop, expanded, and mobile views; Shared UI examples retain their existing responsive behavior.

## Workspace panel resizing

`WorkspaceResizeHandle.tsx` is mounted inside both the lightweight panel and the retained detailed WorkspacePanel when open and not expanded. Pointer capture keeps left-edge dragging active outside the handle; pointer release/cancel/lost capture, blur and unmount clean up drag state. ArrowLeft/ArrowRight change width by 24px (Shift:64px); Home/End select minimum/maximum. ARIA separator values reflect current width/bounds.

`panel-size.ts` supplies bounds matching existing overlay breakpoints: a 320px minimum when space allows, up to available width minus 280px chat space when docked; overlays fit the viewport minus its navigation rail. A ResizeObserver and window resize listener clamp rendered width without losing the preferred width. `rsi.workspace-panel-width` in sessionStorage retains the preference with a storage-unavailable fallback. Expand hides the grip and uses the existing full-panel layout; Restore reapplies the preferred width.

The handle applies a CSS custom width directly to its enclosing panel and rerenders only its own ARIA state. It does not rerender message history through parent state or request backend data. The existing Context container queries adapt source/list/detail to the new width. Tests cover sizing bounds; browser checks cover actual drag, keyboard resizing, session persistence, Expand/Restore, viewport clamping and unchanged context-read counts while dragging.
