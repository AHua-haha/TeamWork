<!-- Task proposal; current contract is under docs/systems/ -->
# Persistent Bash implementation

## Contract

[Bash contract](design.md). The important guarantees are persistent per-member state, native job handles, unchanged script redirection, broad resource restrictions and cleanup before timeout/cancellation settles.

## Responsibilities and decomposition

backend/src/harness-command.ts owns parsing, member-shell registry, serialized invocation, completion framing, output capture, native jobs, timers, process cleanup and optional scoped Git broker. backend/src/harness-execution.ts supplies one temporary write area per workspace and per-shell home/cache directories. HarnessService supplies member/workspace identity and the selected Git callback, rather than filesystem access adapters.

## Coordination and data flow

A shell opens lazily inside SRT. A controlled environment retains installed PATH and isolated writable home/cache/tmp but omits arbitrary backend environment. All member shells share initialized network proxies; profile generation is serialized and updates SRT global socket configuration before wrapping each shell. OS profiles remain fixed for that shell. Filesystem read denies are empty; writable roots are workspace and its temporary area. Extra SRT host convenience-write roots are denied; device/stdio defaults stay available. Linux retains existing Unix-socket compatibility configuration; macOS grants the shell bridge socket.

Foreground scripts execute through eval in the parent shell with stdin /dev/null. Each call sends a random completion frame through a high reserved descriptor duplicated from stdout. stderr joins the same pipe. Parse the completion marker in that pipe so output cannot be overtaken by a separate control pipe. Keep a bounded 50-KiB tail while continuing to drain output. The descriptor is above ordinary script descriptor 9 and works on macOS system Bash 3.2. Agent commands that replace the shell or disrupt control state are reported as shell loss/timeout and never replayed.

Background eval runs asynchronously in the native Bash job table, inheriting /dev/null stdout/stderr before executing the untouched script. Capture its native job number and PID for internal tracking; expose only job_id. Calls can continue while the job runs, and command-specified log redirection is entirely agent-owned. Explicit job timers validate ownership before signalling the process group. Foreground timeout/cancellation, reset and close terminate the shell's descendant/known job groups and await broker effects. Known background groups are retained for cleanup even when the shell exits.

Each metadata-selected Git invocation receives an opaque token bound to its original callback/member/run/scope. A PATH shim forwards that token from child processes to the session broker; background jobs retain launch context. Unscoped Git delegates to the host Git binary. Native absolute Git/workspace metadata are intentionally not blocked by this workflow helper. Ordinary scope history/approval logic remains in HarnessHistory/ProjectGit.

## Decisions and constraints

No PTY or interactive stdin is provided. Foreground completion returns tool content; stdout chunks are not independently added to model history. Shell/job state is transient process state, not durable restart state. Context reset, retirement, activated changed members, administrative updates and shutdown reset it. No automatic command retries or output spill files exist. Foreground default timeout is 60 seconds; background default is unlimited; explicit timeout maximum follows Node's timer range. Startup and background acknowledgment use 10-second deadlines. Background jobs can mutate shared workspace files between runs/checkpoints; checkpointing does not claim quiescence.

## Code map

- [Shell service](../../../../../../backend/src/harness-command.ts).
- [Workspace temporary resources](../../../../../../backend/src/harness-execution.ts).
- [Tool content/schema](../../../../../../backend/src/harness-tools.ts).
- [Harness binding](../../../../../../backend/src/harness.ts).
- [Reset/retirement/shutdown coordination](../../../../../../backend/src/team-runner.ts).
- [Configuration activation](../../../../../../backend/src/member-config.ts).

## Verification

[Real shell tests](../../../../../../backend/test/bash-session.test.ts) exercise the contract against macOS sandbox-exec. Harness tests cover selected/unselected/nested Git and broad workspace writes independently of file-tool authorization. Team and MySQL integration tests cover reset, activation and stable recorded results. Linux requires bubblewrap/runtime dependencies and remains unverified on this host.
