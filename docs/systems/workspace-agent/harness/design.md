# Harness

## Purpose and boundary

A harness defines permitted scope, capabilities and maintenance rules for one purpose. Tools are reusable across agents. Runtime runs an agent using the tools and prompts assembled from its harnesses. Each member has a separate worktree and independently staged scope history.

Three fixed bases provide management, implementation and execute authority. The agent configures working/dependency designs; the backend derives implementation paths from accepted designs. Member changes follow file validation, user commit and a separate idle user activation.

## Inputs and preconditions

A member assignment contains designScope: {working: [user design paths], dependencies: [user design paths]}. The lists must be disjoint, valid and resolvable. It contains no independently configurable implementationScope. Member execution rules can be configured through member files and validated under the fixed execute base policy.

The lead can maintain .rsi/context/user/ and .rsi/members/ immediately; new workspace bootstrap already supplies the root design. Dependencies remain read-only. Other members can edit their working designs and read dependency designs; member files are lead-only among agents. Implementation-code authority starts empty until accepted design mappings grant paths. Working-design implementation context is independently writable even with no code mappings.

Common ls/read/write/edit tools operate on pending files. One bash tool takes {command, metadata?: {git: {scope}}}; scope is design, member-config, implementation or a listed impl-context-<hash> part when that member owns the part. No identity, revision, approval, repository, index or reference may be supplied through metadata.

Scoped Git Bash is available independently of general execution allowances. General Bash requires an exact allowance for ["bash", "-c", command], or executable "bash". Previous non-Bash executable allowances remain stored but do not authorize a shell. Richer execution-rule capabilities remain outside this prototype.

Bash requires Git, Node.js and a supported OS sandbox: macOS sandbox-exec, or Linux bubblewrap with the sandbox runtime's dependencies. Unsupported/unavailable isolation fails closed. The prototype has no network allowance.

## Outputs and observable effects

### Purpose harnesses

| Base | Scope and capabilities | Semantic commit policy |
| --- | --- | --- |
| management | Pending working design, read-only dependencies, lead-only member files, common file tools and scoped Git Bash; lead model discovery and file validation | User acceptance for design and member-config |
| implementation | Writable implementation from accepted working mappings and paired working-design context; read-only dependency implementation/context; common file tools and scoped Git Bash | Agent may commit code and implementation context independently |
| execute | General Bash under existing allowances and applicable filesystem restrictions | Cannot override protected scopes or Git acceptance |

Base harness rule prompts are maintained as backend-owned Markdown files, including shared rules and per-scope maintenance instructions. Runtime and inspection use those same file contents. Templates receive backend-owned worktree/command values; files cannot grant permissions or replace enforced policy. They load when the backend starts; changing source prompts requires restarting development mode or rebuilding/restarting the compiled backend. Missing or empty required prompt files fail startup rather than using hardcoded fallback rules.

Tools are assembled once and all base/member prompts form the system prompt. Member files cannot override base policy. Working mappings yield writable implementation; dependency mappings yield read-only use paths. Read-only wins overlaps. Git metadata, .rsi/context and .rsi are excluded from implementation even for root mappings. Pending design edits grant no authority. Accepted designs are resolved at inspection, tool and request preparation; no new active-run update protocol is introduced.

### Implementation-context authority and rules

Each working design user/<path> grants the paired Markdown .rsi/context/agent/<lower-cased-path>.md (including the design extension); dependencies grant read/search only. Unrelated context and private/member state gain no permission. Each working pair is a one-file agent-committable scope with ID impl-context- plus the first 16 SHA-256 hex characters of its lower-case logical design path. Inspection and prompt assembly show the concrete ID/path. New members inherit committed context through shared scope history independently of other assignments; existing peers and original-workspace context are not overwritten. Pending work remains private. Derived paths must satisfy context limits; invalid paths refuse harness resolution.

Design prompts prescribe purpose/responsibilities/boundaries, Interface contract, and constraints/specifications/requirements. Implementation prompts require reading relevant context and maintaining its Implemented contract with exact Input, Output, Effect and Usage examples, current implementation facts and continuation information. Reusable knowledge is outside context and deferred. Content completeness follows model instructions; no new semantic validator or automatic model-loop maintenance is added.

### Scoped Git and stable history

Agents use ordinary git status, diff, add, log, show, restore and commit syntax through bash with one selected scope. Backend supplies trusted Git context and enforces actual operations, including calls inside scripts. Repository retargeting, arbitrary revisions, hooks and unsupported options are refused. Supported forms:

- git status [--short|--porcelain|--branch]
- git diff [--cached|--staged] [--stat|--name-only|--name-status]
- git add [-A|--all] -- <paths> (an omitted path selects the scope)
- git rm [-r] [-f|--force] -- <paths>
- git log [--all] [--oneline] [--max-count=N|-N|-nN]
- git show [HEAD|full-scope-revision]
- git restore [--staged] [--worktree] [--source=full-scope-revision] -- <paths>
- git commit -m "meaningful intent"

Paths are literal relative paths, scoped to the selected part; "." narrows to that part rather than the whole workspace. HEAD represents that member's accepted base. git log --all includes that scope's checkpoints and accepted commits; default log follows its accepted base. Working-file restore first checkpoints pending bytes, then retains Git's tracked-file semantics. A full latest-accepted restore of both index and files refreshes a stale base when both exactly match that accepted tree. The backend review/restore API also provides complete snapshot restoration.

