<!-- Task proposal; current contract is under docs/systems/ -->
# Workspace implementation

## Contract

[Workspace design](design.md). The workspace registry is stored in the [database](../../database/design.md). Each workspace's context base follows the [Context base implementation](../context-base/impl.md).

## Responsibilities and decomposition

- `WorkspaceService` owns:
  - the registry operations: list, get, and create or adopt;
  - one open context base per workspace, kept until shutdown;
  - a cache of workspace records;
  - a project-file view for each request.
- `ProjectFiles` serves one workspace folder: path rules, list, read, save, find, and internal kind inspection for mapped implementation paths. It holds no state between requests.
- The workspace routes map `/workspaces` requests to the service, the project files, and the context base. The agent server sends every `/workspaces` request to them, except team requests.
- The neighboring [harness](../harness/design.md) owns MemberFiles and agent file tools; it supplies the access rule from design mappings. Workspace supplies project-file reads/listings for context delivery.
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
5. stores the record, together with the workspace's lead from `newLead`, in one store call: the SHA-256 of the lower-cased real path is its directory key, whose unique key also stops another process from registering the same directory at the same time, and the lead's record is the team's initial one. The store registers both in one transaction.

If storing fails, the folder the service created is removed, and no workspace or lead is left. The response is `get`, which opens the context base and returns its overview.

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

- [Workspace service](../../../../backend/src/workspace.ts): registry, create and adopt, and context bases.
- [Project files](../../../../backend/src/project-files.ts): project path rules, list, read, save, find, and internal kind inspection for mapped implementation paths.
- [Harness implementation](../harness/impl.md): scoped agent file operations and their access rules.
- [Workspace routes](../../../../backend/src/workspace-routes.ts): `/workspaces` endpoints.
- [HTTP helpers](../../../../backend/src/http-helpers.ts) and [agent server](../../../../backend/src/http.ts): shared transport, and routing to agents, config, and workspaces.
- [Text rules](../../../../backend/src/text.ts): shared text decoding, encoding, and hashing.
- [Backend entry point](../../../../backend/src/main.ts) and [package exports](../../../../backend/src/index.ts): wiring and shutdown.
- [Workspace tests](../../../../backend/test/workspace.test.ts), [project-file tests](../../../../backend/test/project-files.test.ts), [route tests](../../../../backend/test/workspace-routes.test.ts), [in-memory store](../../../../backend/test/memory-store.ts), and [integration tests](../../../../backend/test/integration/backend.test.ts).

## Verification

Workspace tests cover:
- creating and adopting;
- overlap and empty-folder rules;
- removing the folder when registration fails;
- a missing folder reporting `workspace_unavailable` until it returns.

Project-file tests cover path rules, hidden folders, listing depth and order, refusing binary files and links, create and update saves with stale revisions and kept permissions, and find.

Route tests send requests through the agent server over an in-memory connection, so they need no network. They cover registering and listing workspaces, project and context endpoints, status codes and error codes, unknown fields and query parameters, and the follow stream.

The MySQL integration tests register a workspace with the MySQL store, refuse a duplicate ID, folder, or overlapping folder, and reopen the workspace in a second service.
