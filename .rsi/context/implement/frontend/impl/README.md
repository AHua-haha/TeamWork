# Frontend implementation context

## Result summary

The browser application is a React/TypeScript frontend with route/page composition in `src/ui/App.tsx`, protocol-owning browser clients under `src/client`, presentation adapters under `src/adapter`, and Vite entry/configuration. The actual UI covers conversations (workspaces and solo agents), workspace design/team/changes/files panel, provider configuration, and workspace group chat. Backend remains authoritative for execution, persisted ordering, publication, filesystem authority, and approvals.

This context records the inspected implementation, not a claim that every accepted design criterion has been verified. No source files were changed. Verification attempted from `frontend/`: `npm run check && npm test && npm run build` stopped immediately because `tsc` is unavailable (`sh: tsc: command not found`); tests/build therefore did not run. Existing `frontend/README.md` provides intended run/deployment notes, but version/configuration alignment needs further review.

Known design/implementation points requiring verification or follow-up: accepted top-level design describes a two-destination rail, workspace pages, solo pages, and Config; inspect remaining page and stylesheet code for full responsive/accessibility acceptance. `Thread.tsx` includes a Reasoning disclosure component, whereas group-chat design explicitly hides thinking; group chat uses a separate presentation path and does not use that component for member work. Do not infer global design compliance from that distinction. No source edits were made to address potential mismatches.

## File lookup

| Path | Description |
|---|---|
| `frontend/src/main.tsx` | React application entry |
| `frontend/src/ui/App.tsx` | Navigation, route/page orchestration |
| `frontend/src/ui/WorkspacePage.tsx` | Workspace page composition, group chat and panel |
| `frontend/src/ui/WorkspacePanel.tsx` | Workspace side panel tabs and file/design/team views |
| `frontend/src/ui/Thread.tsx` | Solo-agent conversation UI |
| `frontend/src/ui/GroupChat.tsx` | Workspace group chat and member response rendering |
| `frontend/src/ui/Markdown.tsx`, `markdown-parser.ts` | Safe project-local Markdown rendering and links |
| `frontend/src/client/agent-client.ts` | Solo agent HTTP/SSE synchronization, submission and cancellation |
| `frontend/src/client/group-client.ts` | Group timeline, reservation changes, reset, stop and image URLs |
| `frontend/src/client/workspace-client.ts` | Workspace and file API client |
| `frontend/src/client/changes-client.ts` | Changes feed client |
| `frontend/src/client/config-client.ts` | Provider/model configuration client |
| `frontend/src/client/commit-approval.ts` | Pending approval, review and decision client functions |
| `frontend/src/client/sse.ts`, `protocol.ts`, `progress.ts` | SSE parsing, protocol records, live progress reconstruction |
| `frontend/src/adapter/project.ts` | Adapter from client records to assistant-ui data |
| `frontend/src/ui/styles.css` | Application and responsive presentation styles |
| `frontend/package.json` | Dependencies and check/test/build scripts |
| `frontend/vite.config.ts` | Vite development/build configuration |
| `frontend/README.md` | User-facing development and deployment instructions |

## Implemented contract

### Browser application

**Input.** The React application takes browser location/navigation state and obtains workspace, agent, team, design, file, changes, config and conversation data through its client modules. The components expect typed backend records described in `src/client/protocol.ts`, `group-client.ts`, and related modules. Browser APIs include `fetch`, `AbortController`, `EventSource`-style SSE stream reading, file inputs, clipboard/drop events, ResizeObserver and local object URLs.

**Output.** Renders navigation, workspace/solo conversations, provider and workspace configuration, design/team/files/changes views, composer controls, and inline status/error states. It does not expose an aggregate return value; `main.tsx` mounts the application.

**Effect.** User operations call backend APIs. The frontend retains presentation state/drafts in React and client snapshots in memory; durable history, run execution, ordering and accepted changes are backend-owned. API errors surface to UI, and client follow loops reconnect where implemented. No provider secret value is rendered by the UI contract.

