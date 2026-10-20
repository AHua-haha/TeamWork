# Harness implementation

## Contract

See [design](design.md). Shared files, assignment-derived file-tool authority, independent scoped acceptance and real project Git are the principal guarantees.

## Responsibilities and decomposition

HarnessService resolves designs, fixed purpose bases, permissions, tools and prompts. MemberFiles checks internal backend file operations; agent tools use Pi defaults after invocation checks. HarnessHistory owns private scope snapshots/approval references. ProjectGit owns native implementation operations in the registered project repository. TeamRunner supplies workspace execution exclusion; the runtime holds that authority through finalization.

## Coordination and data flow

1. Resolve accepted working/dependency design mappings and separate design, implementation-context and source permissions. Return the registered workspace directory as every member environment. Do not create or hydrate member worktrees.
2. Initialize only the private bare history repository and scoped baselines. Shared scope refs/indexes retain management and implementation-context state; per-run refs retain attribution. Opening a new scope captures existing pending files without materializing any snapshot.
3. Agent tools use Pi factories with default operations. HarnessService.fileInvocation normalizes/checks the input path, bounds it to the workspace, checks resolved ancestors and applies harnessAccess/part ownership only for write/edit. HarnessService.files and MemberFiles remain internal backend management helpers. No permission operations are injected into agent Pi tools. Native content/details/truncation pass through unchanged. Custom management tools return readable summaries plus metadata. Custom Bash uses a persistent member-shell service and optional invocation-bound scoped Git bridge. Its resource policy allows system reads, whole-workspace and owned temporary writes, networking and no extra executable control.
4. Implementation Git delegates to ProjectGit on the root project repository/current branch, with one shared index. Validate paths, options, file kinds, staged authority and repository root. Enumerate authorized files and tracked deletions using NUL-separated literal paths for staging. Refuse unrelated staged changes. Native commit includes staged content only. Mirror the scoped accepted contents and project commit identity into private recovery/inspection history without changing pending files.
5. Design/member and per-node implementation-context Git retain independently controlled private staging/history. Run-end checkpoints use temporary indexes and never change native project staging or protected acceptance. Implementation snapshots respect Git ignore rules while preserving tracked files.
6. Accepted design baseline/pointers supply authority even when files are edited or deleted pending approval. Explicit user context saves remain accepted through their durable user-authored versions; filesystem-observed agent edits remain pending. User acceptance atomically updates exact reviewed design pointers. Member activation stays separate.

## Decisions and constraints

One shared directory eliminates synchronization and full member checkout copies. Existing legacy private worktrees are left untouched and unused, without auto-import. No automatic project commit or user working-tree reset occurs. Repository-root .git must be a directory; external linked metadata is unsupported. Metadata-selected Git commands remain finite and mediated; unscoped Git is native and broad Bash can write workspace metadata directly. An occupied shared index containing out-of-scope staged changes blocks a member commit and preserves those changes.

## Code map

- [Composition and workspace operation queue](../../../../backend/src/harness.ts), [fixed bases](../../../../backend/src/harness-bases.ts).
- [Private scope history](../../../../backend/src/harness-history.ts), [project Git](../../../../backend/src/project-git.ts).
- [File boundary](../../../../backend/src/member-files.ts), [Bash sandbox/bridge](../../../../backend/src/harness-command.ts), [execution resources](../../../../backend/src/harness-execution.ts), [tool adapters](../../../../backend/src/harness-tools.ts).
- [Design resolution](../../../../backend/src/design.ts), [bootstrap](../../../../backend/src/workspace-bootstrap.ts).
- [Rule prompts](../../../../backend/prompts/harness/common.md), [loader](../../../../backend/src/harness-prompts.ts).

## Verification

Harness/history tests cover shared pending visibility, no additional checkout creation, native project history/branch/index, preserving unrelated staging and unstaged edits, independent scope restore/approval, ignored build artifacts, sandbox/path restrictions and accepted-only authority. Implementation-context tests verify cross-member continuity in shared files. Disposable MySQL tests cover actual tools, handoffs, finalization exclusion, stop/cancellation, checkpointing and durable publication. Workspace bootstrap and HTTP review/activation tests remain required.

## Execution environment

[Tools](tools/design.md) and [Bash](tools/bash/design.md) own the detailed contracts. harness-execution creates one backend-session temporary area per workspace, with member shell homes/caches beneath it and a controlled environment that does not inherit arbitrary backend variables. harness-command starts one OS-sandboxed Bash per member, using SRT 0.0.79. Configuration has no read denies; write roots are the project and workspace temporary area. Deny SRT's extra host write-convenience paths outside those roots while preserving device/stdout behavior. macOS uses sandbox-exec; Linux requires bubblewrap and the runtime dependencies. Network proxies are shared for the backend lifetime. Per-shell socket allowances must be applied through updateConfig during serialized profile generation because SRT reads those settings globally.

The pipe-fed shell preserves state. A reserved high descriptor emits random per-invocation completion frames on the combined output pipe, avoiding cross-pipe output/completion races and ordinary script descriptor 9. Foreground eval executes in the parent shell with stdin /dev/null. Native background eval executes asynchronously with inherited stdout/stderr /dev/null, leaving explicit script redirection intact. Native jobs returns the handle and backend PID; only job_id is model-visible. Explicit background timers validate a job PID belongs to this shell before signalling its group. Shell reset snapshots descendant process groups and retains known background groups for cleanup even when the parent exits. Foreground timeout/cancellation awaits cleanup; no automatic replay occurs.

Optional git.scope creates a per-invocation broker token. The PATH Git shim routes calls with that token to scopedGit; unscoped calls execute the discovered native Git binary. Background jobs inherit their launch token rather than borrowing authority from subsequent calls. The shim is a workflow convenience, not an exclusive enforcement boundary: raw project metadata and absolute Git remain reachable under the broad policy. TeamRunner resets shell state/jobs at idle conversation reset, retirement and close; MemberConfigService resets changed/retired members after successful activation. TeamSystem administrative updates also reset the affected shell.

## Protected review implementation

HarnessService opens fixed management definitions directly from the active lead and workspace, without semantic design resolution or ensuring unrelated parts. HarnessHistory.review batches the three scope references in one for-each-ref call. Snapshot capture enumerates and bounds literal regular files, hashes all paths with hash-object --stdin-paths --no-filters, and verifies each returned object against the bytes observed by the scanner; a concurrent byte change refuses the capture. This same batched hashing replaces per-file processes for ordinary snapshots. An isolated index builds the tree through read-tree/update-index/write-tree; native and agent scope indexes remain untouched. Review reuses an unchanged checkpoint or records the changed tree, then compareSnapshots runs one name-status command and one combined patch command for all changed files (no patch command for empty changes). The Git subprocess output cap remains 128 MiB; oversized combined patch output fails explicitly. Preview patches retain their per-file 256-KiB truncation flag. It retains the existing immutable checkpoint revision/base shape for user approval. Agent staging and native project indexes are untouched. Existing full configuration inspection and run checkpoints keep their own responsibilities.

Verification: backend/test/change-review.test.ts checks 82 pending file changes with at most 24 Git commands, no full inspection/design resolution, staged-state preservation, untracked/deleted/quoted/binary files, link refusal and stale approval. Frontend Changes-client tests exercise coalescing, independent validation, errors, operations and disposal.
