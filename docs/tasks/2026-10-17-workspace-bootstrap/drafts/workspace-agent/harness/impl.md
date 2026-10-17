<!-- Task proposal; current contract is under docs/systems/ -->
# Agent harness implementation

## Contract

[Harness](../../../../../systems/workspace-agent/harness/design.md) defines the three purpose bases, common tools, protected acceptance, derived implementation authority and independent staged history. Member activation is a separate user-only idle operation owned by the team.

## Responsibilities and decomposition

HarnessService composes accepted designs, fixed bases, scoped files/history and Bash. HarnessHistory owns worktrees, Git objects, staging repositories, checkpoint indexes, accepted refs and design acceptance pointers. The [team](../../../../../systems/workspace-agent/team/design.md) owns stable active member identity/content; [runtime](../../../../../systems/agent-runtime/design.md) owns the model loop and tool cancellation. [Design parts](../../../../../systems/workspace-agent/context-base/design-parts/design.md) resolve accepted semantic designs.

Reusable file adapters and one Bash adapter receive runtime identity; policy is resolved by harness services rather than tied to a lead-specific tool implementation. Management contributes protected design/member parts, lead model discovery and file validation. Implementation contributes the derived part. Execute contributes existing general command allowances. Base rule text lives under backend/prompts/harness as Markdown, including management/design/member, implementation/scope, execute and shared prompts. harness-prompts loads required files once relative to its module URL and renders backend-owned template values. Runtime and inspection share the same renderer. Member Markdown remains separate; enforcement stays in the base definitions, file boundary and Git/Bash services. Missing/empty files fail startup; unresolved template variables fail assembly. There are no embedded fallback rules. Build copies the required assets to dist/prompts/harness so compiled modules load their own release files independently of cwd. Prompt edits take effect after restart (and rebuild for compiled use).

## Coordination and data flow

1. Resolve accepted working/dependency designs and derive writable/read-only paths. Validate/control exclusions and dependency precedence define file access. Materialize missing active member bundles for the lead without replacing drafts.
2. Open private bare storage inside the managed root at .rsi/harness/repository.git and one linked worktree per member. Initialize scope refs by normalized paths/exclusions, preserving existing pending work when the shape changes.
3. Assemble unique ls/read/write/edit/bash plus lead list_models and validate_member_config. File tools resolve through MemberFiles. Bash resolves requested scope against current parts; supplied metadata can select only that scope.
4. For scoped Git, create one backend-only bare metadata directory under staging/<member>/<part>/<scope-hash>. It has its own HEAD/index and shares the main object directory through GIT_OBJECT_DIRECTORY. Private repositories, worktree .git and backend storage are unreadable/unwritable to shell children.
5. A per-invocation Unix socket receives actual Git argv/cwd from the immutable PATH Git bridge. Backend validates cwd, command/options/path intersection, source revisions and actor policy. Native Git runs with explicit private git-dir/worktree, no global/system config, hooks, fsmonitor or external diff/textconv. Protected acceptance is serialized across design parts as well as per-scope implementation acceptance. Stage integrity is checked; failed add restores the index. Commit performs compare-and-swap accepted/base updates under a scope queue. Protected commits refuse before acceptance.
6. @anthropic-ai/sandbox-runtime 0.0.79 wraps real Bash in sandbox-exec on macOS or bubblewrap on Linux. Read scope includes authorized design/implementation and required runtime/system files. General writes permit implementation minus control/dependency paths; Git Bash permits scratch only. Metadata selection never authorizes unrestricted execution. Profiles are generated under a queue because the SDK reads global Unix-socket configuration; running commands remain parallel across members. No unsandboxed fallback/network allowance is provided.
7. Minimal child environment omits backend credentials/config. Processes run in a detached group with bounded output/timeout. End/abort kills descendants; broker operations settle before temp cleanup and lifecycle checkpointing. The bridge uses exported PWD for cwd (validated by backend), avoiding directory-content access required by Node getcwd in an otherwise unassigned root.
8. Checkpoints build trees through fresh temporary indexes and update checkpoint/run refs, never the agent index. User acceptance validates exact working snapshot/review/base and updates accepted/base refs atomically. Git staging synchronizes HEAD after user acceptance, refreshing a clean index but retaining dirty staging. Explicit full index/worktree restore to current acceptance refreshes stale bases. Git log --all resolves to the selected checkpoint and acceptance heads, never arbitrary repository refs; working restores checkpoint pending files before replacement.
9. A user design commit atomically updates per-design accepted pointers alongside scope refs. DesignService reads those accepted bytes first, with tombstones for deleted records, then original context for paths never accepted in harness Git. Pending bytes and member-file commits cannot grant design authority.

## Decisions and constraints