Scopes have independent staging, accepted bases and references; objects are shared. Implementation-code and implementation-context commits accept staged bytes only. Unstaged changes and other scopes remain pending. Design/member-config Git commits return approval_required without accepting or resetting staged changes. User review names exact checkpoint revision and expected accepted base; changed bytes or stale bases refuse acceptance.

Automatic checkpoints occur at run end, including failure/cancellation and interruption recovery, and before successful final group publication after tool effects settle. They use separate temporary indexes, preserve staging and do not imply approval. Checkpoint failure prevents a success claim. History and restored snapshots remain scoped.

### Accepted files and member settings

User-approved design snapshots feed semantic design reads/discovery and implementation permission resolution. Pending design bytes do not. Raw original-workspace context files/history remain their existing separate review surface; accepted Git snapshots are not automatically copied into the original checkout or existing peer worktrees.

Member JSON holds name, role, responsibility, settings, ordered prompt references, designScope and execute: {allowedCommands}. Backend retains identity/path association, format version, revisions and exact active source bytes separately. The lead edits and validates create/update/delete changes in files. Updates may change only responsibility, supplementary prompts and execution rules, preserving name, role, model/run settings and assignments. validate_member_config({path: ".rsi/members"}) reports pending create/update/delete and issues without acceptance or activation. Deliberately deleted seeded member files remain pending across materialization/restart. Delete retires and preserves history/files; lead deletion is refused. User commit accepts file bytes only. Separate user activation applies the reviewed committed change set atomically when the whole workspace team is idle. Busy/invalid/stale activation leaves all active settings unchanged; no automatic activation or activation by an agent is allowed. Uncommitted edits stay pending.

### Execution

Scoped Git Bash can read authorized context/implementation and use the trusted Git bridge; direct shell writes are disabled. General Bash can write authorized implementation only. Management files and Git metadata are protected from direct Bash and descendant processes. File tools provide pending management editing and working implementation-context editing. Git without scope metadata cannot use the bridge; absolute native Git cannot access protected harness repositories. Read-only dependency restrictions apply to descendants as well.

Commands start in the member worktree. A script may need cd to an assigned directory: directory contents outside read scope are unavailable even when scoped Git can operate from the root. Minimal runtime/system files and temporary scratch are available; provider credentials and the backend environment are not inherited. Network access is disabled. Output is capped at 64 KiB and execution at 60 seconds; cancellation/timeout terminates the process group before checkpointing and outstanding broker operations settle first.

## Failure behavior

Invalid metadata, unknown scopes, unsupported Git syntax, unsafe paths, links in managed snapshots and out-of-scope operations fail explicitly. Read-only dependencies and control files cannot be made writable through a shell or metadata. Invalid/missing design mappings never grant permissive implementation scope.

Unapproved protected commits preserve pending files and staging. Stale reviews/bases fail instead of overwriting newer accepted state. Command results expose exitCode, signal, stdout, stderr, timedOut and truncated. Git refusals appear as nonzero shell status with an error code in stderr; tool validation/authority failures use explicit refusal feedback. Missing sandbox dependencies fail without an unrestricted fallback.

## Guarantees and limits

Each member retains its private worktree. Scope acceptance and checkpoint history are independent of group publication and active member configuration. The original checkout's Git branch/index remain untouched. No automatic merge, peer-worktree refresh, new approval UI, network allowance or automatic context-maintenance algorithm is provided.

Startup converts active legacy member records to backend-owned metadata and design-only assignments, preserving identity/settings/commands, exact prior source and pending drafts. Old Git references remain reachable; matching scopes retain their history. When a scope shape changes, existing pending files are preserved and a new scope reference is initialized; old references are retained. Stale or legacy drafts are not rewritten automatically. Member execution configuration may update allowances within the fixed command schema; non-Bash allowances do not independently authorize a shell. Linux isolation requires its external dependencies; verification in this task uses macOS.

## Acceptance examples

1. An empty workspace lead creates pending design/member files, but has no implementation access until accepted designs are assigned. Both management commits require user acceptance.
2. A working backend mapping grants backend edits; a dependency shared mapping grants reads only. A pending mapping change cannot grant another directory.
3. A worker requests member-config scope or reads a lead prompt path: refuse, including inside a script.
4. A member stages implementation A, edits it to B, then finishes a run. The checkpoint records B, the index still contains A, and git commit accepts A only.
5. Design and implementation are staged separately. An implementation commit preserves design staging and acceptance.
6. A user reviews design, then files change: acceptance refuses the stale revision. Accepting a current design snapshot makes its mapping visible to semantic reads and scope resolution.
7. A lead stages member JSON/prompt changes. Agent commit is refused; user file acceptance alone does not change active member settings.
8. A child process attempts to write a management/dependency path or open native Git metadata: the execution boundary refuses it.

Private harness storage is .rsi/harness inside the managed workspace root. It is excluded from snapshots and unavailable through agent file/Bash tools and project-file APIs. Bootstrap initializes the lead design/member scopes as accepted baselines; later commits retain their user-only policy.

9. A root lead with empty implementation mappings edits its root implementation context and commits it through its listed context scope; it still cannot edit project code. A dependency context is readable/searchable but not writable or selectable as a commit scope.
