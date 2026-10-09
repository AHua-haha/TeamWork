# Workspace

## Purpose and boundary

A workspace is one project: a directory on the backend's machine, its [context base](../context-base/design.md), and later its team. The Workspace module registers workspaces and serves the frontend's HTTP API for listing them and for browsing and editing the project's own files. It opens each workspace's context base on first use and closes them when the backend stops.

In this increment the project-file API lists, reads, saves, and finds files. It does not move or delete project files, keep their history, or deliver live updates; the project's own version control does that. Agent actions inside the workspace (files, commands, version control) are designed with the agent API.

## Inputs and preconditions

- **Workspace identity.** A workspace ID has 1–64 ASCII letters, digits, underscores, or hyphens; the backend assigns one when the request omits it. A name has 1–200 characters without control characters.
- **Directory.** An absolute path on the backend's machine, at most 1,024 characters. The backend stores its resolved real path. Two workspaces never share a directory or nest one inside the other, compared without letter case.
- **Create or adopt.** `adopt: false` creates a new project: the directory must not exist, or must be an empty directory, and the backend creates it. `adopt: true` uses an existing directory as it is.
- **Project paths.** Relative to the workspace directory and separated by `/`. A segment is not empty, `.`, or `..`, has at most 255 characters, and has no `\`, `:`, or control characters. The first segment is not `.git` or `.context`, in any letter case; those are hidden. A path never passes through a symbolic link.
- **Content.** The same text rules as the context base: UTF-8 without NUL characters, at most 1 MiB.

## Outputs and observable effects

| Operation | Request | Response |
| --- | --- | --- |
| List workspaces | `GET /workspaces` | 200, `{workspaces: [{workspaceId, name, directory, createdAt}]}`, ordered by name |
| Create or adopt | `POST /workspaces`, JSON `{workspaceId?, name, directory, adopt}` | 201, the workspace with `context`, its context overview |
| Get a workspace | `GET /workspaces/:workspaceId` | 200, the workspace with `context` |
| List project files | `GET /workspaces/:workspaceId/files/tree?path=&depth=` | 200, `{path, entries, truncated}` |
| Read a project file | `GET /workspaces/:workspaceId/files/file?path=` | 200, `{path, revision, content, size, updatedAt}` |
| Save a project file | `PUT /workspaces/:workspaceId/files/file?path=`, JSON `{content, baseRevision}` | 201 when created, 200 when updated, `{path, revision}` |
| Find project files | `GET /workspaces/:workspaceId/files/find?q=` | 200, `{paths, truncated}` |

- **Create.** Creating a workspace also opens its context base, which creates `.context/user/` and `.context/agent/` in the directory. Adopting a directory that already has a `.context/` folder records its files as the first change, authored by `external`.
- **List.** `path` names a folder; empty is the workspace directory. `depth` is 1–16 and defaults to 1. A file entry is `{path, type: "file", size, updatedAt}`; a folder entry is `{path, type: "folder"}`. Symbolic links and hidden folders are omitted. At most 2,000 entries are returned, ordered by path.
- **Read.** `revision` is the SHA-256 of the file's bytes, so any change on disk changes it.
- **Save.** `baseRevision: null` creates the file and its missing folders, and fails if the file exists. A non-null `baseRevision` must equal the current revision. The file is replaced in one step and keeps its permissions. Saving identical content changes nothing.
- **Find.** `q` is 1–200 characters, matched case-insensitively against file paths. The search goes level by level from the top, returns at most 200 paths, and stops after examining 50,000 entries; `truncated` says whether it stopped early.

Requests follow the context base's rules for fields, bodies, and errors.

## Failure behavior

| Status | Codes | When |
| --- | --- | --- |
| 400 | `invalid_input`, `invalid_path` | Malformed request, a relative directory, a path that breaks the rules or passes through a link, a folder where a file is expected |
| 404 | `not_found` | Missing workspace, file, or folder; an adopted directory that does not exist |
| 409 | `workspace_exists`, `file_exists`, `stale_revision` | A duplicate ID or a directory that overlaps another workspace; a non-empty directory for a new project; creating an existing file; an out-of-date `baseRevision` |
| 413 | `input_too_large` | Content over 1 MiB |
| 415 | `unsupported_file` | Reading a file that is binary, not UTF-8, or over 1 MiB |
| 503 | `workspace_unavailable`, `backend_error` | The directory is missing or unreadable; storage unavailable |

- A refused request changes nothing. If registering a new workspace fails, the directory the backend created for it is removed.
- A save checks the revision and replaces the file in one step, but an editor writing at the same moment can still win; the next read shows the result.

## Guarantees and limits

- Saves through the application never follow a link out of the workspace and never touch `.git` or `.context`.
- Workspaces survive restarts. A workspace whose directory was removed stays registered and reports `workspace_unavailable` until the directory returns.
- Prototype limits: no renaming or removing workspaces, no move, delete, history, or live updates for project files, and no ignore rules beyond the hidden folders.

## Acceptance examples

1. **New project.** The user creates `reading-list` at `/home/me/reading-list`, which does not exist. The response is 201, the directory exists with `.context/user/` and `.context/agent/`, and the overview has `seq` 0.
2. **Adopt.** The user adopts this repository. Listing the top shows `backend`, `docs`, and `frontend` as folders, and not `.git`.
3. **Overlap.** Adopting `/home/me/reading-list/docs` while `reading-list` exists returns 409 `workspace_exists`.
4. **Edit a project file.** The user reads `README.md`, edits it, and saves with its revision. The response has a new revision. Saving again with the old revision returns 409 `stale_revision`.
5. **Binary file.** Reading `frontend/public/icon.png` returns 415 `unsupported_file`.
6. **Find.** Finding `app.tsx` returns `frontend/src/ui/App.tsx`.
