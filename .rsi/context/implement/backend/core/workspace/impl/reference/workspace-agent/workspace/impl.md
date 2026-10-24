> Existing behavior reference inside its owning system implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

# Workspace implementation

## Contract

[Workspace design](design.md). The workspace registry is stored in the [database](../../../../../team/impl/reference/database/design.md). Each workspace's context base follows the [Context base implementation](../context-base/impl.md).

## Responsibilities and decomposition

- `WorkspaceService` owns:
  - the registry operations: list, get, and create or adopt;
  - one open context base per workspace, kept until shutdown;
  - a cache of workspace records;
  - a project-file view for each request.
- `ProjectFiles` serves one workspace folder: path rules, list, read, save, find, and internal kind inspection for mapped implementation paths. It holds no state between requests.
- The workspace routes map `/workspaces` requests to the service, the project files, the context base, and DesignService current catalog/inspect operations. Semantic design validation belongs to the [design parts implementation](../context-base/design-parts/impl.md); routes expose only current reads. The agent server sends every `/workspaces` request to them, except team requests.
- The neighboring [harness](../../../../../harness/impl/reference/workspace-agent/harness/design.md) owns MemberFiles and agent file tools; it authorizes write/edit input paths from accepted working/dependency mappings while allowing broad read-only workspace discovery. Pi default operations remain unchanged. Bash independently provides whole-workspace/system-read authority. Workspace supplies project-file reads/listings for user inspection and on-demand agent tools.
- The shared HTTP helpers are used by every route: agent, config, and workspace. They read bounded JSON bodies, reject unknown fields and query parameters, parse counts, write JSON, map errors to responses, abort work when the client disconnects, and send SSE streams.
- The text helpers apply the same text rules and hashing to project files and context files.
- The backend entry point creates the workspace service with the MySQL store, passes it to the agent server, and closes it on shutdown or a failed start.

## Coordination and data flow

**Create or adopt.** The service checks the ID, name, directory, and `adopt` before queuing. Creates then run one at a time, so the overlap check sees every earlier workspace. Each create:
1. refuses an existing ID;
2. resolves the planned real path:
   - adopting requires an existing folder;
   - a new project requires a missing path or an empty folder, and resolves the real path of its nearest existing parent;
3. compares the planned path, without letter case, with every registered directory, in both directions;
4. creates the folder for a new project;
5. creates the .rsi bootstrap files, shared workspace and static SQL baseline; then stores the record, together with the workspace's lead from `newLead`, in one store call: the SHA-256 of the lower-cased real path is its directory key, whose unique key also stops another process from registering the same directory at the same time, and the lead's record is initialized from the validated workspace default. The store registers workspace, model settings, lead, activation marker and initial context record in one transaction.

Model choices/default and provider parameters are validated before any directory creation. If storing fails, the managed root and any project folder this attempt created are removed, and no workspace, model record or lead is left. The response is `get`, which opens the context base using its already stored initial design/context versions and returns its overview.

**Opening context bases.** The first request for a workspace starts `ContextBase.open` and caches the pending result, so concurrent requests share one open. A failed open is removed from the cache, so the next request tries again, for example after a missing folder returns.

**Project files.**
- Every operation first checks that the workspace folder is a folder; otherwise it fails with 503 `workspace_unavailable`.
- It then checks each step of the path with `lstat`. A link fails with `invalid_path`, as does a step before the last one that is not a folder.
- **List** goes level by level and stops after 2,000 entries, so shallow entries come first. It omits invalid names, hidden top-level folders, links, and special entries.
- **Save** compares the SHA-256 of the current bytes with `baseRevision`, writes a new temporary file next to the target, copies the old file's permission bits, and renames it over the target. A new file's missing folders are created first.
- **Find** goes level by level and stops after 200 matches or 50,000 examined entries.

**Shutdown.** `close` refuses new requests with 503, waits for a pending create, and closes every open context base.

## Decisions and constraints

- **Project revisions are content hashes.** Project files have no stored history, so the revision must come from the file itself. Any change on disk, by any tool, changes it.
- **No project-file watcher.** The project's own version control and editors own those files. The frontend reloads the project tree on request.
- **Real paths.** The registry stores real paths. Overlap uses lower-cased real paths, so a link to another workspace's folder, or a case variant of it on a case-insensitive disk, is refused.
- **Workspace records do not change.** The service caches them for the life of the process.
- **Request bodies.** Workspace requests accept bodies up to 4 MiB, enough for 1 MiB of content after JSON escaping. Agent and config requests keep their own limits.

## Code map

- [Workspace service](../../../../../../../../../../backend/src/core/workspace/workspace.ts): registry, create and adopt, and context bases.
- [Project files](../../../../../../../../../../backend/src/core/workspace/project-files.ts): project path rules, list, read, save, find, and internal kind inspection for mapped implementation paths.
- [Harness implementation](../../../../../harness/impl/reference/workspace-agent/harness/impl.md): scoped agent file operations and their access rules.
- [Workspace routes](../../../../../../../../../../backend/src/api/workspace-routes.ts): `/workspaces` endpoints.
- [HTTP helpers](../../../../../../../../../../backend/src/api/http-helpers.ts) and [agent server](../../../../../../../../../../backend/src/api/http.ts): shared transport, and routing to agents, config, and workspaces.
- [Text rules](../../../../../../../../../../backend/src/core/text.ts): shared text decoding, encoding, and hashing.
- [Backend entry point](../../../../../../../../../../backend/src/runtime/main.ts) and [package exports](../../../../../../../../../../backend/src/api/index.ts): wiring and shutdown.
- [Workspace tests](../../../../../../../../../../backend/test/workspace.test.ts), [project-file tests](../../../../../../../../../../backend/test/project-files.test.ts), [route tests](../../../../../../../../../../backend/test/workspace-routes.test.ts), [in-memory store](../../../../../../../../../../backend/test/memory-store.ts), and [integration tests](../../../../../../../../../../backend/test/integration/backend.test.ts).

