# Harness implementation

## Contract

See [design](design.md). Shared files, assignment-derived authority, independent protected acceptance and real project Git are the principal guarantees.

## Responsibilities and decomposition

HarnessService resolves designs, fixed purpose bases, permissions, tools and prompts. MemberFiles checks file operations. HarnessHistory owns private scope snapshots/approval references. ProjectGit owns native implementation operations in the registered project repository. TeamRunner supplies workspace execution exclusion; the runtime holds that authority through finalization.

## Coordination and data flow

1. Resolve accepted working/dependency design mappings and separate design, implementation-context and source permissions. Return the registered workspace directory as every member environment. Do not create or hydrate member worktrees.
2. Initialize only the private bare history repository and scoped baselines. Shared scope refs/indexes retain management and implementation-context state; per-run refs retain attribution. Opening a new scope captures existing pending files without materializing any snapshot.
3. File/Bash operations and user scope review serialize on the workspace operation queue. Bash keeps OS sandbox, bounded process groups/output and invocation-bound Git broker; broad outbound networking and local binding use initialized sandbox proxies. All Bash calls can write accepted implementation paths only, irrespective of Git metadata. Git metadata cannot select an arbitrary repository/index or bypass scope rules.
4. Implementation Git delegates to ProjectGit on the root project repository/current branch, with one shared index. Validate paths, options, file kinds, staged authority and repository root. Enumerate authorized files and tracked deletions using NUL-separated literal paths for staging. Refuse unrelated staged changes. Native commit includes staged content only. Mirror the scoped accepted contents and project commit identity into private recovery/inspection history without changing pending files.
5. Design/member and per-node implementation-context Git retain independently controlled private staging/history. Run-end checkpoints use temporary indexes and never change native project staging or protected acceptance. Implementation snapshots respect Git ignore rules while preserving tracked files.
6. Accepted design baseline/pointers supply authority even when files are edited or deleted pending approval. Explicit user context saves remain accepted through their durable user-authored versions; filesystem-observed agent edits remain pending. User acceptance atomically updates exact reviewed design pointers. Member activation stays separate.

## Decisions and constraints

One shared directory eliminates synchronization and full member checkout copies. Existing legacy private worktrees are left untouched and unused, without auto-import. No automatic project commit or user working-tree reset occurs. Repository-root .git must be a directory; external linked metadata is unsupported. Git commands remain finite and mediated. An occupied shared index containing out-of-scope staged changes blocks a member commit and preserves those changes.

## Code map

- [Composition and workspace operation queue](../../../../backend/src/harness.ts), [fixed bases](../../../../backend/src/harness-bases.ts).
- [Private scope history](../../../../backend/src/harness-history.ts), [project Git](../../../../backend/src/project-git.ts).
- [File boundary](../../../../backend/src/member-files.ts), [Bash sandbox/bridge](../../../../backend/src/harness-command.ts), [execution resources](../../../../backend/src/harness-execution.ts), [tool adapters](../../../../backend/src/harness-tools.ts).
- [Design resolution](../../../../backend/src/design.ts), [bootstrap](../../../../backend/src/workspace-bootstrap.ts).
- [Rule prompts](../../../../backend/prompts/harness/common.md), [loader](../../../../backend/src/harness-prompts.ts).

## Verification

Harness/history tests cover shared pending visibility, no additional checkout creation, native project history/branch/index, preserving unrelated staging and unstaged edits, independent scope restore/approval, ignored build artifacts, sandbox/path restrictions and accepted-only authority. Implementation-context tests verify cross-member continuity in shared files. Disposable MySQL tests cover actual tools, handoffs, finalization exclusion, stop/cancellation, checkpointing and durable publication. Workspace bootstrap and HTTP review/activation tests remain required.

## Execution environment
A dedicated execution-environment builder resolves host toolchain paths at first execution in the backend session and their real targets, supplies a controlled PATH and isolated home/cache/tmp, and builds the fixed broad network/resource policy. It never inherits arbitrary backend environment variables. macOS exposes the DNSConfiguration service and both canonical and alias spellings of toolchain/system paths so localhost proxy resolution works under read restrictions. Session cache homes use owner-only temporary storage outside the project and are removed at drained backend shutdown. A region read-deny for .rsi contents retains explicit assigned context/member exceptions beneath broad source read access. A session-wide initialized SandboxManager owns network proxies; invocation wrapping coordinates global configuration and supplies explicit filesystem policy. Reset is not performed while other commands can be running. Protected Git operations remain brokered and all ordinary Bash commands follow one filesystem path.
