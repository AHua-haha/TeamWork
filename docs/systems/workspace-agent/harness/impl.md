# Agent harness implementation

## Contract

[Harness](design.md) defines the three purpose bases, common tools, protected acceptance, derived implementation authority and independent staged history. Configuration activation remains outside this increment.

## Responsibilities and decomposition

HarnessService composes accepted designs, fixed bases, scoped files/history and Bash. HarnessHistory owns worktrees, Git objects, staging repositories, checkpoint indexes, accepted refs and design acceptance pointers. The [team](../team/design.md) owns stable active member identity/content; [runtime](../../agent-runtime/design.md) owns the model loop and tool cancellation. [Design parts](../context-base/design-parts/design.md) resolve accepted semantic designs.

Reusable file adapters and one Bash adapter receive runtime identity; policy is resolved by harness services rather than tied to a lead-specific tool implementation. Management contributes protected design/member parts and lead model discovery. Implementation contributes the derived part. Execute contributes existing general command allowances. Base prompts and member Markdown are assembled into the system prompt.

## Coordination and data flow

1. Resolve accepted working/dependency designs and derive writable/read-only paths. Validate/control exclusions and dependency precedence define file access. Materialize missing active member bundles for the lead without replacing drafts.
2. Open private bare storage next to the source at .rsi-harness/<path-hash>/repository.git and one linked worktree per member. Initialize scope refs by normalized paths/exclusions, preserving existing pending work when the shape changes.
3. Assemble unique ls/read/write/edit/bash plus lead list_models. File tools resolve through MemberFiles. Bash resolves requested scope against current parts; supplied metadata can select only that scope.
4. For scoped Git, create one backend-only bare metadata directory under staging/<member>/<part>/<scope-hash>. It has its own HEAD/index and shares the main object directory through GIT_OBJECT_DIRECTORY. Private repositories, worktree .git and backend storage are unreadable/unwritable to shell children.
5. A per-invocation Unix socket receives actual Git argv/cwd from the immutable PATH Git bridge. Backend validates cwd, command/options/path intersection, source revisions and actor policy. Native Git runs with explicit private git-dir/worktree, no global/system config, hooks, fsmonitor or external diff/textconv. Protected acceptance is serialized across design parts as well as per-scope implementation acceptance. Stage integrity is checked; failed add restores the index. Commit performs compare-and-swap accepted/base updates under a scope queue. Protected commits refuse before acceptance.
6. @anthropic-ai/sandbox-runtime 0.0.79 wraps real Bash in sandbox-exec on macOS or bubblewrap on Linux. Read scope includes authorized design/implementation and required runtime/system files. General writes permit implementation minus control/dependency paths; Git Bash permits scratch only. Metadata selection never authorizes unrestricted execution. Profiles are generated under a queue because the SDK reads global Unix-socket configuration; running commands remain parallel across members. No unsandboxed fallback/network allowance is provided.
7. Minimal child environment omits backend credentials/config. Processes run in a detached group with bounded output/timeout. End/abort kills descendants; broker operations settle before temp cleanup and lifecycle checkpointing. The bridge uses exported PWD for cwd (validated by backend), avoiding directory-content access required by Node getcwd in an otherwise unassigned root.
8. Checkpoints build trees through fresh temporary indexes and update checkpoint/run refs, never the agent index. User acceptance validates exact working snapshot/review/base and updates accepted/base refs atomically. Git staging synchronizes HEAD after user acceptance, refreshing a clean index but retaining dirty staging. Explicit full index/worktree restore to current acceptance refreshes stale bases. Git log --all resolves to the selected checkpoint and acceptance heads, never arbitrary repository refs; working restores checkpoint pending files before replacement.
9. A user design commit atomically updates per-design accepted pointers alongside scope refs. DesignService reads those accepted bytes first, with tombstones for deleted records, then original context for paths never accepted in harness Git. Pending bytes and member-file commits cannot grant design authority.

## Decisions and constraints

The actual Git bridge is the trusted operation boundary; OS isolation prevents native Git/repository access and arbitrary shell writes from bypassing it. Scope selection is one per Bash invocation. Supported Git syntax is intentionally finite and documented; arbitrary native Git flags, remote operations and shell repository selection are not forwarded.

General execution still uses exact-vector/executable rules over [bash,-c,command]. Only a Bash allowance authorizes general scripts. Richer rules are deferred. Linux requires sandbox runtime dependencies and allows Unix socket transport; this task verifies the macOS profile. Temporary scratch/system runtime access is execution infrastructure, not workspace ownership.

Accepted design pointers supply semantic reads without mutating original-context history or auto-refreshing peer worktrees. Member acceptance and activation stay separate. Startup removes legacy explicit paths from assignment records and migrates accepted sources, preserving exact previous bundles and pending work; archived scope refs and retired records remain historical.

## Code map

- [Fixed bases](../../../../backend/src/harness-bases.ts), [assignment validation](../../../../backend/src/harness-config.ts), [composition](../../../../backend/src/harness.ts).
- [File adapters and Bash tool](../../../../backend/src/harness-tools.ts), [file boundary](../../../../backend/src/member-files.ts), [Bash lifecycle/isolation/bridge](../../../../backend/src/harness-command.ts).
- [Scoped history, staging and acceptance](../../../../backend/src/harness-history.ts), [accepted design resolver](../../../../backend/src/design.ts).
- [Team composition](../../../../backend/src/team-system.ts), [member instructions](../../../../backend/src/member-context.ts), [member content](../../../../backend/src/member-config-format.ts).
- [Review routes](../../../../backend/src/team-routes.ts) retain exact-revision user acceptance/history/restore. No new member-write route exists.

## Verification

[Harness tests](../../../../backend/test/harness.test.ts) run real sandboxed Bash/native Git, staging versus checkpoints, protected member/design commits, descendant/native-Git bypass attempts, dependency denial, accepted mapping visibility, stale-base refresh, timeout and cancellation. [History tests](../../../../backend/test/harness-history.test.ts) cover independent scopes/worktrees, exact review/base conflicts, restore transitions and links. [Member files](../../../../backend/test/member-files.test.ts) cover mapped files, dependency overlaps and traversal. [Member configuration](../../../../backend/test/member-config.test.ts), [context assembly](../../../../backend/test/team-context.test.ts), [lead](../../../../backend/test/lead.test.ts) and HTTP tests verify new source/inspection/tool contracts. [SQL/runtime integration](../../../../backend/test/integration/backend.test.ts) exercises actual tool execution, approval, checkpoint/publication ordering, failure/cancellation and restart. No live provider calls are required.
