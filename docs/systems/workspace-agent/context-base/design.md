# Context base

## Purpose and boundary

The context base stores a project's design and implementation context in parallel design and implement roots following the same systems and subdesigns. Each system's implementation context mirrors its design-node path. The tree is independent of member identity; there are no user/agent ownership categories.

A system's design may occupy one Markdown file or multiple Markdown documents within design/. Its implementation context independently uses one file or impl/. Multiple documents remain the same system. Creating a child system with its own boundary, design, implementation context and metadata is a separate decomposition decision.

Context stores information and versions. Purpose harnesses provide capabilities, scope, commit policy and maintenance instructions. Member configuration stays in .rsi/members, private Git/worktrees in .rsi/harness. Reusable knowledge is separate and deferred. Context does not store credentials, chat transcripts or project source code.

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

### Caller perspective and system boundaries

Both the Interface contract and Implemented contract describe the same system from its caller's perspective: what the system does, what it can be used for and how to use it. The design records intended behavior at design precision; the implemented contract records the concrete currently available interfaces, exact inputs/outputs/effects and usage examples. Implementation notes explain the realization as supporting context; they do not replace the caller-facing implemented contract.

Splitting one system's design or implementation context across several documents retains this same system boundary and mental model. Documents under design/ describe the enclosing system's intended capabilities and use; documents under impl/ describe its actual usable interfaces and realization. A topic document is not automatically a subsystem and does not become a private module contract merely because it is a separate file.

A real subdesign node represents a distinct subsystem boundary. It states what that subsystem does, what it can be used for and how its callers use it, with its own Interface contract and corresponding Implemented contract. Its caller may be the parent system or another system. The parent's contracts still describe the parent as a whole and remain sufficient for the parent's callers without requiring them to study child internals.

## Inputs and preconditions

### Node layout and references

The context container is .rsi/context, with design/ and implement/ roots. A node is identified by its design-root-relative metadata.json path: metadata.json for the project root, backend/metadata.json for a child. Parent folders express the hierarchy. Node folder names must satisfy context path rules and cannot be reserved design/impl content names or end in .md/.json. References may include the physical .rsi/context/design/ or raw design/ prefix; stored assignments use context-relative paths.

```text
.rsi/context/
  design/
    metadata.json
    design.md
    backend/
      metadata.json
      design/
        README.md
        request-flow.md
  implement/
    impl.md
    backend/
      impl/
        README.md
        contracts.md
```

Backend here is one system with several documents, without implied child systems. A true child such as backend/storage has its own metadata and both contexts. Working/dependency assignments cover exact nodes, not descendants.

metadata.json contains exactly {implementation: [project paths]}; no Markdown content, agent-supplied revisions or version fields. There are at most 50 distinct case-insensitive implementation paths, relative to the project, including . for the project root and excluding protected .rsi/.git paths. Paths can refer to future source files. These mappings remain user-approved design metadata.

Each node chooses design.md OR design/, independently impl.md OR impl/. Directory form requires README.md and may contain nested Markdown documents. There are 1–100 nonempty Markdown documents and at most 1 MiB of content in each complete context. Simultaneous single-file and directory content is invalid. Design discovery/acceptance and implementation-context semantic commits enforce the structural format; prose completeness follows harness prompts. Pending edits/checkpoints can retain incomplete intermediate structure for repair.

The complete design context, across its documents, retains purpose/responsibilities/boundaries, Interface contract and constraints/specifications/requirements. No fixed purpose/interfaces/requirements file split is required. Individual documents need not repeat the entire contract. The complete design context is sufficient at its caller boundary; actual child systems' internal documents are not required reading. Implementation context documents exact implemented Input, Output, Effect and Usage examples, plus useful implementation/verification/continuation facts.

### Raw file storage

