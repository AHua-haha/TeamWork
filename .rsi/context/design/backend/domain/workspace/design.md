# Domain: Workspace

## Purpose, responsibilities and boundaries

Workspace owns the workspace registry, project file API, context base (design/implementation hierarchies), file versions, change records, and the workspace-scoped change feed. It decides *what can be stored as context*, *how files are versioned*, and *when a context change is valid*.

Workspace maintains the design tree (user-owned purpose/interface/constraints documents), implementation context (member-maintained impl/ trees), and their mappings to project source files. It tracks every file version with content hash, author, time, and reason. It generates the ordered change feed that followers consume.

Workspace never makes member activation decisions (that's Team), never owns the model loop (that's Agent), and never speaks HTTP (that's API). It calls Storage to persist records atomically and calls project-file operations through the file API.

## Interface contract

**Purpose and supported interactions.** Workspace provides:
- Workspace registry (create, list, get workspace records by ID or directory)
- Context base loading (current file tree at a sequence number)
- Context commits (atomic file version + index + change record writes)
- File history (versions of one file, newest first)
- Change feed (ordered change records for followers to consume)
- Design tree resolution (find design nodes, read design documents, resolve implementation mappings)
- Project file API (list, read, save files in the registered workspace directory)

**Required inputs and returned information.**
- `createWorkspace(name, directory, leadConfig, models?)` — creates registry entry, initializes context base, creates lead member
- `loadContext(workspaceId)` — returns sequence number + current file tree
- `commitContext(workspaceId, expectedSeq, commit)` — atomically stores versions, content, index changes, change record
- `listFiles(workspaceId, pathPrefix)` — returns project files under a path
- `saveFile(workspaceId, path, content, author, reason)` — writes file and commits context change
- `records(workspaceId, after, limit)` — returns change records starting after a cursor

**Observable effects.** Workspace calls Storage to persist context changes (versions, blobs, index, records) in one transaction. It reads/writes actual project files in the registered directory through the file API. Design changes wait for user approval before activation.

**Failure behavior.** Missing workspace, stale sequence number, invalid paths, file conflicts, duplicate directory keys fail explicitly (`not_found`, `backend_error`, `invalid_input`, `workspace_exists`). A failed commit writes nothing. Invalid design node references or malformed metadata fail validation.

## Constraints, specifications and requirements

- Workspace imports Foundation and Storage interfaces only
- Must not import concrete `MySqlStore`, API, Team, or Agent runtime
- Context base change records are numbered from 1 without gaps and are never removed
- File versions are immutable and never deleted
- Paths are matched case-insensitively; two paths differing only in case name one file
- Design content and implementation mappings remain opaque text to Workspace; it stores and versions them but does not interpret policy
- Workspace reset removes all context and member history but keeps registry and model settings
