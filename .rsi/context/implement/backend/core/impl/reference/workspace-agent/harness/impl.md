> Existing behavior reference inside the aggregate implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

# Harness implementation

Permission and approval enforcement below describes the default enabled mode. The operator's optional startup setting `harnessPermissionsEnabled: false` bypasses harness permission gates; semantic validation, user activation and runtime lifecycle rules remain in force.

## Contract

[Harness](design.md) composes purpose tools/prompts and enforces explicit commit permission without owning repository history.

## Responsibilities and decomposition

HarnessService owns assignment-derived native file invocation checks, permission inspection, control-file reads and purpose composition. [Tools](tools/design.md) owns native tool reuse; [Bash](tools/bash/design.md) owns persistent execution and the sandbox. GitApprovals owns commit candidate classification and pending user decisions. workspace-git contains ordinary read-only repository/file/diff utilities and the operation queue. HarnessHistory and the old ProjectGit scoped command service are removed.

## Coordination and data flow

DesignService.working resolves explicit working roots plus accepted descendant metadata records, deduplicated with case-insensitive path-segment matching. It shares the accepted Git/baseline snapshot across those reads, preserves canonical casing, excludes document directories and pending-only nodes, and refuses invalid accepted children or truncated scans. resolveHarness combines these effective nodes with explicitly read dependencies; permissions, purpose resources, runtime prompts, member inspection and conversation README retrieval consume the same expansion. The stored member assignment remains unchanged.

Native file tools retain default Pi operations after input checks. Harness resources describe file authority/prompts, never Git scope identity or staging. Bash detects explicit commits and sends actual argv, cwd and a narrow environment through an invocation token. GitApprovals resolves the workspace repository, prepares a temporary ordinary index for the actual candidate (including -a), and classifies no-renames changed paths against protected roots and accepted project-wide implementation mappings. Unknown paths and mixed protected/implementation candidates refuse. Protected-only candidates publish a pending approval; implementation-only candidates continue directly.

Review includes immutable candidate diff/command data. After Accept, copy/prepare the current candidate again and compare tree and HEAD. Copied indexes retain conservative timestamps so native Git rechecks possibly racy stat entries after fast same-size edits. Own the short native index.lock during execution, commit the reviewed candidate through a sandboxed Git executor with hooks disabled, and atomically replace the ordinary native index on success. An error preserves native staging; finally remove temporary candidate data and the owned lock. These transient preparation indexes produce no scope refs, checkpoint commits or second history. Denial/feedback return to the waiting tool without executing Git commit. Abort removes pending state; no decision is replayed after backend restart. No checkpoint callback runs before group publication, afterRun or interruption recovery.

Workspace bootstrap writes context/member files once and records a static SQL workspace_git_baselines row. Existing workspaces import accepted content from legacy private refs once using read-only Git commands. This preserves accepted data without overwriting pending files. The baseline is not updated on each edit/run/commit. Committed reads use current project HEAD once protected paths have ordinary history, with baseline fallback before then. DesignService retains user-context-save precedence and normal structural validation. Active member exact sources and activation markers remain SQL state; member activation reads committed files, independently of pending edits. Read paths never recreate deleted member files. Legacy private directories remain on disk but are not maintained.

## Decisions and constraints

One shared workspace and normal .git eliminate worktree synchronization and duplicated histories. Write/edit dependency checks remain, while Bash keeps broad resource authority. The commit gate is explicit-command workflow control, not complete interception of indirect scripts or manual Git. Supported commit flags and repository limits are in the contract. Changes views use temporary ordinary files and one Git no-index diff; no private objects or refs are generated for review. The approval decision path bypasses the occupied tool-operation queue so a waiting Bash call cannot block its own UI resolution.

## Code map

- [Composition](../../../../../../../../../backend/src/core/harness.ts), [bases](../../../../../../../../../backend/src/core/harness-bases.ts), [resources](../../../../../../../../../backend/src/core/harness-resources.ts).
- [Commit approval](../../../../../../../../../backend/src/core/git-approval.ts), [ordinary Git/read/import utilities](../../../../../../../../../backend/src/core/workspace-git.ts).
- [Bash](../../../../../../../../../backend/src/core/harness-command.ts), [temporary resources](../../../../../../../../../backend/src/core/harness-execution.ts), [native adapters](../../../../../../../../../backend/src/core/harness-tools.ts).
- [Design reads](../../../../../../../../../backend/src/core/design.ts), [bootstrap](../../../../../../../../../backend/src/core/workspace-bootstrap.ts), [member activation](../../../../../../../../../backend/src/core/member-config.ts), [HTTP](../../../../../../../../../backend/src/api/team-routes.ts).

## Verification

Git approval tests cover direct/mixed/protected candidates, staged versus unstaged bytes, -a, denial, feedback, user-wait timeout suspension, stale contents, cancellation, renames and explicit overrides. Migration tests preserve accepted and pending data without legacy writes. Native-tool/context/member tests verify recursive working assignment, root coverage, deduplication, pending/accepted changes, exact dependencies, overlapping read-only precedence, inspection and descendant README retrieval. HTTP tests verify summary/detail/decision isolation and absence of retired routes. MySQL tests verify durable context, separate atomic idle activation and successful publication without checkpoints. Frontend tests/browser checks cover popup/right-panel separation.

## Startup permission mode

Project configuration derives RSI_HARNESS_PERMISSIONS_ENABLED only for the selected backend child. main parses the Boolean strictly (absent means true), passes it through TeamSystem to HarnessService and MemberInstructions, and keeps it immutable for the backend lifetime. Disabled assembly enables all available tools and uses the file-backed permissions-disabled prompt instead of enforcement prompts; assignments/design context still load. fileInvocation resolves native paths without authorization. Management model discovery and file validation omit the lead gate in disabled mode, while semantic validation remains. Bash skips sandbox setup and the Git broker, uses a clean host HOME/PATH environment, and keeps framing, serialization, jobs, timeout and cleanup in the same shell service. The shell registry replaces a session if execution mode differs, so a permissive shell is never reused as an enforced one. No backend credentials are copied into the host shell environment.

[Mode tests](../../../../../../../../../backend/test/harness-permission.test.ts) cover both modes, unrestricted files/commits, unchanged validation, secret isolation, timeout and restoration. Existing sandbox/Git suites continue to verify enabled behavior.
