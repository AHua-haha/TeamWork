<!-- Task proposal; current contract is under docs/systems/ -->

# Agent harness implementation

## Contract

[Harness design](design.md). Preserve per-member file isolation, independent part histories, user-only design acceptance, reusable tools and persist-before-publication checkpointing.

## Responsibilities and decomposition

HarnessService integrates workspace/member assignments with purpose-based harness definitions. It owns tool/prompt assembly, current file/command authority, semantic commit validation and member operation serialization. HarnessHistory owns Git worktrees, scoped snapshots/references, checkpoint/commit records, restoration and exact-revision review. MemberFiles supplies the common scoped filesystem operations. The [runtime](../../agent-runtime/design.md) owns the model loop and lifecycle hook; the [team](../team/design.md) owns assignments and group admission. Original-workspace context/catalog storage remains with the [context base](../context-base/design.md).

## Coordination and data flow

The existing assignment schema derives design/implementation purpose bundles; a typed in-process definitions provider can supply other bundles. Harness prompts and part prompts are assembled for each model call. Common file tools resolve current permissions again at execution and use the member's worktree root. Accepted working-design context reads the part's committed Git snapshot; pending files are exposed through the common file tools. Original design mappings still bound authority, so editing a design cannot expand permissions.

Each workspace has a private bare repository under a sibling `.rsi-harness/<hash-of-source-directory>/repository.git`. Source seeding respects Git ignore rules for ordinary files, includes context, omits links and excludes Git metadata. Detached linked worktrees live under the same managed storage, one per member ID. The application's original checkout/index/HEAD are untouched. Managed worktrees persist across retirement/restart and are not automatically removed.

Objects for workspace seed trees and scoped histories share this private repository. Scope identity hashes sorted managed paths/exclusions. References under `refs/harness/areas/<member>/<part>/<scope-key>/` hold checkpoint and base; `refs/harness/scopes/<scope-key>/committed` holds committed state. `refs/harness/runs/<member>/<run>/<part>/<scope-key>` records run snapshots even when the tree did not change. These refs preserve reachability for Git object retention.

Build snapshots in an alternate temporary GIT_INDEX_FILE from only owned regular-file paths, executable modes and hash-object blobs. write-tree and commit-tree create immutable state; update-ref advances pointers. Index files contain metadata/object IDs rather than copies of contents and are removed after use. Initial part state is imported from original-workspace files as the accepted baseline; a new work area materializes existing committed state if present. Missing future implementation paths yield empty initial trees.

Checkpoint records have `{revision, tree, kind, actor, message, time}` with actor type harness/agent/user plus member/run attribution. Automatic checkpoints and semantic commits have separate reference chains. A semantic commit snapshots/selects exact bytes, compares the current checkpoint, committed reference and work area's base, and advances committed/base refs in one Git reference transaction. User acceptance receives exact revision/base from review; agent commit arguments cannot supply a user actor.

Restore accepts only revisions reachable from that part's checkpoint/committed history, validates ownership/links, captures pending state, and materializes only that part. Deleted files are removed within the part; other parts are excluded. Restored content becomes a new checkpoint. Restoring current committed state also refreshes the work area's base. The previous tree is retained and restored on an operation failure where possible. This does not promise a distributed transaction between disk and Git.

Member file/command/review/commit/restore operations serialize through a member queue. Shared scope initialization/commits also serialize through a scope queue. Git reference compare-and-swap handles stale updates. One backend process per database remains required. Each Git invocation explicitly chooses the private repository and alternate index, clears inherited GIT_* settings, disables external hooks/fsmonitor/global config, uses argv without a shell, and bounds duration/output.

TeamSystem checkpoints before final group publication. Refused publications may continue and produce later snapshots. Runtime afterRun waits outstanding policy/tool effects, checkpoints failed/cancelled runs, and skips the already-checkpointed successful publication. Startup recovery invokes the same lifecycle callback with interrupted status before terminal database recovery. Checkpoint errors prevent successful publication/terminal claims. Retirement revokes further agent operations while finalization can still open and checkpoint retained state.

Backend review/history/commit/restore routes are implemented in the team transport adapter. They verify workspace/member membership, pin user actor identity and refuse user commit/restore while the member works. They add no configuration interface and do not integrate committed snapshots into the original workspace.

## Decisions and constraints

Design tooling uses common file operations rather than lead-specific read/save operations. Existing assignment configuration remains as requested; a new management/configuration model is deferred. Maintenance rules are text prompts. Programmatic scope definitions must be disjoint in one worktree. Dependencies remain read-only and preserve the original permission precedence. Commands use the private worktree but are not filesystem-confined. Accepted changes are stored in harness Git; publication into the original catalog and automatic integration into existing worktrees/branches are deferred. Manual restore of current committed scope state is supported.

## Code map

- [Scope storage, references, worktrees and restore](../../../../backend/src/harness-history.ts)
- [Member harness assembly and authority](../../../../backend/src/harness.ts)
- [Shared file/command/history/commit tool adapters](../../../../backend/src/harness-tools.ts)
- [File access](../../../../backend/src/member-files.ts), [command lifecycle](../../../../backend/src/harness-command.ts)
- [Existing assignment validation](../../../../backend/src/harness-config.ts)
- [Runtime integration](../../../../backend/src/team-system.ts), [backend review/acceptance routes](../../../../backend/src/team-routes.ts)
- [Design parsing](../../../../backend/src/design.ts); [runtime implementation](../../agent-runtime/impl.md) owns lifecycle/loop mechanics.

## Verification

[Git history tests](../../../../backend/test/harness-history.test.ts) exercise actual Git worktrees, scoped create/delete/restore, object-backed history/reopening, unchanged original Git index/HEAD, user-only commits, exact-byte reviews, stale bases, explicit refresh and foreign/link refusal. [File tests](../../../../backend/test/member-files.test.ts) exercise shared Pi file tools against worktree boundaries. [Harness tests](../../../../backend/test/harness.test.ts) cover mapping changes and command allowance/cwd/cancellation. [Request tests](../../../../backend/test/team-context.test.ts) verify prompt/tool assembly and context bounds. [Lead tests](../../../../backend/test/lead.test.ts) verify generic design editing and user acceptance. [HTTP tests](../../../../backend/test/team-routes.test.ts) exercise review/acceptance isolation and stale/busy refusal. [MySQL integration](../../../../backend/test/integration/backend.test.ts) verifies runtime semantic commits, end-of-run checkpoints, cancelled/failed work, checkpoint failure, cancellation effect ordering and interrupted-run recovery.