## Verification

Workspace tests cover:
- creating and adopting;
- overlap and empty-folder rules;
- removing the folder when registration fails;
- a missing folder reporting `workspace_unavailable` until it returns.

Project-file tests cover path rules, hidden folders, listing depth and order, refusing binary files and links, create and update saves with stale revisions and kept permissions, and find.

Route tests send requests through the agent server over an in-memory connection, so they need no network. They cover registering and listing workspaces, project and context endpoints, status codes and error codes, unknown fields and query parameters, and the follow stream.

The MySQL integration tests register a workspace with the MySQL store, refuse a duplicate ID, folder, or overlapping folder, and reopen the workspace in a second service.

## Workspace model coordination

workspace-models.ts owns the strict model-list/default shape and projects a selected profile into RunSettings. WorkspaceService validates every configured model with ConfigService. GET returns the durable record and current provider issues; PUT validates and revision-checks the complete record. The store locks the workspace row, saves workspace_models, and initializes only an unconfigured lead with a generated accepted source bundle in that transaction. Default edits preserve configured members. New creation and file submission obtain default settings here rather than copying the lead.

Startup initializes missing legacy workspace_models once from active members' selected models in lead-first order, retaining selected per-model options; no selections yield an empty repairable record. Existing records are never overwritten by discovery. Model records are read independently of context files and additional checkout creation.

[Workspace models](../../../../../../../../../../backend/src/core/workspace/data/models.ts), [model tests](../../../../../../../../../../backend/test/workspace-models.test.ts), [HTTP tests](../../../../../../../../../../backend/test/workspace-routes.test.ts), and [SQL integration](../../../../../../../../../../backend/test/integration/backend.test.ts) cover invalid input without side effects, atomic lead initialization, conflicts, preservation and reopen durability.


## Bootstrap coordination

A workspace layout module owns filesystem paths and a bootstrap helper creates the managed root, root metadata and both Markdown contexts and exact lead bundle, then prepares the static SQL design/member baseline. WorkspaceService performs model/path/overlap validation first, runs bootstrap before registry storage, and rolls its files back on failure. The store registers workspace, models, lead and bootstrap activation marker in one transaction. ContextBase opens the already persisted initial three-file context index through its category-free logical context API. No private harness Git store is initialized. Project files hide the managed root; write/edit inputs protect scoped management/context paths, while read-only Pi tools and Bash can inspect the workspace and Bash can write all of it. Legacy harness storage is not maintained; broader read/Bash tools may still access it.

Verification covers new/adopted workspace, immediate root-design/member inspection, no pending bootstrap edits, default model, empty implementation permissions, restarts, collision/symlink refusal, failure rollback and implementation preservation. The local cleanup uses a stopped backend, its database ownership lock and explicit workspace-managed paths; provider records and credentials are retained.

[Bootstrap](../../../../../../../../../../backend/src/core/workspace-bootstrap.ts) prepares initial files/baseline and the initial ContextCommit. [Layout](../../../../../../../../../../backend/src/core/workspace/workspace-layout.ts) names the managed paths. [Administrative reset](../../../../../../../../../../backend/src/core/workspace-reset.ts) and its CLI preserve all non-agent config records, acquire the runtime ownership lock, quarantine explicit managed paths, delete dependent runtime records in one transaction, restore quarantined paths on failure, then remove them after commit. No HTTP or agent reset operation exists. [Bootstrap tests](../../../../../../../../../../backend/test/workspace-bootstrap.test.ts) and disposable MySQL reset tests verify those effects and exclusions.

The reset discovers which known application tables exist so it can clear earlier prototype schemas without first migrating them. Unknown dependent tables cause transaction refusal and file restoration rather than disabling foreign-key checks. Provider records are not rewritten or decrypted.

Bootstrap renders design-template.md and implementation-context-template.md, with root metadata.json stored separately as {implementation:[]}. It writes design/metadata.json, design/design.md and implement/impl/README.md before atomic SQL bootstrap persistence. Its ContextCommit arrays contain three files in one seq=1 record persisted with workspace/models/lead/activation. ContextBase uses one category-free root and aggregate file counts. Tests verify metadata-only JSON, Markdown templates, clean initial control content, SQL reopen durability and rollback. Existing files/assignments are not silently converted; unresolved references remain unavailable to execution until explicitly repaired/reset.

## Member context document entry point

New workspace bootstrap creates implement/impl/README.md using the implementation-context template, with Result summary, File lookup and a reserved JSON Automatic retrieval section beside the precise Implemented contract. Ordinary file tools maintain documents under existing permissions; both supported document forms remain available for explicit conversion. No per-activation document parser, automatic retrieval or retained-failure composition exists. Agent context persists independently of project document storage.