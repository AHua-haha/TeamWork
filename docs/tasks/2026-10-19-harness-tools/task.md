# Harness tool integration

Status: complete
Task start commit: f9060b1a77a31546b1929200fdfc70999eb17e37
Review boundaries: [Harness tools draft](drafts/workspace-agent/harness/tools/design.md), [Bash draft](drafts/workspace-agent/harness/tools/bash/design.md)

## Design outcomes

- [delivered] Pi read/ls/grep/find/write/edit use native definitions, default operations and complete native results, including details and truncation. Harness authorizes input paths rather than injecting filesystem operations. Read-only tools inspect the workspace freely; write/edit remain assignment/role scoped. [Contract](../../systems/workspace-agent/harness/tools/design.md).
- [delivered] Custom tools return readable content plus relevant metadata. Removed the old whole-object JSON presentation and successful-looking refusal wrapper; runtime retains recoverable error status. No shared result/truncation rewrite is added.
- [delivered] Bash accepts command/cwd/timeout/background/metadata and uses one persistent shell per member, with combined foreground output and native background job handles. [Contract](../../systems/workspace-agent/harness/tools/bash/design.md).
- [delivered] Bash allows system reads, whole-workspace/owned-temporary writes, networking and no executable allowlist. File-tool edits remain scoped independently. Prompts, inspection labels and affected ancestor contracts describe the distinction.
- [delivered] Shell/job lifecycle is integrated with reset, retirement, member activation/update and backend shutdown, while jobs survive normal run completion.

## Decisions

- Native Pi integration supersedes earlier proposals for harness-provided filesystem operations, a universal result formatter, mandatory metadata footer and another shared truncation pass. Custom tools own their output policy; native tools retain Pi's own policy.
- File-tool paths remain inside the workspace; existing ancestors resolving outside it and symbolic-link mutation targets are refused at invocation. These are input checks, not OS isolation against concurrent broad Bash writes.
- Foreground timeout defaults to 60 seconds; background has no default timeout. Explicit positive timeout applies to either, up to 2147483 seconds. Foreground timeout/cancellation stops the member shell/jobs; a background timeout stops that job. Commands use noninteractive stdin.
- Foreground output retains the last 50 KiB with a truncation notice, without automatic log files. Background stdout/stderr inherit /dev/null; explicit redirects inside the unchanged command override those descriptors. Return job_id, without PID/cwd/automatic output_path.
- Keep shells/jobs across runs. Stop them on context reset, retirement, affected configuration activation/administrative update, and shutdown. Commands are never replayed automatically.
- metadata.git.scope keeps the existing controlled Git workflow with user acceptance for design/member commits. Unscoped Git remains native. Whole-workspace Bash writes include .rsi/.git, so scoped checks are not an exclusive security boundary. Background jobs retain their original Git token rather than borrowing the next invocation's scope.
- Background jobs can change shared files after a checkpoint. Checkpoints record observed bytes without promising a quiescent workspace.
- There are no unresolved design choices for this increment. Linux requires external sandbox dependencies and remains unverified on this macOS host.

## Implementation and verification notes

- Replaced per-call execution with a stateful shell service and per-workspace temporary resources. Retained internal backend MemberFiles helpers without injecting them into Pi tools.
- Applied SRT's current per-shell socket configuration during serialized profile generation; otherwise new shell Git bridges could be blocked by a previous shell's global socket setting.
- macOS system Bash 3.2 does not support dynamic descriptor allocation. A randomized high completion descriptor preserves ordinary script descriptor 9. A failed exploratory version and all subsequent runs remain recorded.
- Resolve workspace aliases before shell identity/Git cwd checks. Shell exit now awaits job cleanup before returning an error, including explicit exit commands.
- A database check initially asserted stdout must begin the combined output. Under concurrent tests Bash emitted a process-group diagnostic on stderr before successful stdout. The assertion now verifies the output and successful exit metadata while retaining stderr as required by the contract.
- The document audit verifies 17 draft/canonical counterparts, local links, required new contract sections and whitespace. Builds include file-backed prompt assets. Detailed evidence, including failures, is in [tests.jsonl](tests.jsonl).

## Checkpoints and remaining work

- Completed the settled behavior in one consistent feature-branch commit tagged Task-ID: 2026-10-19-harness-tools. Canonical documents and retained task drafts describe the same delivered contract.
- Final verification: 175 backend tests and 60 disposable-MySQL integration tests pass; backend and frontend builds pass; real-shell reset/exit cleanup and background Git isolation tests pass; document/whitespace audit passes. All runs, including failed exploratory runs and corrected assertions, are retained in tests.jsonl.
- No implementation work or design decision remains for this task. Linux sandbox execution is the stated unverified platform limitation.
- The starting worktree had only unrelated untracked .claude/, backend/.DS_Store and backend/prompts/.DS_Store; these are preserved and excluded from the task commit.
- The personal-todo workspace and its metadata were not modified. Restart the backend to load the new tools and prompt assets.
