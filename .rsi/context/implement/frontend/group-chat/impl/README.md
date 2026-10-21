# Workspace group chat implementation context

## Result summary

Group chat is implemented in `frontend/src/ui/GroupChat.tsx` and `group-work.ts`, backed by `frontend/src/client/group-client.ts` and per-member `AgentClient` runs. The UI displays the persisted group timeline, user posts/images, member response sections, streamed work, accepted final reports, status/timing, tool-set disclosure, reset/stop controls, model popover, discussion references, and commit approval input. Backend owns durable group ordering, accepted publication, execution and history.

No project source was changed. Verification attempted from `frontend/` with `npm run check && npm test && npm run build`; it stopped immediately because `tsc` is missing. Tests and build were not run. The current code was inspected but not runtime-validated against a backend. Continue acceptance verification for visual geometry, stream reconnection edge cases, accessible interactions, and exact backend contracts.

Observed design/code issue to investigate: design requires the thinking indicator after visible activity inside Work and requires it to disappear on tool execution and several transitions. `isRunThinking` gates on synchronized/following model phase and last live event thinking-start/delta, while `GroupChat` renders it after `items`; inspect event-phase transitions and stream recovery under integration tests. Do not treat this note as a confirmed failure. `GroupClient` attachment validation currently allows only PNG/JPEG MIME types, while accepted design permits PNG/JPEG/WebP; the UI picker accepts WebP and `useImageDraft` may constrain actual selection, so reconcile the full submission/validation path. No code was modified.

## File lookup

| Path | Description |
|---|---|
| `frontend/src/ui/GroupChat.tsx` | Group chat page, composer, response sections, tool sets and images |
| `frontend/src/ui/group-work.ts` | Ordered readable work projection, tool grouping, live-thinking predicate and helpers |
| `frontend/src/ui/Thread.tsx` | Solo conversation (not the group member-work renderer) |
| `frontend/src/ui/CommitApproval.tsx` | Compact pending commit decision popup |
| `frontend/src/ui/MemberModelPopover.tsx` | Active member model settings interaction |
| `frontend/src/ui/useImageDraft.ts` | Local attachment validation, previews, and object URL lifecycle |
| `frontend/src/ui/response-text.ts` | Agent routing-header/body display extraction |
| `frontend/src/ui/Markdown.tsx`, `markdown-parser.ts` | Markdown output and link handling |
| `frontend/src/ui/styles.css` | Group layout, reading column, pills, tool sets, responsive styles |
| `frontend/src/client/group-client.ts` | Group timeline protocol/client, send/reset/stop and image URL |
| `frontend/src/client/agent-client.ts` | Per-agent completed/live stream follow and recovery |
| `frontend/src/client/progress.ts` | Live event reconstruction |
| `frontend/src/client/protocol.ts`, `sse.ts` | Stream/event contracts and parser |
| `frontend/src/client/commit-approval.ts` | Pending approval/review/decision transport |
| `frontend/src/ui/WorkspacePage.tsx` | Group and right-panel composition |
| `frontend/src/ui/WorkspacePanel.tsx` | Design/team/changes/files and commit review display |

## Implemented contract

### `GroupClient`

**Input.** `new GroupClient(workspaceId, options?)` requires a workspace identifier matching the client ID pattern; optional options include a `fetcher` and retry-delay function. It accepts `send(text: string, images: readonly File[] = [])`; text may be blank only when at least one image is attached, and no more than four images are accepted. `follow()`/`refresh()` starts synchronization; `stop()` requests group cancellation; `reset()` requests durable reset. Subscribe via `subscribe(listener)` and read immutable-style `getSnapshot()` values.

**Output.** Snapshot provides timeline entries ordered by backend `position`, change cursor and reset cursor, synchronization/connection state, sending/stopping/resetting flags, general and command errors. `GroupEntry` is either user data (text, message ID, optional attachments) or member reservation (identity, run state, working range, final reference, resolved text). Async operations resolve on API acceptance or reject on failure; failed commands also expose `commandError`. `imageUrl(workspaceId,imageId)` returns the workspace-scoped attachment endpoint URL.