- Raw paths are relative to .rsi/context and name design/ or implement/ for the two maintained purpose roots. Safe other text paths remain raw storage only and do not create semantic nodes. Segments have 1–128 ASCII letters, digits, spaces, dashes, underscores or dots, starting/ending with a letter, digit, dash or underscore. A path has at most 16 segments and 512 characters. Dot entries are reserved and ignored; unsafe names are problems.
- Paths differing only in case identify the same file. New folders keep existing disk spelling. Folders appear in listings while containing files; moving/deleting a folder affects every contained file, subject to write restrictions.
- Files are UTF-8 text without NUL, at most 1 MiB. Raw storage preserves text bytes exactly, including a byte-order mark, and does not parse node contents. Invalid node metadata/documents remain available for repair where text/path safety permits.
- Raw user file saves and backend-attributed file saves retain per-file revision protection, durability and ordered change records. The in-process saveDesign primitive is an attributed file save, not a multi-document semantic design-save tool. It receives lead/run author, nonempty reason and prior file revision, returns before/after bytes, and uses the same queue/rollback as user saves. No runtime tool can forge that author.
- The server binds to loopback without authentication; frontend raw file writes act for the user.

### Harness maintenance and accepted state

Agents edit their separate worktrees through common tools. Working-node implementation context can be read/edited/agent-committed; dependencies are read-only. Metadata/design commits require user acceptance. A directory representation does not create extra assignments or permissions. Lead management can create design nodes across the tree, including designs used as dependencies, without gaining unrelated implementation-context authority. Ordinary members read/follow working and dependency designs but cannot edit metadata or design prose.

Each working node has a stable impl-context-<hash> Git part (first 16 SHA-256 hex characters of lower-case metadata reference), covering both impl.md and impl/. Inspection and assembled prompts give the exact ID/paths. Staging/checkpoints/semantic commits remain independent of code and design/member history. General Bash cannot write .rsi; scoped Bash Git and file tools supply permitted edits. New members opening a scope inherit its committed context; current peers are not overwritten, and stale-base commits refuse.

User-accepted design Git snapshots feed semantic catalog/inspection and implementation permission resolution; pending bytes do not. Raw context APIs/history observe original-workspace files. Worktree commits are not copied into that original tree or existing peers. Design inspection returns separate Markdown documents with correct source paths, plus aggregate content and metadata; its revision covers all design files. Current multi-file inspection is an observation, not a transaction spanning concurrent edits. Reusable knowledge and automatic publication/merge/maintenance scheduling remain deferred.

New workspaces initialize design/metadata.json, design/design.md and implement/impl.md in one sequence-1 change. Old user/agent layout is not a compatibility content format. Safe but unresolvable active references remain inspectable/unready; execution and member-file validation cannot derive authority from them. Existing workspace files/history are not automatically reset or converted.

## Outputs and observable effects

### What the user may do

Read all current context files, versions and changes. The raw file API can create/edit/move/delete design and metadata files. The implement/ root is read-only through this API, including unsupported intermediate files. Folder mutation touching that root is refused as a whole. Design-folder operations affect the design tree only; they do not implicitly move corresponding implementation context or update assignments. Agents maintain their working implementation context through harness tools and independent Git history.

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

**Overview.** `{workspaceId, seq, files, bytes, problems}`. `seq` is the latest sequence number. Each problem is `{path, code, message}` for something on disk the context base cannot serve. Codes: `invalid_path` (a name that breaks the path rules), `duplicate_path` (names that differ only in case; neither is served), `not_text`, `too_large`, and `not_file` (a link or another special entry).

**List.**
- `path` names a folder; empty lists from the single context root, showing actual files and node/document directories. `depth` is 1–16 and defaults to 1.
- The response is `{seq, path, entries, truncated}`, ordered by path, with at most 2,000 entries.
- A file entry is `{path, type: "file", size, revision, updatedAt, author}`. A folder entry is `{path, type: "folder"}`.

**Read.** The response is `{path, revision, current, content, size, updatedAt, author, reason}`. With `path` it returns the current version. With `revision` it returns that version, and `current` says whether it is still current. `path` and `revision` are mutually exclusive.

**Save.**
- `path` is context-relative and must not name implementation context.
- `baseRevision: null` creates a file and fails if one exists. A non-null `baseRevision` updates the file and must be its current revision.
- The response is `{path, revision, seq}`. Saving content identical to the current version records nothing and returns the current revision with `seq: null`.

