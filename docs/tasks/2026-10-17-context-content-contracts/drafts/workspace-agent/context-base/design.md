<!-- Task proposal; current contract is under docs/systems/ -->
# Context base

## Purpose and boundary

The context base stores the project information needed to preserve understanding across tasks and member changes. Its content has two conceptual parts: **design** and **implementation context**. Both are organized around the project's systems and design decomposition, independently of the members currently assigned to them.

The context directory is storage for this information. Purpose harnesses define the tools, access boundaries and rules agents follow to read, change and maintain it. The runtime runs agents with the context and tools their harnesses provide. Member configuration belongs in the member directory; agent worktrees and Git metadata belong in harness storage.

Reusable knowledge that can be applied independently of this project's implementation is a separate concern outside the context base. Its organization and maintenance are deferred. No separate knowledge category is introduced here.

The prototype realizes this content model with ordinary files and purpose-harness instructions. Design section completeness and implemented-contract documentation are prompt-level maintenance requirements, with filesystem authority enforced by the harness. No new semantic parser, specialized maintenance tool or model-loop workflow is introduced.

The storage API preserves ordinary text files and immutable versions in the original workspace. Agent edits use private harness worktrees and scoped Git history. Accepted Git state is not automatically copied into original-workspace context/history or existing peers. This system does not store provider credentials, conversation transcripts or implementation source code.

## Content model

### Design

Design describes the user's intended system: what the system should be and the agreement implementation follows. A caller should be able to understand what the system provides and how to use it at the design level without studying implementation internals.

Each design unit has three parts:

1. **Purpose, responsibilities and boundaries.** Why the system exists, what it owns and where its responsibility ends.
2. **Interface contract.** What the system does, what it can be used for and how callers interact with it. It declares:
   - its purpose and supported interactions;
   - required inputs and returned information;
   - observable effects and failure behavior;
   - relevant lifecycle rules and guarantees.
3. **Constraints, specifications and requirements.** The conditions, restrictions and requirements the system must satisfy.

The interface contract establishes intended behavior at design precision. It need not settle exact class/method signatures, HTTP routes, wire schemas, serialization or invocation syntax. Observable effects include changes to persistent storage or other state when relevant to callers. Failure and lifecycle guarantees remain part of the design even when concrete error representations or interface syntax are still undecided.

A system may expose a class, function, HTTP endpoint, tool, event stream, data type or another interface form. Describe the interface according to its form. Operation is not a required universal unit: for example, a class interface may describe construction, supported interactions, public state and lifecycle.

### Implementation context

Implementation context explains the actual realization maintained by agents while implementing the design. It preserves consistency across tasks and lets an agent quickly search or grep the relevant implementation understanding without reconstructing it from conversations or reading the whole codebase.

It follows the corresponding system/design decomposition and remains useful when a member is replaced. Relevant decomposition, coordination, decisions, code relationships, verification and unfinished work can be recorded here as needed; their Markdown outline is described below. Project-specific facts needed to explain the realization belong here. Reusable knowledge is outside this content model.

### Implemented contract

Implementation context must contain the **implemented contract** corresponding to the design's interface contract. For every concrete exposed interface it must clearly document:

1. **Input.** Exact parameters or accepted information, applicable types/structure and preconditions needed to use it correctly.
2. **Output.** Exact returned information and applicable types/structure, including errors or failure results.
3. **Effect.** Changes to persistent storage, files, runtime state and other observable behavior; document relevant ordering, lifecycle or failure effects.
4. **Usage examples.** Concrete examples showing how to use the actual implemented interface.

The documentation identifies the concrete class, function, endpoint, tool or other exposed interface sufficiently precisely for a caller to find and invoke/use it. A class is documented in its actual form, including relevant constructors, methods, public properties and lifecycle. Other interface forms receive their corresponding details. The exact source-level/wire details belong here even when the interface contract left them undecided.

An implemented contract describes working code. Intended or unfinished interfaces must not be presented as already implemented. Each interface contract has a corresponding implemented contract as its implementation is delivered; the implementation documentation and code must stay consistent with that design.

## Inputs and preconditions

- **Workspace.** Every workspace has a context base, stored in its project directory under `.rsi/context/user/` and `.rsi/context/agent/`. The [Workspace module](../../../../../systems/workspace-agent/workspace/design.md) creates and registers workspaces; opening a context base creates the two folders when they are missing.
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

### Paired implementation context and maintenance

The physical root is .rsi/context. Logical user/... files store design records in the existing JSON {content: Markdown, implementation: project paths} format. Logical agent/... files store the corresponding implementation context as Markdown. These names remain storage/API categories; implementation context is organized by design and is not owned by an agent identity. A design user/<path> has paired implementation context agent/<lower-cased-path>.md. The entire filename, including its extension, is preserved. The derived path must satisfy existing context path/segment limits. No independent member-config field controls this mapping.