**Effect.** `follow` consumes timeline SSE and reconnects transient failures from the contiguous cursor. It merges updates by identity/revision and rejects malformed entries, conflicting positions and cursor gaps. POST response entries can render immediately but do not advance the feed cursor. Reset removes entries at/before its returned boundary; stop/reset/send call backend endpoints. `dispose` aborts the stream and removes listeners.

**Usage.**

```ts
const client = new GroupClient(workspaceId);
const unsubscribe = client.subscribe(() => setSnapshot(client.getSnapshot()));
client.follow();
await client.send('Inspect these', [file]);
// later: await client.stop(); await client.reset();
unsubscribe();
client.dispose();
```

### Group presentation

**Input.** `GroupChat` receives `workspaceId`, title, `TeamState`, right-panel state/callbacks, running callback, current discussion-reference controls, and commit-review callback. It constructs a `GroupClient` per workspace and an `AgentClient` per member activation using the activation's working-history lower boundary.

**Output.** Renders user timeline items and member sections in persisted entry order. Member section status/timing and Work disclosure accompany activity and accepted final Markdown. Activity is projected from completed and live agent records into text and consecutive tool sets. `runActivity` excludes the accepted final source from the work list; `isRunThinking` returns a transient boolean and never returns reasoning content. Work tool summaries/rows expose call arguments/results and per-call failure state. Section-local follow error includes retry while final text stays independently rendered.

**Effect.** Active runs are followed independently of Work visibility; completed private work is followed when expanded. Work disclosure changes rendering only. Accepted final transition folds once via local state. User sends may include discussion-reference text and image files. Stop/reset and approval decisions request backend effects; successful reset updates the client snapshot, while errors are shown rather than optimistically clearing the timeline.

**Usage.** Render through the workspace page; callers provide the team and panel callbacks, e.g. `WorkspacePage` mounts `<GroupChat key={workspaceId} ... />` after team/lead data is ready. Keep group timeline mutations in `GroupClient`; do not synthesize shared messages from private agent history.

## Implementation notes

- User submission uses `discussionInput` and multipart form data when images are present. Draft text is only cleared if unchanged since submission; discussion reference clears after successful send. Refused sends retain the draft/reference and show client error.
- Image display resolves a backend binary URL and opens it in a new tab; local load failure is isolated to that image. `useImageDraft` owns preview URLs and validation.
- `runActivity` projects records within each reservation's private history bounds and only same-run live messages. Tool-result records update their matching calls; calls preserve original order. Nonempty visible text separates tool sets. Thinking blocks are excluded from activity content.
- `responseTextBlocks` handles optional routing header presentation; backend final reference fields select authoritative source blocks/body offset. Frontend does not determine publication authority from mention-like text.
- Approval UI is in `CommitApproval.tsx`; transport in `commit-approval.ts`; review details are delegated to workspace panel. It does not embed diff content in the popup.
- Reset confirmation says member private conversation history is cleared while files/settings remain. Reset control is disabled for active work, pending send/stop/reset, or unsynchronized timeline.

## Verification and continuation

- Static check/test/build attempt failed before running due to missing `tsc` executable. Install frontend dependencies (`npm ci`) before verification; then run `npm run check`, `npm test`, `npm run build`.
- Run design acceptance checks for WebP end-to-end (draft validation, API multipart, backend metadata, image rendering), thinking indicator lifecycle/reconnect, group order vs cursor, exact final exclusion, retry behavior, keyboard/touch popover, and responsive reading column. Inspect test coverage in `frontend/test/` and add no code under this documentation-only assignment.
- Existing source changes/deletions belong to the user/team; preserve them.

## Automatic retrieval

```json
{"commands": []}
```
