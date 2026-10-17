# Context base

## Purpose and boundary

The context base is a workspace's memory. It keeps everything that must outlast a conversation as files in the workspace. In this prototype it holds two categories of context, divided by who owns them:

- **User context** holds the user's information: what the user wants the project to be and do, the choices the user has made, and how the user wants agents to work. The frontend changes it on behalf of the user. Member agents edit separate pending worktree copies through their harness; those edits do not directly change this original-workspace surface.
- **Agent context** holds what agents own while working on the project, such as private plans, progress, evidence, team records, and what they have learned. The user can read it but never needs to.

Each category is a tree of text files. The context base does not prescribe folders, file names, or formats. It:

- stores files and keeps every version;
- enforces who may change what;
- records every change in order, including changes made outside the application.

It does not interpret file contents or decide what work to do. It does not hold the project's own files, credentials, or conversation transcripts.

This document defines the HTTP API that the frontend uses to view and edit context and the attributed backend design-import capability. User design files carry content and corresponding implementation mappings. Agent harness-context maintenance and proposals remain deferred.

## Inputs and preconditions

- **Workspace.** Every workspace has a context base, stored in its project directory under `.rsi/context/user/` and `.rsi/context/agent/`. The [Workspace module](../workspace/design.md) creates and registers workspaces; opening a context base creates the two folders when they are missing.
- **Paths.** Every file has a path whose first segment is its category, `user` or `agent`. For example: `user/goals.md`, `agent/design/overview.md`.
  - Segments are separated by `/`. Each segment has 1–128 ASCII characters: letters, digits, spaces, `-`, `_`, and `.`. A segment starts and ends with a letter, digit, `-`, or `_`. Dot names are reserved for the context base and ignored on disk; other names that break these rules are listed as problems.
  - A path has at most 16 segments and 512 characters.
  - Two paths that differ only in letter case name the same file. A new file or folder takes the spelling of a folder that already exists on disk.
  - Folders exist only while they contain files. A new folder appears once a file is saved in it. Moving or deleting a folder moves or deletes every file in it.
- **Content.** A file holds UTF-8 text without NUL characters, at most 1 MiB. Any format is accepted. Bytes are kept exactly, including a byte-order mark.
- **Caller.** The frontend acts for the user. Like the rest of the backend, the server binds to loopback and has no authentication.
- **Revisions.** Every file version has a revision, an opaque string. A change to an existing file may name the revision it is based on.

### User design parts and attributed saves

A design part is a file in user context containing JSON `{content: "Markdown text", implementation: [project paths]}`. The mapping lists at most 50 distinct files/directories, workspace-relative, allowing `.` for the project root and excluding `.git` and `.rsi/context`. Paths may name future implementation. Designs can be arranged as subdesign files independent of team membership. Malformed design metadata prevents using that record as a harness reference but remains readable as ordinary raw context for repair. Current design discovery returns valid user-design summaries independently of team assignments; current inspection exposes raw content and metadata issues through read-only workspace design operations. Discovery inherits context listing limits and reports truncation.

The backend in-process attributed design save supplies the complete record, prior revision (null only to create), nonempty reason up to 1,000 characters, and lead/run author. It uses the same queue, revision protection, durability and sequence rules as user saves. It returns `{path, revision, seq, created, before, after, reason}` plus parsed design at the semantic boundary. A byte-identical save has null sequence and no new version. There is no HTTP operation that lets the user forge a lead author; existing user save/move/delete remain user-authored. Members use common tools to edit pending design copies in their harness worktrees. Those histories and user acceptance records belong to the harness; accepting them does not automatically publish them into this original context base.

## Outputs and observable effects

### What the user may do

- **User context:** read, create, update, move, and delete files.
- **Agent context:** read files, their history, and their changes. Changes through this API are refused with 403 `read_only`. To influence agent context, the user tells the lead.

### Versions and change records

- Every operation that changes files receives the workspace's next **sequence number** (`seq`) and one **change record**. An operation such as moving a folder applies whole or not at all, so it has one record listing all its files.
- **Change record:** `{seq, time, author, reason, files}`. Each entry in `files` is `{action, path, fromPath, revision}`. The action is `create`, `update`, `move`, or `delete`. `fromPath` is set for a move. `revision` is the new version, or null for a delete.
- **Author:** `{type: "user"}` for user API changes, `{type: "external"}` for outside changes, or `{type: "lead", memberId, runId}` for a design save by the workspace lead. Lead identifiers follow runtime identity rules.
- Every version of every file is kept. A move creates a version with the same content at the new path. Earlier versions, including versions of deleted files, can be read by revision. A file's history follows it across moves made through this API.

### Workspace-scoped operations

All paths below are under `/workspaces/:workspaceId/context`, written `…`:

