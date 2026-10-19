<!-- Task proposal; current contract is under docs/systems/ -->
# Harness tools implementation

## Contract

[Tool contract](design.md). Pi tools, invocation authorization, custom content and persistent Bash are implemented by the code below.

## Responsibilities and decomposition

- Pi supplies built-in definitions, default operations, matching/search behavior and native result policies.
- Harness assembly selects tools and supplies an invocation authorization hook for mutations, rather than injecting filesystem permission operations.
- Runtime validates arguments, executes authorized calls and records content, details and error status without result presentation rewriting.
- Custom service tools implement their own readable content, relevant metadata and bounded output.
- Customized Bash supplies a persistent shell per member, foreground output capture, native background jobs and broad system-read/workspace-write/network sandbox policy, as described in [the Bash contract](bash/design.md). Optional scoped Git and reset/shutdown lifecycles follow the Bash child contract.

## Coordination and data flow

Model call -> runtime argument validation -> harness invocation authorization where required -> Pi default tool or project custom tool -> native content/details/error result -> durable runtime recording and next model step.

No shared result formatter or second truncation pass is part of this implementation. No filesystem-operation permission adapter is part of this implementation.

## Decisions and constraints

Preserve Pi schemas and descriptions wherever possible. Tool-specific error/result details must survive recording. File-tool input checks bound paths to the workspace and reject mutation symlinks; do not claim that a default Pi operation provides OS isolation.

Bash must execute foreground scripts in the existing parent shell so state survives calls, and start background scripts as native jobs known to that shell. Configure background inherited stdout/stderr as /dev/null without modifying command text or changing the parent's descriptors. Preserve command-specified redirection. Capture foreground output independently of launch/control reporting; default background output must not contaminate subsequent results. Model-facing background handles are native Bash job numbers; backend process IDs may be retained privately for lifecycle enforcement. Shells/jobs survive runs, and reset/retirement/configuration activation/update/shutdown stop them. Foreground timeout/cancellation stops the member shell/jobs; explicit background timeout stops its job.

Compile Bash sandbox policy to system read access, whole-workspace and workspace-owned temporary writes, network access and no extra executable control. Do not derive Bash writable paths from working/dependency designs or carry old .rsi/.git/dependency write exclusions into this policy. Keep Pi write/edit invocation checks separately scoped. The workspace temporary directory may host writable shell home/cache files without granting extra host write areas. The installed runtime exposes read/write resource rules rather than an independent per-path execute policy; executable restrictions are deliberately absent. Verify effective write grants, including runtime defaults, against the accepted boundary when implementing. Socket compatibility and optional Git routing are documented explicitly in the Bash child; they do not restrict broader workspace filesystem writes.

## Code map

Implementation map:

- [Native Pi tools](../../../../../backend/src/harness-tools.ts): native Pi tool factories and complete native results after invocation authorization.
- [Harness assembly](../../../../../backend/src/harness.ts) and [Purpose bases](../../../../../backend/src/harness-bases.ts): assembly, broad read availability, mutation authority and prompts.
- [Internal backend files](../../../../../backend/src/member-files.ts): internal backend file management; not injected into agent tools.
- [Runtime recording](../../../../../backend/src/runtime.ts) and [Tool result types](../../../../../backend/src/tool-result.ts): preserve native results and recoverable failures.
- [Management tools](../../../../../backend/src/member-tools.ts) and [Web tools](../../../../../backend/src/web-tools.ts): custom readable content and tool-owned limits.
- [Persistent shell service](../../../../../backend/src/harness-command.ts) and [Temporary resources](../../../../../backend/src/harness-execution.ts): persistent shell/process/broker service and workspace temporary resources.
- [Rule prompts](../../../../../backend/prompts/harness/): file-backed instructions for native tools and the separate file/Bash boundaries.

## Verification

[Native integration tests](../../../../../backend/test/harness-tools.test.ts) verifies native results/details, broad workspace discovery, scoped write/edit, outside/symlink refusals, readable custom content and reset. [Real shell tests](../../../../../backend/test/bash-session.test.ts) exercises actual OS-sandboxed shells, persistent state, descriptor 9, immediate/native jobs, output redirection, wait/kill, resource boundaries, truncation, timeout and cancellation. Existing harness/history/context/member/team suites retain scoped Git/user-acceptance semantics and have updated expectations for broad Bash. MySQL integration verifies durable real runtime tool content and independent details. Linux runtime enforcement is not exercised on the macOS test host.
