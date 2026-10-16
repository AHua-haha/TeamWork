# Workspace

## Purpose and boundary

A workspace is one project: a directory on the backend's machine, its [context base](../context-base/design.md), and its [team](../team/design.md). The Workspace module registers workspaces and serves the frontend's HTTP API for listing them and for browsing and editing the project's own files. It also gives the workspace's agents file actions inside the directory. It opens each workspace's context base on first use and closes them when the backend stops.

The project-file API lists, reads, saves, and finds files. It does not move or delete project files, keep their history, or deliver live updates; the project's own version control does that. The agent file actions read and write the same folder, with an access rule that the caller supplies; the [harness](../harness/design.md) supplies the rule for each member. Command execution and scoped agent history belong to the harness.

## Inputs and preconditions

- **Workspace identity.** A workspace ID has 1–64 ASCII letters, digits, underscores, or hyphens; the backend assigns one when the request omits it. A name has 1–200 characters without control characters.
- **Directory.** An absolute path on the backend's machine, at most 1,024 characters. The backend stores its resolved real path. Two workspaces never share a directory or nest one inside the other, compared without letter case.
- **Create or adopt.** `adopt: false` creates a new project: the directory must not exist, or must be an empty directory, and the backend creates it. `adopt: true` uses an existing directory as it is.
- **Project paths.** Relative to the workspace directory and separated by `/`. A segment is not empty, `.`, or `..`, has at most 255 characters, and has no `\`, `:`, or control characters. The first segment is not `.git` or `.context`, in any letter case; those are hidden. A path never passes through a symbolic link.
- **Content.** The same text rules as the context base: UTF-8 without NUL characters, at most 1 MiB.

### Agent file actions

Four actions work on the workspace folder for an agent: list, read, write, and edit. The agent calls them as Pi's coding-agent tools `ls`, `read`, `write`, and `edit`, so their inputs, limits, and results are those tools'. The workspace adds the rules below, which the tools cannot be used to get around. The caller names the workspace and gives an **access rule**: for each path, whether the agent may see it, read it, and write it, with a reason for each refusal.

- **Paths.** Relative to the workspace directory, or absolute inside it. A path outside the directory is refused. Unlike project paths, the first segment may be `.context`, which holds only `user/` and `agent/`; `.git` is hidden, in any letter case. A path never passes through a symbolic link. Under `.context/` a segment follows the context base's name rules, so every file an action creates there is one the context base serves.
- **Access.** A path the rule does not let the agent see is not listed and is reported as missing. A path it may see but not read or write is refused with the rule's reason.
- **Content.** The same text rules as project files: UTF-8 without NUL characters, at most 1 MiB. Reading a larger or non-text file is refused.
- **Write and edit.** A file is replaced in one step and keeps its permissions. A write creates missing folders the rule lets the agent write in.
- **No search.** This version has no content search or glob for agents. Pi's `grep` and `find` read the disk themselves, so the access rule could not limit them. They come with a search the rule can scope.

## Outputs and observable effects

| Operation | Request | Response |
| --- | --- | --- |
| List workspaces | `GET /workspaces` | 200, `{workspaces: [{workspaceId, name, directory, createdAt}]}`, ordered by name |
| Create or adopt | `POST /workspaces`, JSON `{workspaceId?, name, directory, adopt, models}` | 201, the workspace with `context`, its context overview |
| Get a workspace | `GET /workspaces/:workspaceId` | 200, the workspace with `context` |
| List project files | `GET /workspaces/:workspaceId/files/tree?path=&depth=` | 200, `{path, entries, truncated}` |
| Read a project file | `GET /workspaces/:workspaceId/files/file?path=` | 200, `{path, revision, content, size, updatedAt}` |
| Save a project file | `PUT /workspaces/:workspaceId/files/file?path=`, JSON `{content, baseRevision}` | 201 when created, 200 when updated, `{path, revision}` |
| Find project files | `GET /workspaces/:workspaceId/files/find?q=` | 200, `{paths, truncated}` |

- **Create.** Creating a workspace also creates its [team](../team/design.md) with the team's lead, and opens its context base, which creates `.context/user/` and `.context/agent/` in the directory. The workspace, model settings and lead initialized with the default model are registered together: if any cannot be stored, none is, and a directory the backend created is removed. Adopting a directory that already has a `.context/` folder records its files as the first change, authored by `external`.
- **List.** `path` names a folder; empty is the workspace directory. `depth` is 1–16 and defaults to 1. A file entry is `{path, type: "file", size, updatedAt}`; a folder entry is `{path, type: "folder"}`. Symbolic links and hidden folders are omitted. At most 2,000 entries are returned, ordered by path.
- **Read.** `revision` is the SHA-256 of the file's bytes, so any change on disk changes it.
- **Save.** `baseRevision: null` creates the file and its missing folders, and fails if the file exists. A non-null `baseRevision` must equal the current revision. The file is replaced in one step and keeps its permissions. Saving identical content changes nothing.
- **Find.** `q` is 1–200 characters, matched case-insensitively against file paths. The search goes level by level from the top, returns at most 200 paths, and stops after examining 50,000 entries; `truncated` says whether it stopped early.

Requests follow the context base's rules for fields, bodies, and errors.

Agent file actions have no HTTP form; the harness's tools call them inside the backend. Workspace members use these common actions through harness rules in their separate worktrees; design edits remain pending until user acceptance. A file an action changes under `.context/` is an outside change for the context base, recorded as an `external` version the next time the context base looks, and a file it changes elsewhere is like any other change made outside the application.

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
- Agent file actions fail with the same codes where they apply, and add `access_denied` (403) for a path the access rule refuses to read or write. A path that is missing or not visible is `not_found`. The tools report a failure to the agent in words, and an edit whose text does not match exactly once is reported by Pi's `edit` and changes nothing.
- A save checks the revision and replaces the file in one step, but an editor writing at the same moment can still win; the next read shows the result.

## Guarantees and limits

- Saves through the application never follow a link out of the workspace and never touch `.git` or `.context`.
- Agent file actions never follow a link out of the workspace, never touch `.git`, and never do what the access rule refuses.
- Workspaces survive restarts. A workspace whose directory was removed stays registered and reports `workspace_unavailable` until the directory returns.
- Prototype limits: no renaming or removing workspaces, no move, delete, history, or live updates for project files, no ignore rules beyond the hidden folders, and no move, delete, or revision check for the files an agent writes: the last write wins.

## Acceptance examples

1. **New project.** The user creates `reading-list` with a valid workspace model list/default at `/home/me/reading-list`, which does not exist. The response is 201, the directory exists with `.context/user/` and `.context/agent/`, the overview has `seq` 0, and the workspace's team has its lead.
2. **Adopt.** The user adopts this repository. Listing the top shows `backend`, `docs`, and `frontend` as folders, and not `.git`.
3. **Overlap.** Adopting `/home/me/reading-list/docs` while `reading-list` exists returns 409 `workspace_exists`.
4. **Edit a project file.** The user reads `README.md`, edits it, and saves with its revision. The response has a new revision. Saving again with the old revision returns 409 `stale_revision`.
5. **Binary file.** Reading `frontend/public/icon.png` returns 415 `unsupported_file`.
6. **Find.** Finding `app.tsx` returns `frontend/src/ui/App.tsx`.
7. **Agent writes.** A member assigned an accepted working design mapping `src/backend` writes `src/backend/api.ts` in its managed worktree. Common tools can edit its working design as pending changes; design commits require user acceptance. Agent context remains read-only.
8. **Hidden from an agent.** A worker whose implementation scope does not include `frontend` cannot list or read its implementation; a dependency file can be read but not edited.
9. **Edit.** Editing `src/a.ts` with text that is not in the file is reported to the agent and leaves the file unchanged. A path like `../outside/secret.txt`, or one through a link, is refused.

## Workspace models

Create/adopt input includes models: {models: [{connectionId, modelId, reasoning?, temperature?, maxTokens?, contextBudget?}], defaultModel: {connectionId, modelId}}. Configure 1–50 unique connection/model choices with a default in that list. Provider/model/parameter validation completes before directory creation or registry writes. Workspace, model settings (revision 0), and the lead initialized with the default are stored atomically. A failure activates none of them.

GET /workspaces/:workspaceId/models returns {revision, value, issues}; value is the model list/default. Legacy workspaces may have an empty list with a null default and an actionable issue. PUT at that endpoint takes {revision, value}, validates the whole configuration, revision-checks and atomically stores it. It initializes only a lead with no assigned provider/model; other members keep their settings. New members use the current workspace default rather than the lead's current model. Model settings reads come from durable records. A changed default never silently rewrites assigned members. Existing choices unavailable at their provider remain visible with issues for repair. Startup derives model settings from legacy member selections once, without overwriting existing configuration.
