# Agent harness implementation

## Contract

[Harness design](design.md). Preserve scope derived from designs, dependency read-only precedence, current authority at tool execution and command allowance matching.

## Responsibilities and decomposition

HarnessConfig validates the two configuration fields and command vectors. HarnessService resolves design references, derives file permissions, supplies relevant content and role-eligible tools, and checks command allowance. Harness tools adapt file operations and direct command execution to RuntimeTool. MemberFiles provides scoped filesystem operations. Design parts are supplied by the neighboring [context base child](../context-base/design-parts/design.md); member storage stays in [team](../team/design.md). No automated context-maintenance child is implemented.

## Coordination and data flow

Resolve working and dependency DesignService records into readable, writable and read-only implementation mappings. Dependency writes deny first. Context files are read-only; workers can see selected design files and navigation ancestors, while the lead can read all workspace context/project files. Implementation navigation exposes ancestors without granting unrelated children. `mkdir` permits required ancestors for mapped files, while final write authorization remains on the target.

Prepare supplies ls/read, mapped write/edit, allowed run_command, and role-eligible team tools. Per model call it rebuilds Markdown design content, mappings/revisions and implementation text, bounded by 64 KiB per section. Lead bootstrap context is bounded too. Trees use depth 16 and 2,000-entry limits with explicit truncation notes. Missing future implementation is a note. Files beyond text limits or unsupported text are noted for inspection.

Every file tool invocation resolves the member and designs again, then creates MemberFiles and the Pi tool. MemberFiles checks workspace-relative paths and permission, hides .git, refuses symbolic links, enforces text limits, and writes by a temporary rename preserving mode. Expected file failures become normal result text; abort propagates.

run_command validates argv, checks current exact vector or exact executable string, checks workspace directory, and uses spawn with shell false, ignored stdin, timeout and combined output retention. Executables resolve by normal process rules; explicit paths match literally. Cancellation/timeout sends TERM and then KILL to the process group on Unix or child on Windows. Nonzero exits and timeouts are observable results; denied/missing executables are normal refusals.

## Decisions and constraints

The harness replaces old member-context authority rather than adapting old scopes. Its schema is the single tool representation for team and lead configuration. Context maintenance and sanitizing old conversation content are deferred. Command allowance is enforced independently of file tool authority; permitted command effects have no filesystem isolation. Exact means argument-vector equality; executable means argv[0] equality, never raw command-string prefix. Broad executable allowances can invoke arbitrary executable behavior, including shells when explicitly configured.

## Code map

- [Config and command matching](../../../../backend/src/harness-config.ts)
- [Resolution, permissions and file-context preparation](../../../../backend/src/harness.ts)
- [Tool schemas/adapters](../../../../backend/src/harness-tools.ts)
- [Command lifecycle](../../../../backend/src/harness-command.ts)
- [Scoped filesystem operations](../../../../backend/src/member-files.ts)
- [Workspace implementation](../workspace/impl.md) owns project-file reading/listing used to assemble context; [team implementation](../team/impl.md) owns integration.

## Verification

[Harness tests](../../../../backend/test/harness.test.ts) cover schema validation, exact/executable matching, current design mappings, command cwd, literal arguments, nonzero exit, revocation, bounded output, timeout/cancel and invalid design readiness. [File tests](../../../../backend/test/member-files.test.ts) exercise actual Pi tools over working/dependency scopes, read-only overlap, exact-file creation, hidden unrelated paths, links and edit failures. [Request tests](../../../../backend/test/team-context.test.ts) verify tool/content delivery, role tools, budgets and suppression of unrestricted catalog tools.