| Operation | Request | Response |
| --- | --- | --- |
| Overview | `GET …` | 200, overview |
| List | `GET …/tree?path=&depth=` | 200, entries under `path` |
| Read | `GET …/file?path=` or `GET …/file?revision=` | 200, a file version with its content |
| Save | `PUT …/file?path=`, JSON `{content, baseRevision, reason?}` | 201 when created, 200 when updated |
| Move or rename | `POST …/move`, JSON `{from, to, baseRevision?, reason?}` | 200, the moved files |
| Delete | `POST …/delete`, JSON `{path, baseRevision?, reason?}` | 200, the deleted files |
| History | `GET …/history?path=&before=&limit=` | 200, versions, newest first |
| Find | `GET …/find?q=` | 200, file paths containing `q` |
| Search | `GET …/search?q=&path=` | 200, matching lines |
| Changes | `GET …/changes?after=&limit=` | 200, change records after `after` |
| Follow | `GET …/follow?after=` | SSE stream of change records |

**Overview.** `{workspaceId, seq, user: {files, bytes}, agent: {files, bytes}, problems}`. `seq` is the latest sequence number. Each problem is `{path, code, message}` for something on disk the context base cannot serve. Codes: `invalid_path` (a name that breaks the path rules), `duplicate_path` (names that differ only in case; neither is served), `not_text`, `too_large`, and `not_file` (a link or another special entry).

**List.**
- `path` names a folder; empty lists from the top, where the two categories always appear. `depth` is 1–16 and defaults to 1.
- The response is `{seq, path, entries, truncated}`, ordered by path, with at most 2,000 entries.
- A file entry is `{path, type: "file", size, revision, updatedAt, author}`. A folder entry is `{path, type: "folder"}`.

**Read.** The response is `{path, revision, current, content, size, updatedAt, author, reason}`. With `path` it returns the current version. With `revision` it returns that version, and `current` says whether it is still current. `path` and `revision` are mutually exclusive.

**Save.**
- `path` must be in `user/`.
- `baseRevision: null` creates a file and fails if one exists. A non-null `baseRevision` updates the file and must be its current revision.
- The response is `{path, revision, seq}`. Saving content identical to the current version records nothing and returns the current revision with `seq: null`.

**Move or rename.**
- `from` and `to` must be in `user/`. A move never puts a folder into itself and never replaces an existing file or folder. A rename that changes only letter case is allowed.
- A folder path moves every file in it. `baseRevision` applies only when `from` is a file.
- The response is `{seq, moved: [{from, to, revision}]}`.

**Delete.** `path` must be in `user/`. A folder path deletes every file in it, and `baseRevision` applies only to a single file. The response is `{seq, deleted: [path]}`.

**History.**
- `path` names a current file, or else the most recent file that had that path.
- The response is `{versions, next}`. Each version is `{revision, seq, time, action, path, fromPath, size, author, reason}`; a delete has a null `revision` and `size`.
- `limit` is 1–200 and defaults to 50. `before` takes the `next` value of the previous page; `next` is null on the last page.

**Find.** `q` is 1–200 characters, matched case-insensitively against current file paths. The response is `{paths, truncated}`, ordered by path, with at most 200 paths.

**Search.** `q` is 1–200 characters, matched case-insensitively as plain text against the current content. `path` limits the search to a folder or category. The response is `{matches: [{path, line, text}], truncated}`, with at most 100 matches; `line` starts at 1 and `text` is at most 500 characters of the line.

**Changes.** The response is `{records, seq, more}`, with records in `seq` order. `after` defaults to 0. `limit` is 1–500 and defaults to 100.

**Follow.**
- Every SSE data event is `{version: 1, type, workspaceId, …}`, and the SSE `event` field equals `type`:
  - `record` carries one change record in `record`;
  - `sync` carries the current `seq` once every record after `after` has been sent;
  - `stream_error` carries `code` and `message` before the stream closes.
- The stream stays open until the client closes it. SSE comment heartbeats keep it alive.
- Records are never dropped. A client that reconnects with the last `seq` it applied receives every later record once, in order.

**Requests and errors.** Unknown request fields and query parameters are rejected. Workspace IDs use 1–64 ASCII letters, digits, underscores, or hyphens. Request bodies are JSON, at most 4 MiB. A `reason` is at most 1,000 characters. Errors are JSON `{error: {code, message}}`:

| Status | Codes | When |
| --- | --- | --- |
| 400 | `invalid_input`, `invalid_path` | Malformed request, unknown fields, content with NUL or invalid Unicode, a move into itself or onto the same path, a path that breaks the rules |
| 403 | `read_only` | A save, move, or delete that touches agent context |
| 404 | `not_found` | Missing workspace, file, folder, or revision |
| 409 | `file_exists`, `stale_revision`, `invalid_cursor` | Creating or moving onto an existing file or folder, an out-of-date `baseRevision`, `after` beyond the current `seq` |
| 413 | `input_too_large` | Content over 1 MiB or a body over 4 MiB |
| 415 | `invalid_input` | A body that is not JSON |
| 503 | `workspace_unavailable`, `backend_error` | The workspace directory is missing or unreadable; storage unavailable |
| 500 | `corrupt_data` | Stored versions or records unreadable |