**Move or rename.**
- `from`, `to` and every affected file must be writable context paths. A move never puts a folder into itself and never replaces an existing file or folder. A rename that changes only letter case is allowed.
- A folder path moves every file in it. `baseRevision` applies only when `from` is a file.
- The response is `{seq, moved: [{from, to, revision}]}`.

**Delete.** `path` and every affected file must be writable context paths. A folder path deletes every file in it, and `baseRevision` applies only to a single file. The response is `{seq, deleted: [path]}`.

**History.**
- `path` names a current file, or else the most recent file that had that path.
- The response is `{versions, next}`. Each version is `{revision, seq, time, action, path, fromPath, size, author, reason}`; a delete has a null `revision` and `size`.
- `limit` is 1–200 and defaults to 50. `before` takes the `next` value of the previous page; `next` is null on the last page.

**Find.** `q` is 1–200 characters, matched case-insensitively against current file paths. The response is `{paths, truncated}`, ordered by path, with at most 200 paths.

**Search.** `q` is 1–200 characters, matched case-insensitively as plain text against the current content. `path` limits the search to a folder. The response is `{matches: [{path, line, text}], truncated}`, with at most 100 matches; `line` starts at 1 and `text` is at most 500 characters of the line.

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
| 403 | `read_only` | A save, move, or delete that touches implementation context |
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

Invalid metadata, missing/empty design documents, mixed forms, a missing README.md, non-Markdown document entries or structural limits make a node unavailable to semantic resolution. Raw text/history remains inspectable. Unsafe document entries surfaced by storage also prevent semantic design resolution. Missing mappings never grant permissive implementation authority. An invalid implementation-context semantic commit leaves staged/pending work intact. Checkpoints preserve pending work without accepting it.

## Guarantees and limits

- One tree groups design and implementation context by system identity, independently of agents.
- Markdown is the source of document content; JSON holds metadata only. File splitting and system decomposition are independent.
- Storage preserves immutable per-file history and ordered workspace change records with unchanged raw file atomicity/rollback.
- Access and semantic commit boundaries remain separate across purpose roots; dependencies and private metadata cannot be made writable through another document form.
- Content-maintenance prompts instruct reading/updating actual contracts and surfacing inconsistencies. There is no semantic prose validator or new runtime maintenance loop.
- Limits: 1 MiB per raw file; 100 documents/1 MiB per context representation; 2,000 listing entries, 200 find results and 100 search matches. One backend process owns the database. Context remains text-only.
- No automatic old-layout migration, original-workspace/peer refresh, merge, knowledge system or retention policy is introduced.

## Acceptance examples

1. Fresh create/adopt returns seq 1 with design/metadata.json, design/design.md and implement/impl.md, and a ready lead assigned to metadata.json; implementation mappings start empty.
2. Backend changes design.md into design/README.md and design/request-flow.md. Catalog still has one backend node; document paths and the combined revision update.
3. Backend independently uses design.md with an impl/ directory. Its metadata identity and context Git scope remain stable through the transition.
4. Adding backend/storage/metadata.json and complete child contexts creates a real subdesign. Reading backend/design/flow.md alone never creates a child system.
5. A member can read/edit/commit its working node's implementation context, read dependency context and access no child merely because it owns the parent.
6. Design Git cannot stage or restore impl.md/impl/ content, including content beside newly created nodes. Design acceptance validates the exact immutable reviewed metadata/Markdown tree.
7. A user raw save/move/delete under implement/ returns read_only. Moving design/backend leaves implement/backend untouched and keeps design-file history.
8. Invalid JSON-embedded design content, mixed forms or missing directory README makes the node unavailable; current raw files explain the issue.
9. A replacement member inherits committed multi-document context with the same metadata reference. Pending writer edits stay private and stale semantic commits refuse.
10. A backend-attributed file import records exact before/after content and author; the existing revision-based raw save/history/reconnect behavior remains applicable at category-free paths.
