> Existing behavior reference inside the aggregate implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

# Workspace

## Purpose and boundary

A workspace is one project: a directory on the backend's machine, its [context base](../context-base/design.md), and its [team](../team/design.md). The Workspace module registers workspaces and serves the frontend's HTTP API for listing them and for browsing and editing the project's own files. It also gives the workspace's agents file actions inside the directory. It opens each workspace's context base on first use and closes them when the backend stops.

The project-file API lists, reads, saves, and finds files. It does not move or delete project files, keep their history, or deliver live updates; the project's own version control does that. The agent file actions read and write the same folder, with an access rule that the caller supplies; the [harness](../harness/design.md) supplies the rule for each member. Command execution and scoped agent history belong to the harness.

## Inputs and preconditions

- **Workspace identity.** A workspace ID has 1–64 ASCII letters, digits, underscores, or hyphens; the backend assigns one when the request omits it. A name has 1–200 characters without control characters.
- **Directory.** An absolute path on the backend's machine, at most 1,024 characters. The backend stores its resolved real path. Two workspaces never share a directory or nest one inside the other, compared without letter case.
- **Create or adopt.** `adopt: false` creates a new project: the directory must not exist, or must be an empty directory, and the backend creates it. `adopt: true` preserves an existing project and initializes its reserved managed root; an existing .rsi entry is refused.
- **Project paths.** Relative to the workspace directory and separated by `/`. A segment is not empty, `.`, or `..`, has at most 255 characters, and has no `\`, `:`, or control characters. The first segment is not `.git` or `.rsi`, in any letter case; those are hidden. A path never passes through a symbolic link.
- **Content.** The same text rules as the context base: UTF-8 without NUL characters, at most 1 MiB.

### Agent file actions

Four actions work on the workspace folder for an agent: list, read, write, and edit. The agent calls them as Pi's coding-agent tools `ls`, `read`, `write`, and `edit`, so their inputs, limits, and results are those tools'. The workspace adds the rules below, which the tools cannot be used to get around. The caller names the workspace and gives an **access rule**: for each path, whether the agent may see it, read it, and write it, with a reason for each refusal.

- **Paths.** Relative to the workspace directory, or absolute inside it. A path outside the directory is refused. Unlike project paths, agent paths may include authorized `.rsi/context` and `.rsi/members` paths; `.git` is hidden, in any letter case. A path never passes through a symbolic link. Under `.rsi/context/` a segment follows the context base's name rules, so every file an action creates there is one the context base serves.
- **Access.** A path the rule does not let the agent see is not listed and is reported as missing. A path it may see but not read or write is refused with the rule's reason.
- **Content.** The same text rules as project files: UTF-8 without NUL characters, at most 1 MiB. Reading a larger or non-text file is refused.
- **Write and edit.** A file is replaced in one step and keeps its permissions. A write creates missing folders the rule lets the agent write in.
- **Search.** Agents receive native Pi grep/find in addition to read/ls. Read-only tools inspect workspace content freely; Bash has its separate broad resource policy.

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

- **Create.** Bootstrap creates the managed root, root metadata, design and implementation context and exact lead files/history before registering workspace, models, lead, activation marker and initial context versions in one transaction. The initial context sequence is 1 and contains root metadata and both Markdown contexts. No messages or runs are created. A failed filesystem preparation or database transaction removes this attempt's managed root and leaves the registry unchanged. Project files in an adopted directory are preserved.
- **List.** `path` names a folder; empty is the workspace directory. `depth` is 1–16 and defaults to 1. A file entry is `{path, type: "file", size, updatedAt}`; a folder entry is `{path, type: "folder"}`. Symbolic links and hidden folders are omitted. At most 2,000 entries are returned, ordered by path.
- **Read.** `revision` is the SHA-256 of the file's bytes, so any change on disk changes it.
- **Save.** `baseRevision: null` creates the file and its missing folders, and fails if the file exists. A non-null `baseRevision` must equal the current revision. The file is replaced in one step and keeps its permissions. Saving identical content changes nothing.
- **Find.** `q` is 1–200 characters, matched case-insensitively against file paths. The search goes level by level from the top, returns at most 200 paths, and stops after examining 50,000 entries; `truncated` says whether it stopped early.

Requests follow the context base's rules for fields, bodies, and errors.

Agent file actions have no HTTP form; the harness's tools call them inside the backend. Workspace members use common actions in the shared project directory under harness rules; design edits remain pending until user acceptance. ContextBase observes those same context files and records filesystem changes, which do not themselves grant design authority.

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

- Saves through the application never follow a link out of the workspace and never touch `.git` or `.rsi`.
- Agent file actions never follow a link out of the workspace, never touch `.git`, and never do what the access rule refuses.
- Workspaces survive restarts. A workspace whose directory was removed stays registered and reports `workspace_unavailable` until the directory returns.
- Prototype limits: no renaming or removing workspaces, no move, delete, history, or live updates for project files, no ignore rules beyond the hidden folders, and no move, delete, or revision check for the files an agent writes: the last write wins.

## Acceptance examples

1. **New project.** The user creates `reading-list` with a valid workspace model list/default at `/home/me/reading-list`, which does not exist. The response is 201, the directory exists with `.rsi/context/`, the overview has `seq` 1 with the root design, and the workspace's team has its lead assigned to metadata.json with its bundle present.
2. **Adopt.** The user adopts this repository. Listing the top shows `backend`, `docs`, and `frontend` as folders, and not `.git`.
3. **Overlap.** Adopting `/home/me/reading-list/docs` while `reading-list` exists returns 409 `workspace_exists`.
4. **Edit a project file.** The user reads `README.md`, edits it, and saves with its revision. The response has a new revision. Saving again with the old revision returns 409 `stale_revision`.
5. **Binary file.** Reading `frontend/public/icon.png` returns 415 `unsupported_file`.
6. **Find.** Finding `app.tsx` returns `frontend/src/ui/App.tsx`.
7. **Agent writes.** A member assigned an accepted working design mapping `src/backend` writes `src/backend/api.ts` in the shared workspace. Common tools can read/follow its working design. Only the lead receives design write/edit tool authority, and controlled design commits require user acceptance. Bash independently permits whole-workspace writes. The member may also edit its working-design implementation context, while dependency context remains read-only.
8. **Hidden from an agent.** A worker whose implementation scope does not include `frontend` cannot list or read its implementation; a dependency file can be read but not edited.
9. **Edit.** Editing `src/a.ts` with text that is not in the file is reported to the agent and leaves the file unchanged. A path like `../outside/secret.txt`, or one through a link, is refused.

## Workspace models

Create/adopt input includes models: {models: [{connectionId, modelId, reasoning?, temperature?, maxTokens?, contextBudget?}], defaultModel: {connectionId, modelId}}. Configure 1–50 unique connection/model choices with a default in that list. Provider/model/parameter validation completes before directory creation or registry writes. Workspace, model settings (revision 0), and the lead initialized with the default are stored atomically. A failure activates none of them.

GET /workspaces/:workspaceId/models returns {revision, value, issues}; value is the model list/default. Legacy workspaces may have an empty list with a null default and an actionable issue. PUT at that endpoint takes {revision, value}, validates the whole configuration, revision-checks and atomically stores it. It initializes only a lead with no assigned provider/model; other members keep their settings. New members use the current workspace default rather than the lead's current model. Model settings reads come from durable records. A changed default never silently rewrites assigned members. Existing choices unavailable at their provider remain visible with issues for repair. Startup derives model settings from legacy member selections once, without overwriting existing configuration.


## Fresh workspace bootstrap

Create and adopt initialize .rsi/context/design, .rsi/context/implement and .rsi/members, plus durable SQL bootstrap control content. New workspaces create no .rsi/harness, private Git repository or checkpoints. Project files and ordinary .git are preserved; the agent initializes/manages Git through Bash. Chat/configuration remain in SQL.

The backend creates `.rsi/context/design/metadata.json` containing only an empty implementation mapping and `.rsi/context/design/design.md` with purpose/responsibilities/boundaries, Interface contract and constraints/specifications/requirements. The initial lead selects `metadata.json` as its working design, has no dependencies and receives the fixed broad execute base, and uses the workspace default model. Its exact JSON/prompt bundle is present under `.rsi/members/<lead-id>/` before success. Backend bootstrap establishes the initial active source and member-config history baseline; later design/member edits still require normal user commit and separate member activation. Root-design assignment includes all accepted descendant design nodes and their implementation mappings. It grants no source authority beyond those accepted mappings; an empty tree therefore grants no project source edits.

Creating/adopting refuses an existing `.rsi` entry, including links or differently cased names, rather than overwriting unknown managed state. Adoption preserves project files and repository state. If bootstrap or registry persistence fails, remove only files/directories created by this attempt and leave no registered workspace/model/lead. Initial root design is visible through the design catalog and the lead is ready immediately when its chosen model is usable. Empty conversation history remains empty; bootstrap starts no run. Reopening does not recreate or accept later edits as a new baseline.

This prototype initializes fresh state; it does not migrate the old `.context`, `.team` or sibling `.rsi-harness` layout. The authorized local reset removes previous runtime/workspace records and managed state while preserving provider connections/credentials and project implementation. No reset HTTP endpoint is introduced.

Bootstrap also creates .rsi/context/implement/impl/README.md with a design reference and an Implemented contract outline containing Input, Output, Effect and Usage examples, plus implementation notes and verification/continuation sections. It marks interfaces as undocumented rather than claiming adopted projects have no implementation. All three files share the first stored change at sequence 1. Root context authority is independent of project-code mappings.
