# Context base implementation

## Contract

[Context base design](design.md). Current files are the files under `.context/user/` and `.context/agent/` in the workspace folder. The store holds the index of current files, every version, the content of every version, and the change records. The [Workspace module](../workspace/design.md) registers workspaces and opens each workspace's context base; the [database](../../database/design.md) stores its data.

## Responsibilities and decomposition

- `ContextBase` serves one workspace. It owns:
  - the index of current files, keyed by the lower-cased path;
  - the workspace's latest `seq` and its problem list;
  - the operation queue, the file watcher, and the change notification;
  - the operations of the design: overview, list, read, save, attributed saveDesign, move, delete, history, find, search, changes, and follow.
- The [design parts child](design-parts/design.md) interprets structured user-design records and implementation mappings; ordinary context remains free-form text.
- `Batch` builds one operation's stored change: new versions, content blobs, removed and added index rows, and the change record with its files ordered by path.
- `DiskChange` performs one operation's disk steps and keeps the steps that undo them. After the change is stored, it deletes the replaced files and removes emptied folders.
- `ContextStore` is the storage contract: the workspace registry, loading the index, committing a change, and reading blobs, versions, history, and records. The MySQL store implements it; tests use an in-memory store.
- `Changes` is a versioned in-process notification. It is shared with the agent runtime.
- The text helpers decide what counts as text, encode caller content, and hash bytes. The project-file API uses the same rules.
- The workspace routes parse and validate HTTP requests and call the operations. The shared HTTP helpers read bodies, check query parameters, write JSON, map errors to responses, and send SSE streams.

## Coordination and data flow

**Opening.** `ContextBase.open` loads the index and `seq` from the store, then reconciles the files on disk with the index. If opening fails, the context base closes and the workspace service forgets it, so the next request opens it again.

**Operations.** Each operation:
1. checks its input before it is queued: path rules, the `user/` category for user and lead changes, the reason length, and the content encoding and size;
2. runs in the queue, one at a time per workspace;
3. reconciles before it reads the index, so it sees every outside change.

Reading a version by revision, `changes`, and `follow` read the store only and do not reconcile.

**Changes through the API.**
1. A save, move, or delete changes the disk first:
   - a save writes a temporary file and renames it over the target; the replaced file is first renamed to a trash name;
   - a move renames the file or folder, creating the destination folder;
   - a delete renames each file to a trash name.
2. It then stats the result and builds one `Batch`, authored by the supplied user or lead actor for saves, and by the user for moves/deletes.
3. `commit` calls `commitContext` with the `seq` the index was loaded at. Only after the store accepts it does the index change, `seq` advance, and the notification publish.
4. `finish` deletes the trash and prunes folders emptied up to the category roots. If any step before it fails, `undo` reverses the disk steps in the opposite order and prunes the folders it created.

**Attributed design saves.** `save` and `saveDesign` share private `saveFile`: revision validation, reconcile, unchanged detection, disk replacement, batch commit and rollback. The lead variant validates member/run IDs and returns exact before/after content and reason. The user wrapper keeps its existing API shape. DesignService owns JSON interpretation; ContextBase remains format-independent.

**New paths.** A new path keeps the spelling of folders that already exist on disk. It fails with `file_exists` when the target exists, or when an existing ancestor is not a folder, has an invalid name, or has a duplicate that differs only in case. A move whose source and target differ only in case renames the last segment in place.

**Reconcile.**
1. Check that the workspace folder exists, then create the category folders and check that `.context` and both categories are real folders. Otherwise fail with 503 `workspace_unavailable`.
2. Start the watcher if none is running on the current `.context` folder.
3. Scan both categories. Dot entries are skipped. Names that differ only in case, invalid names or paths, special entries, and files over 1 MiB become problems; invalid folders are not walked.
4. Compare each remaining file with the index:
   - unchanged path, size, and modification time: skip;
   - the same size and time as a file already found not to be text: still a problem, without reading it;
   - otherwise read the bytes; a file that is not text becomes a problem;
   - the same content hash: only update the stored modification time in memory.
