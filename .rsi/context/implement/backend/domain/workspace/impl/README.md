## Result summary

Inspected accepted Workspace design and mapped source. Workspace contains registry service, versioned context base, design-tree resolution, filesystem project API and Git helpers. No source changes, data migrations, reset or tests.

## File lookup

| Path | Description |
|---|---|
| `backend/src/domain/workspace/workspace.ts` | WorkspaceService registry/filesystem coordination. |
| `backend/src/domain/workspace/context-base.ts` | Versioned context tree, save/history/change logic. |
| `backend/src/domain/workspace/context-path.ts`, `workspace-layout.ts` | Path validation and managed tree mapping. |
| `backend/src/domain/workspace/context-documents.ts`, `design.ts` | Context document projection and design node resolution. |
| `backend/src/domain/workspace/project-files.ts` | Project tree/read/write/search operations. |
| `backend/src/domain/workspace/workspace-bootstrap.ts` | Workspace baseline and initial member/context bootstrap. |
| `backend/src/domain/workspace/workspace-models.ts` | Workspace model settings validation/resolution. |
| `backend/src/domain/workspace/workspace-git.ts` | Git operations, baselines and file-change computation. |
| `backend/src/domain/workspace/workspace-reset.ts` | Workspace data reset helper (destructive; not invoked). |
| `.rsi/context/design/backend/domain/workspace/design.md` | Accepted subsystem design. |

## Implemented contract

`WorkspaceService` receives Store and filesystem collaborators; its input is workspace identity/name/directory/adoption/model data and it returns workspace records with context overview or typed errors. `ContextBase` uses `ContextStore` to load current sequence/tree, retrieve a file/history and commit versioned changes guarded by expected revision/sequence. Context files carry content, revision, author/time/reason; path index treats names case-insensitively. `DesignService` resolves validated metadata references into design docs and implementation mappings. `ProjectFiles` lists, reads, searches and saves text files within registered project root; `.git` and `.rsi` are hidden from project listing. Example: obtain workspace context overview, load current context sequence, then save against the read revision; resolve a design node from the context file map for Harness/Team.

Effects include Store persistence of versions/blobs/index/records and filesystem reads/writes; Git helper routines inspect repository state. Context limits include 2,000 tree entries, 200 find results, 100 search matches and 1,000-character reason. Context path segments are limited to 16 and total path length 512. `resetWorkspaceData(store)` is destructive and should only be called via authorized lifecycle; it was not run.

## Implementation notes

Potential design/code mismatch: parent Workspace design says reset clears context/member history while preserving registry and model settings. `workspace-reset.ts` includes `workspace_models`, `workspaces`, and `agents` in its deletion table list. Confirm whether this helper is legacy/test-only or violates intended contract before invoking. Workspace import boundaries and exact transaction guarantees should be verified from runtime wiring and Store implementation.

## Verification and continuation

Inspected exports/constants and source files; no tests/build run. Open: trace WorkspaceService methods and transaction logic; resolve reset discrepancy with Lead. No source or database changes were made.

## Automatic retrieval

```json
{"commands":[]}
```