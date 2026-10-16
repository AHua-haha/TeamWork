<!-- Task proposal; current contract is under docs/systems/ -->
# Harness

## Purpose and boundary

A harness defines permitted scope, capabilities and maintenance rules for one purpose. Tools are reusable across agents. Runtime runs an agent using the tools and prompts assembled from its harnesses. Each member has a separate worktree and independently staged scope history.

Three fixed bases provide management, implementation and execute authority. The agent configures working/dependency designs; the backend derives implementation paths from accepted designs. Configuration-change and activation handling remains deferred.

## Inputs and preconditions

A member assignment contains designScope: {working: [user design paths], dependencies: [user design paths]}. The lists must be disjoint, valid and resolvable. It contains no independently configurable implementationScope. Existing allowedCommands are backend-controlled execute policy, outside editable member JSON.

The lead can maintain .context/user/ and .team/members/ immediately, before any design exists. Dependencies remain read-only. Other members can edit their working designs and read dependency designs; member files are lead-only among agents. Implementation authority starts empty until accepted designs are assigned.

Common ls/read/write/edit tools operate on pending files. One bash tool takes {command, metadata?: {git: {scope}}}; scope is design, member-config or implementation when that member owns the part. No identity, revision, approval, repository, index or reference may be supplied through metadata.

Scoped Git Bash is available independently of general execution allowances. General Bash requires an exact allowance for ["bash", "-c", command], or executable "bash". Previous non-Bash executable allowances remain stored but do not authorize a shell. Execution policy configuration is deferred.

Bash requires Git, Node.js and a supported OS sandbox: macOS sandbox-exec, or Linux bubblewrap with the sandbox runtime's dependencies. Unsupported/unavailable isolation fails closed. The prototype has no network allowance.

## Outputs and observable effects

### Purpose harnesses

| Base | Scope and capabilities | Semantic commit policy |
| --- | --- | --- |
| management | Pending working design, read-only dependencies, lead-only member files, common file tools and scoped Git Bash; lead model discovery | User acceptance for design and member-config |
| implementation | Writable implementation from accepted working mappings; read-only implementation from dependencies; common file tools and scoped Git Bash | Agent may commit implementation |
| execute | General Bash under existing allowances and applicable filesystem restrictions | Cannot override protected scopes or Git acceptance |

Tools are assembled once and all base/member prompts form the system prompt. Member files cannot override base policy. Working mappings yield writable implementation; dependency mappings yield read-only use paths. Read-only wins overlaps. Git metadata, .context and .team are excluded from implementation even for root mappings. Pending design edits grant no authority. Accepted designs are resolved at inspection, tool and request preparation; no new active-run update protocol is introduced.

### Scoped Git and stable history

Agents use ordinary git status, diff, add, log, show, restore and commit syntax through bash with one selected scope. Backend supplies trusted Git context and enforces actual operations, including calls inside scripts. Repository retargeting, arbitrary revisions, hooks and unsupported options are refused. Supported forms:

- git status [--short|--porcelain|--branch]
- git diff [--cached|--staged] [--stat|--name-only|--name-status]
- git add [-A|--all] -- <paths> (an omitted path selects the scope)
- git log [--all] [--oneline] [--max-count=N|-N|-nN]
- git show [HEAD|full-scope-revision]
- git restore [--staged] [--worktree] [--source=full-scope-revision] -- <paths>
- git commit -m "meaningful intent"

Paths are literal relative paths, scoped to the selected part; "." narrows to that part rather than the whole workspace. HEAD represents that member's accepted base. git log --all includes that scope's checkpoints and accepted commits; default log follows its accepted base. Working-file restore first checkpoints pending bytes, then retains Git's tracked-file semantics. A full latest-accepted restore of both index and files refreshes a stale base when both exactly match that accepted tree. The backend review/restore API also provides complete snapshot restoration.

Scopes have independent staging, accepted bases and references; objects are shared. Implementation commits accept staged bytes only. Unstaged changes and other scopes remain pending. Design/member-config Git commits return approval_required without accepting or resetting staged changes. User review names exact checkpoint revision and expected accepted base; changed bytes or stale bases refuse acceptance.