The actual Git bridge is the trusted operation boundary; OS isolation prevents native Git/repository access and arbitrary shell writes from bypassing it. Scope selection is one per Bash invocation. Supported Git syntax is intentionally finite and documented; arbitrary native Git flags, remote operations and shell repository selection are not forwarded.

General execution still uses exact-vector/executable rules over [bash,-c,command]. Only a Bash allowance authorizes general scripts. Richer rules are deferred. Linux requires sandbox runtime dependencies and allows Unix socket transport; this task verifies the macOS profile. Temporary scratch/system runtime access is execution infrastructure, not workspace ownership.

Accepted design pointers supply semantic reads without mutating original-context history or auto-refreshing peer worktrees. User member acceptance and user member activation remain separate actions. Startup removes legacy explicit paths from assignment records and migrates accepted sources, preserving exact previous bundles and pending work; archived scope refs and retired records remain historical.

## Code map

- [Rule Markdown files](../../../../../../backend/prompts/harness/management.md), [prompt loader](../../../../../../backend/src/harness-prompts.ts) and [asset packaging](../../../../../../backend/scripts/copy-harness-prompts.mjs).
- [Fixed bases](../../../../../../backend/src/harness-bases.ts), [assignment validation](../../../../../../backend/src/harness-config.ts), [composition](../../../../../../backend/src/harness.ts).
- [File adapters and Bash tool](../../../../../../backend/src/harness-tools.ts), [file boundary](../../../../../../backend/src/member-files.ts), [Bash lifecycle/isolation/bridge](../../../../../../backend/src/harness-command.ts).
- [Scoped history, staging and acceptance](../../../../../../backend/src/harness-history.ts), [accepted design resolver](../../../../../../backend/src/design.ts).
- [Team composition](../../../../../../backend/src/team-system.ts), [member instructions](../../../../../../backend/src/member-context.ts), [member content](../../../../../../backend/src/member-config-format.ts).
- [Review routes](../../../../../../backend/src/team-routes.ts) retain exact-revision user acceptance/history/restore. No new member-write route exists.

## Verification

[Harness tests](../../../../../../backend/test/harness.test.ts) run real sandboxed Bash/native Git, staging versus checkpoints, protected member/design commits, descendant/native-Git bypass attempts, dependency denial, accepted mapping visibility, stale-base refresh, timeout and cancellation. [History tests](../../../../../../backend/test/harness-history.test.ts) cover independent scopes/worktrees, exact review/base conflicts, restore transitions and links. [Member files](../../../../../../backend/test/member-files.test.ts) cover mapped files, dependency overlaps and traversal. [Member configuration](../../../../../../backend/test/member-config.test.ts), [context assembly](../../../../../../backend/test/team-context.test.ts), [lead](../../../../../../backend/test/lead.test.ts) and HTTP tests verify new source/inspection/tool contracts. [SQL/runtime integration](../../../../../../backend/test/integration/backend.test.ts) exercises actual tool execution, approval, checkpoint/publication ordering, failure/cancellation and restart. No live provider calls are required.

Prompt-file verification runs existing runtime/context and inspection tests against the file-backed definitions, builds the backend, and imports the compiled prompt loader from a different working directory to verify packaged assets and value rendering.

Member file initialization uses private storage markers per lead/bundle. A marker is created only after initial materialization; paths included in activation are also registered before database changes. Once registered, missing files remain intentional pending deletions across requests/restart. Git rm validates scope/arguments and existing files, preserves a pre-removal checkpoint/index and rolls back files/index on failure. MemberConfigService reads immutable snapshots through readSnapshotBytes and strict UTF-8/text checks. Referenced prompt/manifest files alone determine active member content; unrelated files remain Git history.

The [team implementation](../../../../../systems/workspace-agent/team/impl.md) owns semantic validation and workspace-idle atomic activation. Harness file commit never activates settings. Management rule Markdown owns the allowed-update list, validation/commit/activation instructions and JSON example; MemberContext adds role/roster/file-location data without duplicating that schema/rule text.

## Member configuration file review support

HarnessHistory supplies bounded immutable file previews, trusted import of database source text into a temporary Git tree, per-file unified patches and committed-chain history since an activation boundary. These operations share private objects and do not modify a member's working files or staged index. Team owns source interpretation, activation baseline persistence and endpoint responses.


## Managed-root storage and staging

The private repository/worktrees live under .rsi/harness in the registered project. Snapshot traversal always excludes this private subtree, including when seeding a whole project, so it cannot recursively snapshot itself. Seed discovery includes managed context/member files despite project ignore rules. File tools hide all private .rsi subtrees and Git metadata; Bash protects .rsi and allows only authorized narrower management reads. Implementation excludes the complete .rsi root. Scoped Git add enumerates authorized regular files and tracked deletions, then passes literal NUL-delimited pathspecs through native Git stdin; it uses the same flow for directory and individual-file scopes and preserves unrelated staging.
