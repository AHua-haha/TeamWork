<!-- Task proposal; current contract is under docs/systems/ -->
# Bash implementation

Permission and approval enforcement below describes the default enabled mode. The operator's optional startup setting `harnessPermissionsEnabled: false` bypasses harness permission gates; semantic validation, user activation and runtime lifecycle rules remain in force.

## Contract

[Bash](design.md) defines persistent member shells, native jobs, resource limits and explicit commit approval.

## Responsibilities and decomposition

harness-command owns input parsing, shell registry, completion framing, bounded output, process/job cleanup and explicit-commit IPC. harness-execution provides workspace-owned temporary homes/caches. GitApprovals owns candidate decisions; it receives a sandboxed Git executor rather than general filesystem authority. No scoped Git service remains.

## Coordination and data flow

A pipe-fed OS-sandboxed Bash preserves state across calls/runs. A reserved high descriptor emits per-invocation random completion frames on the combined output pipe; foreground eval stays in the parent shell with stdin /dev/null. Background eval uses native jobs and inherited /dev/null outputs, preserving explicit script redirects. Native job IDs are visible; backend PIDs support bounded cleanup. Reset snapshots descendant process groups and stops known jobs safely.

Literal explicit Git commit detection enables a request-bound token for the PATH shim; direct absolute executable forms are routed to it too. Non-commit Git delegates to the discovered host binary. A commit sends actual argv/cwd and whitelisted shell environment fields over the member socket. Repository/index/object overrides refuse. The broker owns pending invocation callbacks and uses a separate abort signal for shell shutdown. Candidate preparation and Git commit run in sandboxed child execution with the same resource profile. User waiting pauses the foreground timer; resume preserves its remaining execution budget. The broker does not store Git history, route other Git operations into scopes or replay commands.

## Decisions and constraints

SRT 0.0.79 profiles permit system reads, workspace/owned-temp writes, networking and no executable allowlist. Profile generation is serialized because SRT uses shared networking configuration; macOS grants the member IPC socket, Linux retains its runtime socket compatibility. No PTY, interactive stdin, automatic retry or automatic log file is added. Foreground default timeout is 60 seconds, background unlimited unless specified; startup/background acknowledgement deadlines are 10 seconds. Explicit commit commands run in foreground. Indirect scripts/programs without an explicit Git commit in the tool request remain outside this workflow guard.

## Code map

- [Shell/IPC](../../../../../../backend/src/harness-command.ts), [resources](../../../../../../backend/src/harness-execution.ts).
- [Commit decision](../../../../../../backend/src/git-approval.ts), [tool schema/results](../../../../../../backend/src/harness-tools.ts).

## Verification

Real shell tests cover persistent state, descriptors, foreground/background output, jobs, sandbox resources, timeout and cleanup. Git approval tests exercise actual sandboxed commits and pending user decisions, including timeout suspension and cancellation. Linux runtime enforcement remains unverified on the macOS host.

## Startup permission mode

Project configuration derives RSI_HARNESS_PERMISSIONS_ENABLED only for the selected backend child. main parses the Boolean strictly (absent means true), passes it through TeamSystem to HarnessService and MemberInstructions, and keeps it immutable for the backend lifetime. Disabled assembly enables all available tools and uses the file-backed permissions-disabled prompt instead of enforcement prompts; assignments/design context still load. fileInvocation resolves native paths without authorization. Management model discovery and file validation omit the lead gate in disabled mode, while semantic validation remains. Bash skips sandbox setup and the Git broker, uses a clean host HOME/PATH environment, and keeps framing, serialization, jobs, timeout and cleanup in the same shell service. The shell registry replaces a session if execution mode differs, so a permissive shell is never reused as an enforced one. No backend credentials are copied into the host shell environment.

[Mode tests](../../../../../../backend/test/harness-permission.test.ts) cover both modes, unrestricted files/commits, unchanged validation, secret isolation, timeout and restoration. Existing sandbox/Git suites continue to verify enabled behavior.