Automatic checkpoints occur at run end, including failure/cancellation and interruption recovery, and before successful final group publication after tool effects settle. They use separate temporary indexes, preserve staging and do not imply approval. Checkpoint failure prevents a success claim. History and restored snapshots remain scoped.

### Accepted files and member settings

User-approved design snapshots feed semantic design reads/discovery and implementation permission resolution. Pending design bytes do not. Raw original-workspace context files/history remain their existing separate review surface; accepted Git snapshots are not automatically copied into the original checkout or existing peer worktrees.

Member JSON contains name, role, responsibility, settings, ordered promptFiles and designScope. Backend retains identity/path association, format version, revisions and exact active source bytes separately. User acceptance commits member files as files only. It does not validate/activate a new member or change current settings. Configuration detection, submission/activation, self-change and retirement workflows remain deferred; submit_member_config and retire_member are absent from agent tools.

### Execution

Scoped Git Bash can read authorized context/implementation and use the trusted Git bridge; direct shell writes are disabled. General Bash can write authorized implementation only. Management files and Git metadata are protected from direct Bash and descendant processes. File tools provide pending management editing. Git without scope metadata cannot use the bridge; absolute native Git cannot access protected harness repositories. Read-only dependency restrictions apply to descendants as well.

Commands start in the member worktree. A script may need cd to an assigned directory: directory contents outside read scope are unavailable even when scoped Git can operate from the root. Minimal runtime/system files and temporary scratch are available; provider credentials and the backend environment are not inherited. Network access is disabled. Output is capped at 64 KiB and execution at 60 seconds; cancellation/timeout terminates the process group before checkpointing and outstanding broker operations settle first.

## Failure behavior

Invalid metadata, unknown scopes, unsupported Git syntax, unsafe paths, links in managed snapshots and out-of-scope operations fail explicitly. Read-only dependencies and control files cannot be made writable through a shell or metadata. Invalid/missing design mappings never grant permissive implementation scope.

Unapproved protected commits preserve pending files and staging. Stale reviews/bases fail instead of overwriting newer accepted state. Command results expose exitCode, signal, stdout, stderr, timedOut and truncated. Git refusals appear as nonzero shell status with an error code in stderr; tool validation/authority failures use explicit refusal feedback. Missing sandbox dependencies fail without an unrestricted fallback.

## Guarantees and limits

Each member retains its private worktree. Scope acceptance and checkpoint history are independent of group publication and active member configuration. The original checkout's Git branch/index remain untouched. No automatic merge, peer-worktree refresh, new configuration activation policy, approval UI, network allowance or automatic context-maintenance algorithm is provided.

Startup converts active legacy member records to backend-owned metadata and design-only assignments, preserving identity/settings/commands, exact prior source and pending drafts. Old Git references remain reachable; matching scopes retain their history. When a scope shape changes, existing pending files are preserved and a new scope reference is initialized; old references are retained. Stale or legacy drafts are not rewritten automatically. Existing non-Bash allowances require a future policy update to authorize general Bash. Linux isolation requires its external dependencies; verification in this task uses macOS.

## Acceptance examples

1. An empty workspace lead creates pending design/member files, but has no implementation access until accepted designs are assigned. Both management commits require user acceptance.
2. A working backend mapping grants backend edits; a dependency shared mapping grants reads only. A pending mapping change cannot grant another directory.
3. A worker requests member-config scope or reads a lead prompt path: refuse, including inside a script.
4. A member stages implementation A, edits it to B, then finishes a run. The checkpoint records B, the index still contains A, and git commit accepts A only.
5. Design and implementation are staged separately. An implementation commit preserves design staging and acceptance.
6. A user reviews design, then files change: acceptance refuses the stale revision. Accepting a current design snapshot makes its mapping visible to semantic reads and scope resolution.
7. A lead stages member JSON/prompt changes. Agent commit is refused; user file acceptance does not change active member settings.
8. A child process attempts to write a management/dependency path or open native Git metadata: the execution boundary refuses it.