## Failure behavior

- A refused operation changes nothing.
- A save, move, or delete based on an out-of-date revision is refused with 409 `stale_revision`. The frontend reads the current version and lets the user retry, so two browser tabs cannot overwrite each other unknowingly.
- Each operation applies whole or not at all, on disk and in the stored history. If storing the record fails, the files on disk are restored.
- **Changes outside the application.** The files live in the workspace, so the user, an editor, or `git checkout` may change them directly. Each such change is recorded as a version authored by `external`, and the follow stream delivers it.
  - A workspace's context base opens on the first request to the workspace after the backend starts and stays open until the backend stops. Opening it scans its files and records the changes made while the backend was not watching. The first request waits for the scan.
  - While it is open, a file watcher records outside changes, normally within a second. Changes noticed together, such as those from one `git checkout`, form one change record.
  - Every operation also compares the files with what was recorded before it runs, so a change the watcher missed is recorded before the operation sees the files.
  - An outside move, including a change of letter case only, is recorded as a delete and a create. The application's own changes are never recorded as `external`.
  - A file that becomes a problem, for example by becoming binary, is recorded as deleted and listed in `problems`.
- If the workspace directory is missing, operations return 503 `workspace_unavailable` and change nothing; the next request tries again. If storage is unavailable, operations return 503 `backend_error` and no partial change is visible. Unreadable stored versions or records return 500.
- On the follow stream, a failure sends `stream_error` and closes. The client reconnects from its last applied `seq`.

## Guarantees and limits

- **Durable.** Recorded versions and records survive the end of conversations and restarts of the application. Current files are the files on disk.
- **User-governed.** Through the application, user context changes through the user's saves, moves and deletes or attributed backend design saves. Attributed backend saves return exact before/after content and a reason, and retain their author in history and the change feed. No agent runtime tool directly performs this save. The frontend never changes agent context.
- **Complete history.** Every recorded version is kept, with its author, time, and reason. A deleted file's versions remain readable. Outside changes are kept as the application observes them, so several outside edits between two observations become one version.
- **Ordered.** Operations on one workspace apply one at a time in the order of their sequence numbers. The change records have no gaps, so a follower after any `seq` receives every later change.
- **Visible.** The user can read everything in both categories.
- Fixed limits: 1 MiB per file, 2,000 entries per listing, 200 find results, 100 search matches.
- Text files only. One backend process serves a database, so a workspace is never open in two processes.
- Deferred:
  - automated agent harness-context maintenance and proposal operations;
  - proposals and their review in the frontend;
  - fixed folder layout and additional semantic context formats;
  - links between user and agent context, marking agent context affected by a change in user context, consolidation, and health checks;
  - version retention.

## Acceptance examples

1. **Start.** The user creates the workspace `reading-list`. The overview shows no files and `seq` 0, and listing shows the `user` and `agent` folders.
2. **Create a file.** The user saves `user/goals.md` with `baseRevision: null`. The response is 201 with `seq` 1, and the follow stream delivers record 1, authored by the user.
3. **Concurrent edits.** The user edits `user/goals.md` in two browser tabs. The second save returns 409 `stale_revision`, and the frontend offers to reload or to save over the latest version.
4. **Rename a folder.** The user moves `user/spec` to `user/requirements`. All its files move in one record. The history of `user/requirements/books.md` includes its versions under the old path.
5. **Read-only agent context.** Listing `agent` shows `agent/design/overview.md`, and the user reads it. Saving it returns 403 `read_only`.
6. **External edit.** With the workspace open in the app, the user changes `user/spec.md` in an editor. Within about a second the follow stream delivers a version authored by `external`, and the frontend refreshes the file.
7. **Restore.** From the history of `user/spec.md`, the user reads an earlier revision and saves its content as current with the reason "Restore". The history shows every version.
8. **Reconnect.** After a restart, the frontend follows with its last applied `seq` and receives every record it missed before `sync`.
9. **Changes while closed.** With the backend stopped, the user runs `git checkout`, which changes two user-context files and removes one. After the next start, the first request to the workspace waits for the scan, which records all three changes in one record authored by `external`.
10. **Problem file.** The user copies `photo.png` into `.rsi/context/user/`. It is not listed, and the overview's `problems` names it with `not_text`.

11. **Attributed backend design import.** A backend design save records one attributed version and change and returns its exact previous/resulting content. Agent pending edits and their approval instead use harness history. A stale revision leaves the file unchanged.