**Usage.** Start backend at the origin expected by Vite, then from `frontend/` run `npm ci` and `npm run dev`; open the Vite URL. Available verification commands are `npm run check`, `npm test`, and `npm run build` (not verified in this environment because TypeScript tooling is unavailable).

### Client boundaries

UI-independent clients hold protocol state and expose snapshots/subscriptions; React consumes them with `useSyncExternalStore`. `AgentClient` is constructed with an agent ID and optional fetch/base-path/retry configuration, `follow(runId?)` synchronizes completed records then live events, `send(input)` posts user content and follows the acknowledged run, `cancel()` requests cancellation, `refresh()` restarts synchronization, and `dispose()` aborts and releases listeners. Invalid IDs/input, protocol violations, backend errors, or failed requests reject/report errors; connection loss does not itself imply run completion.

`GroupClient(workspaceId, options?)` exposes subscription/snapshot, `follow()`/`refresh()`, `send(text, images?)`, `stop()`, `reset()` and `dispose()`. Entries are sorted by backend `position`; incremental changes advance a separate contiguous cursor. POST acknowledgements merge entries but do not advance that cursor. Reset applies the returned reset boundary and filters stale entries. Send allows text with up to four images, or image-only input; failures preserve an inline command error. The client constructs workspace-scoped image URLs with `imageUrl(workspaceId,imageId)`.

Other clients (`WorkspaceClient`, `ChangesClient`, `ConfigClient`) encapsulate their corresponding backend requests; see source for exact method signatures before extending or consuming them. `commit-approval.ts` exports `pendingCommits(workspace)`, `reviewCommit(workspace,id)`, and `decideCommit(workspace,id,action,message)`; these return backend responses/promises and surface request failures as errors. Example:

```ts
const group = new GroupClient(workspaceId);
const unsubscribe = group.subscribe(() => render(group.getSnapshot()));
group.follow();
await group.send('Please review this', selectedImageFiles);
// on teardown
unsubscribe();
group.dispose();
```

```ts
const agent = new AgentClient(agentId);
agent.follow(runId);
await agent.send('Summarize the workspace');
// agent.cancel() requests cancellation of the current running run.
```

## Implementation notes

- `AgentClient` validates versioned follow envelopes, record positions, sequence numbers, and sync boundaries. Gapped or disconnected partial streams are discarded pending reconciliation; unexpected end does not establish completion.
- `GroupClient` validates entries and cursors, deduplicates by revision, uses backend reservation `position` for display, consumes entry/reset/sync SSE events, and retries transient failures. Its entry schema carries user attachments or member run, working bounds, final reference, and resolved text.
- `GroupChat` builds on `GroupClient`, and per-member `AgentClient` instances follow active runs regardless of Work disclosure; completed history is observed on demand. `runActivity` produces ordered visible text/tool sets, omitting thinking and accepted final source from the work projection. Final accepted text is rendered separately, with automatic work folding on transition.
- `Markdown` uses the project-local parser; rendered content is React elements rather than injected HTML. `externalHref` and `resolveLink` constrain link handling.
- Workspace image draft controls live in `useImageDraft.ts`; group composer accepts file-picker, paste, and drop and message thumbnails use workspace binary endpoint URLs.
- Preserve existing uncommitted source changes. This assignment is documentation-only.

## Verification and continuation

- Attempted `npm run check && npm test && npm run build` in `frontend/`; stopped at missing `tsc`, so no test or build result is available. Install dependencies using the project's lockfile (`npm ci`) in a suitable environment, then run all three scripts.
- Continue by inspecting all client modules and UI pages against the accepted top-level design, then exercise interaction/accessibility/responsive cases and backend integration. Record concrete discrepancies here; request lead/design clarification when acceptance differs instead of changing source without authorization.

## Automatic retrieval

```json
{"commands": []}
```