New workspaces initialize user/design.json and agent/design.json.md together in the first context version/change. Root design Markdown has the three agreed sections; implementation-context Markdown has an Implemented contract section explicitly covering input, output, effect and usage examples, with initial content accurately marked as not yet documented. Existing design parsing, context HTTP transport and discovery remain applicable. The user can inspect implementation context through existing read/history APIs; user writes to the agent category remain read-only. Agent context edits use the harness worktree/file tools.

For each working design the implementation harness grants a separate one-file context scope with an agent-commit policy. Its ID is impl-context- followed by the first 16 hexadecimal characters of SHA-256 of the lower-cased logical design path. The exact ID/path are shown in harness inspection and assembled instructions. Use normal Bash Git commands with metadata.git.scope selecting that ID. Context staging/commits are independent of code and user-approved design/member scopes. Dependency paired files can be read/search but not edited, staged for mutation or committed by that member. General Bash does not gain .rsi write access.

Context semantic commits use existing shared scope references; a replacement/new member opening the same design's context scope inherits its latest committed state even when its other assignments differ. Pending edits/checkpoints are retained in the writer's private worktree/history. Existing peers do not receive automatic overwrites; stale bases require the existing review/restore flow. Directory names and relevant context-file paths are given to the agent so it can use existing file tools or scoped read-only Bash search. No separate search tool is added.

Prompt rules require reading applicable designs and implementation context before work, updating actual implemented interfaces and examples when they change, preserving continuation facts, and making design/code/documentation inconsistencies explicit. Reusable knowledge is deferred outside this context. These are instructions to the agent, not an automatic guarantee that a model always completes correct documentation. Existing file safety, history/checkpoint, text limits and failure behavior continue to apply. This increment does not rewrite existing workspaces or add an automatic context publication/merge/maintenance workflow.

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

Missing/outdated implemented contracts are context inconsistencies to correct. Agents are instructed to surface design/code/context disagreements and correct implementation/context or propose user-visible design changes. These instructions are not semantic validation of model output.

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
- Content maintenance is instructed through purpose-harness prompts; access and Git policies are enforced by the backend. No semantic section validator or automatic maintenance loop is introduced.
- Reusable knowledge organization, automatic peer publication/merge, invalidation/consolidation/health checks and version retention policies are deferred. Existing workspaces are not reset or rewritten; members may create missing paired context files within their assignments.

## Acceptance examples

1. **Start.** The user creates the workspace `reading-list`. The overview shows one design and one implementation-context file at `seq` 1. Both templates are in the same initial change; root implementation mappings are empty.
2. **Create a file.** The user saves `user/goals.md` with `baseRevision: null`. The response is 201 with `seq` 2, and the follow stream delivers record 2, authored by the user.
3. **Concurrent edits.** The user edits `user/goals.md` in two browser tabs. The second save returns 409 `stale_revision`, and the frontend offers to reload or to save over the latest version.
4. **Rename a folder.** The user moves `user/spec` to `user/requirements`. All its files move in one record. The history of `user/requirements/books.md` includes its versions under the old path.
5. **Read-only agent context.** Listing `agent` shows `agent/design/overview.md`, and the user reads it. Saving it returns 403 `read_only`.
6. **External edit.** With the workspace open in the app, the user changes `user/spec.md` in an editor. Within about a second the follow stream delivers a version authored by `external`, and the frontend refreshes the file.
7. **Restore.** From the history of `user/spec.md`, the user reads an earlier revision and saves its content as current with the reason "Restore". The history shows every version.
8. **Reconnect.** After a restart, the frontend follows with its last applied `seq` and receives every record it missed before `sync`.
9. **Changes while closed.** With the backend stopped, the user runs `git checkout`, which changes two user-context files and removes one. After the next start, the first request to the workspace waits for the scan, which records all three changes in one record authored by `external`.
10. **Problem file.** The user copies `photo.png` into `.rsi/context/user/`. It is not listed, and the overview's `problems` names it with `not_text`.

11. **Attributed backend design import.** A backend design save records one attributed version and change and returns its exact previous/resulting content. Agent pending edits and their approval instead use harness history. A stale revision leaves the file unchanged.

12. **Scoped maintenance and continuity.** A member assigned working design A and dependency B may edit/commit A’s paired implementation context, read B’s context and search both, but cannot edit B or unrelated context. A replacement newly opening A’s context scope inherits committed context; pending writer checkpoints remain private.
13. **Implemented class interface.** A design describes a queue’s intended lifecycle. Its implementation context documents the actual class, constructor/method inputs, returned values/errors, state effects and usage examples without forcing an operation-only schema.