5. Build one `Batch` authored by `external`: a delete for every indexed file that is no longer served, an update for changed content at the same path, and a delete plus a create when the spelling differs. A non-empty batch commits like any other change.

**Watcher.** A recursive watcher on `.context` schedules a reconcile 150 ms after the last event. The scheduled reconcile runs in the queue like an operation. The watcher and its timer do not keep the process alive. If the watcher fails or cannot start, the next reconcile starts it again; until then each operation still reconciles first.

**Follow.**
1. Read the notification version, then send the stored records from the cursor up to the current `seq`, at most 500 per read. A missing or out-of-order record fails with `corrupt_data`.
2. Send `sync` once, after the first catch-up.
3. Wait for a notification newer than the version read in step 1, then repeat.

Because the version is read before the records, a commit that lands during the catch-up is never missed. The SSE helper reads the first event before it sends headers, so `invalid_cursor` keeps its HTTP status. A later failure sends `stream_error` with the workspace ID.

**Closing.** `close` stops the watcher and timer, wakes followers so their streams end, and waits for the queue.

## Decisions and constraints

- **Disk holds current files.** Users and editors see and change ordinary files. The index caches path, revision, content hash, size, modification time, author, and reason, so reads and listings do not walk the disk.
- **Revisions are random UUIDs.** Two versions with identical content are still different versions. Content is stored once per workspace and SHA-256 hash.
- **File identity.** A file ID follows a file across API moves, so its history continues under the new path. The watcher cannot tell a move from a delete and a create, so an outside move records a new file. History for a path that no longer exists follows the most recent file that had it.
- **The disk change comes first.** A failed store commit is undone on disk. Replaced and deleted files are kept under trash names until the store accepts the change. If the process stops between the disk change and the commit, the next reconcile records the disk state as an `external` change.
- **One process per workspace.** The store accepts a commit only at the expected `seq`. A second process that changed the workspace makes the commit fail with 503 instead of interleaving records.
- **Reconciles are cheap.** They compare size and modification time before reading content, and remember files that are not text.
- **Search reads current files from disk.** Without a full-text index, its cost grows with the size of the context.
- **Platform.** Recursive watching depends on the platform's file events. Where it is unavailable, outside changes are recorded on the next request instead of within a second.

## Code map

- [Context base](../../../../backend/src/context-base.ts): path rules, `ContextStore`, `Batch`, `DiskChange`, `ContextBase`, the reconcile scan, and the watcher.
- [Change notification](../../../../backend/src/changes.ts): versioned notification for followers.
- [Text rules](../../../../backend/src/text.ts): text decoding and encoding, the 1 MiB limit, and hashing.
- [Workspace routes](../../../../backend/src/workspace-routes.ts) and [HTTP helpers](../../../../backend/src/http-helpers.ts): the context endpoints, request validation, error responses, and SSE.
- [MySQL store](../../../../backend/src/database.ts) and [codec](../../../../backend/src/codec.ts): storage and record validation (see the [database implementation](../../database/impl.md)).
- [Context base tests](../../../../backend/test/context-base.test.ts) and [in-memory store](../../../../backend/test/memory-store.ts): behavior on real temporary folders.

## Verification

Context base tests run each operation against a temporary folder and the in-memory store. They cover:
- path rules;
- create, update, stale and conflicting saves, and read-only agent context;
- folder spelling on disk;
- folder moves with history, and case-only renames;
- deletes with readable history;
- outside edits, creates, and moves recorded before the next operation;
- problems and ignored dot entries;
- changes recorded when reopening;
- undo after a failed commit;
- find, search, list, and history paging;
- change paging and cursor errors;
- follow replay, `sync`, and live records;
- the watcher recording an outside change without a request. This test is skipped where the platform delivers no file events, as in some sandboxes.

Lead tests additionally check attributed exact changes and unchanged/stale saves. The MySQL integration tests check the store against a real database: a save and a move reload with their history, and a change from this process is refused and undone on disk after another process stored a change. The [route tests](../../../../backend/test/workspace-routes.test.ts) cover the context endpoints over HTTP.
