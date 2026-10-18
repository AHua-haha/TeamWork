# Harness

## Purpose and boundary

A harness defines permitted scope, capabilities and maintenance rules for one purpose. Tools are reusable across agents. Runtime runs an agent using the tools and prompts assembled from its harnesses. All members use the registered workspace directory directly. The team executes one member at a time through finalization. Implementation uses the project Git repository and one shared index; protected scopes retain independent harness history.

Three fixed bases provide management, implementation and execute authority. The agent configures working/dependency designs; the backend derives implementation paths from accepted designs. Member changes follow file validation, user commit and a separate idle user activation.

## Inputs and preconditions

A member assignment contains designScope: {working: [node metadata paths], dependencies: [node metadata paths]}. The lists must be disjoint, valid and resolvable. It contains no independently configurable implementationScope. Member execution rules can be configured through member files and validated under the fixed execute base policy.

The lead can read/edit all .rsi/context/design and lead-only .rsi/members immediately. Other members can only read/follow exact working/dependency designs. Both roles derive implementation context from assigned nodes under .rsi/context/implement and source code from accepted mappings; dependency implementation/context is read-only. Implementation-code authority starts empty until accepted design mappings grant paths. Working-design implementation context is independently writable even with no code mappings.

Common ls/read/write/edit tools operate on pending files. One bash tool takes {command, metadata?: {git: {scope}}}; scope is design, member-config, implementation or a listed impl-context-<hash> part when that member owns the part. No identity, revision, approval, repository, index or reference may be supplied through metadata.

Scoped Git Bash is available independently of general execution allowances. General Bash requires an exact allowance for ["bash", "-c", command], or executable "bash". Previous non-Bash executable allowances remain stored but do not authorize a shell. Richer execution-rule capabilities remain outside this prototype.

Bash requires Git, Node.js and a supported OS sandbox: macOS sandbox-exec, or Linux bubblewrap with the sandbox runtime's dependencies. Unsupported/unavailable isolation fails closed. Bash has no network allowance. The backend separately provides web_search and web_fetch through the fixed execute base for all members, independently of Bash allowances and model provider.

## Outputs and observable effects

### Purpose harnesses

| Base | Scope and capabilities | Semantic commit policy |
| --- | --- | --- |
| management | Lead-only design editing and member files; other members read working/dependency designs, common file tools and scoped Git Bash; lead model discovery and file validation | User acceptance for design and member-config |
| implementation | Writable implementation from accepted working mappings and paired working-design context; read-only dependency implementation/context; common file tools and scoped Git Bash | Agent may commit code and implementation context independently |
| execute | General Bash under existing allowances and applicable filesystem restrictions; reusable web_search/web_fetch through backend-managed DeepSeek credentials | Cannot override protected scopes or Git acceptance |

Base harness rule prompts are maintained as backend-owned Markdown files, including shared rules, per-scope maintenance instructions and initial Markdown templates. Runtime and inspection use those same file contents. Templates receive backend-owned workspace/command values; files cannot grant permissions or replace enforced policy. They load when the backend starts; changing source prompts requires restarting development mode or rebuilding/restarting the compiled backend. Missing or empty required prompt files fail startup rather than using hardcoded fallback rules.

Tools are assembled once and all base/member prompts form the system prompt. Member files cannot override base policy. Working mappings yield writable implementation; dependency mappings yield read-only use paths. Read-only wins overlaps. Git metadata, .rsi/context and .rsi are excluded from implementation even for root mappings. Pending design edits grant no authority. Accepted designs are resolved at inspection, tool and request preparation. Pending design filesystem changes do not grant implementation authority; accepted harness snapshots and explicit user context saves supply semantic reads.

### System context authority and rules

A node reference is design-root-relative metadata.json (root) or backend/metadata.json. metadata.json stores only accepted implementation mappings. Design content is design.md or design/README.md plus Markdown documents; implementation context independently uses impl.md or impl/README.md plus Markdown documents. Multiple documents remain one node/assignment; actual child systems have separate metadata and assignments. Exact working/dependency nodes do not inherit descendants.

Design content lives under .rsi/context/design and implementation context under .rsi/context/implement, with matching relative node paths. Only the lead can edit design/metadata globally. Both roles can edit exact working implementation context and accepted mapped source paths, while dependency implementation/context stays read-only. Global design management also covers designs used as dependencies without expanding implementation authority. Private state/member policy remains unchanged. File and directory forms have the same authority.

Each working node has an impl-context-<hash> part, with ID derived from the first 16 SHA-256 hex characters of lower-case metadata reference. It covers both impl.md and impl/ and permits agent semantic commits independently of code/design/member history. Context files are shared directly across assignments, including pending edits. Opening a scope never materializes or restores older snapshots over current files.

Management design parts have a design context selector: only metadata and design documents belong to their snapshots/staging, including future nodes. Implementation-context parts use an impl selector. These selectors participate in scope identity, filter native Git operations and keep purpose-root parts disjoint. Metadata cannot override them. User acceptance validates immutable reviewed metadata/Markdown; implementation-context semantic commits validate the selected snapshot/staged structural form. Choose one representation, with README.md for directory form, 1–100 nonempty Markdown documents and 1 MiB total. Checkpoints may retain pending invalid forms for repair; semantic refusals preserve pending/staged state.

Base prompts prescribe complete design context (purpose/boundaries, Interface contract, requirements), independently of document count, and actual implemented contracts with Input, Output, Effect and Usage examples. Reading relevant context, updating examples/facts and surfacing inconsistencies are prompt instructions. No fixed per-section file split, semantic prose parser, new agent tool or maintenance loop is added. Reusable knowledge remains deferred outside context.

### Permission structure

Organize the resolved permission view into two parts: working scope and dependency scope. Each has three resource components: design context, implementation context and implementation (the actual project source/files). This is the permission model; it does not introduce independent agent-configurable implementation assignments. The backend still derives the scopes from role, assigned design nodes and accepted source-code mappings.

```text
Harness permissions
  Working scope
    Design context
    Implementation context
    Implementation (project source/files)
  Dependencies
    Design context
    Implementation context
    Implementation (project source/files)
```

### Working scope

Working scope identifies the resources available for carrying out the assigned work. Permission is explicit per component: being in working scope does not necessarily make design context editable.

| Component | Lead | Other member |
| --- | --- | --- |
| Design context | Read/edit the entire design tree, including metadata/mappings | Read/follow exact working design nodes; no edits |
| Implementation context | Read/edit exact working nodes under implement/ | Read/edit exact working nodes under implement/ |
| Implementation | Read/edit project paths from accepted working-design mappings | Read/edit project paths from accepted working-design mappings |

The lead's global design-management permission belongs to the design-context component of its working scope. It grants no additional implementation-context or source-code access. An ordinary member follows its accepted design and reports required design changes to the lead.

### Dependencies

Dependency scope supplies resources used by the work. It grants read-only access and no mutation or semantic commit capability.

| Component | Lead | Other member |
| --- | --- | --- |
| Design context | Already covered by its global working design-context permission; dependency use adds no edit authority | Read/follow exact dependency design nodes |
| Implementation context | Read exact dependency nodes; no edits | Read exact dependency nodes; no edits |
| Implementation | Read accepted dependency source mappings; no edits | Read accepted dependency source mappings; no edits |

The lead's design management still covers a system whose implementation it uses as a dependency. Its design context is already in the lead's global working design-context scope; that does not permit editing the system's dependency implementation context or source code. Read-only dependency restrictions win overlapping implementation/source mappings. Ordinary members' design context remains read-only in both working and dependency scope.

### Derivation, commits and purpose harnesses

Implementation context follows exact working/dependency design nodes. Project implementation follows the accepted metadata mappings of those nodes. A working node with an empty source-code mapping can still have writable implementation context. Context directories do not grant descendant-node ownership; mapped source directories cover their source descendants subject to protected paths and dependency restrictions.

The management harness provides design/member capabilities and maintenance rules. Only the lead receives a writable design Git scope. It can create/move/delete design nodes/documents, edit metadata/mappings and stage/restore design within that scope, while semantic design commit requires user acceptance. Other members receive read-only working/dependency designs through the common read tools and no writable design scope.

The implementation harness provides implementation-context and project-file capabilities within the resolved working/dependency components. Both roles can stage/restore/commit their writable implementation context and source code through their separate scopes. Private .rsi/.git state remains excluded from project-code access. File tools, Bash and Git operations cannot make another component writable merely because an agent can edit implementation.

Member management remains lead-only: read/edit configuration and prompts within its existing member scope, user commit, then separate user activation while the whole workspace is idle. Pending design/mapping edits cannot expand implementation authority before user acceptance. Design, implementation context, source-code and member histories remain independently controlled.

### Scoped Git and stable history

Agents use ordinary git status, diff, add, log, show, restore and commit syntax through bash with one selected scope. Backend supplies trusted Git context and enforces actual operations, including calls inside scripts. Repository retargeting, arbitrary revisions, hooks and unsupported options are refused. Supported forms:

- git status [--short|--porcelain|--branch]
- git diff [--cached|--staged] [--stat|--name-only|--name-status]
- git add [-A|--all] -- <paths> (an omitted path selects the scope)
- git rm [-r] [-f|--force] -- <paths>
- git log [--all] [--oneline] [--max-count=N|-N|-nN]
- git show [HEAD|full-project-or-scope-revision]
- git restore [--staged] [--worktree] [--source=full-project-or-scope-revision] -- <paths>
- git commit -m "meaningful intent"

Paths are literal relative paths, scoped to the selected part; "." narrows to that part rather than the whole workspace. For implementation HEAD is the project branch and log shows project commits. For protected/context scopes HEAD is the scope accepted base and log --all also includes checkpoints. Working-file restore first checkpoints pending bytes, then retains Git's tracked-file semantics. A full latest-accepted restore of both index and files refreshes a stale base when both exactly match that accepted tree. The backend review/restore API also provides scoped recovery snapshot restoration. Implementation semantic commits use project Git through Bash; the user acceptance endpoint is for protected/context scopes.

Protected and implementation-context scopes have independent staging, accepted bases and references. Implementation uses one shared native project index. Context scope identity includes its enforced content selector and normalized paths/exclusions. Implementation-code and implementation-context commits accept staged bytes only. Unstaged changes and other scopes remain pending. Design/member-config Git commits return approval_required without accepting or resetting staged changes. User review names exact checkpoint revision and expected accepted base; changed bytes or stale bases refuse acceptance.

Automatic checkpoints occur at run end, including failure/cancellation and interruption recovery, and before successful final group publication after tool effects settle. They use separate temporary indexes, preserve staging and do not imply approval. Checkpoint failure prevents a success claim. History and restored snapshots remain scoped.

### Accepted files and member settings

The registered project directory is the shared working copy. Pending changes are immediately visible to members with read permission and to the user. There is no copying or merging between member directories. Automatic checkpoints do not modify project Git staging or create project commits.

Member JSON holds name, role, responsibility, settings, ordered prompt references, designScope and execute: {allowedCommands}. Backend retains identity/path association, format version, revisions and exact active source bytes separately. The lead edits and validates create/update/delete changes in files. Updates may change only responsibility, supplementary prompts and execution rules, preserving name, role, model/run settings and assignments. validate_member_config({path: ".rsi/members"}) reports pending create/update/delete and issues without acceptance or activation. Deliberately deleted seeded member files remain pending across materialization/restart. Delete retires and preserves history/files; lead deletion is refused. User commit accepts file bytes only. Separate user activation applies the reviewed committed change set atomically when the whole workspace team is idle. Busy/invalid/stale activation leaves all active settings unchanged; no automatic activation or activation by an agent is allowed. Uncommitted edits stay pending.

### Execution

Scoped Git Bash can read authorized context/implementation and use the trusted Git bridge; direct shell writes are disabled. General Bash can write authorized implementation only. Management files and Git metadata are protected from direct Bash and descendant processes. File tools provide pending management editing and working implementation-context editing. Git without scope metadata cannot use the bridge; absolute native Git cannot access protected harness repositories. Read-only dependency restrictions apply to descendants as well.

Commands start in the registered shared workspace. A script may need cd to an assigned directory: directory contents outside read scope are unavailable even when scoped Git can operate from the root. Minimal runtime/system files and temporary scratch are available; provider credentials and the backend environment are not inherited. Bash network access is disabled. Output is capped at 64 KiB and execution at 60 seconds; cancellation/timeout terminates the process group before checkpointing and outstanding broker operations settle first.

## Failure behavior

Invalid metadata, unknown scopes, unsupported Git syntax, unsafe paths, links in managed snapshots and out-of-scope operations fail explicitly. Read-only dependencies and control files cannot be made writable through a shell or metadata. Invalid/missing design mappings never grant permissive implementation scope.

Unapproved protected commits preserve pending files and staging. Stale reviews/bases fail instead of overwriting newer accepted state. Command results expose exitCode, signal, stdout, stderr, timedOut and truncated. Git refusals appear as nonzero shell status with an error code in stderr; tool validation/authority failures use explicit refusal feedback. Missing sandbox dependencies fail without an unrestricted fallback.

## Guarantees and limits

The registered project directory is the shared working copy. Pending changes are immediately visible to members with read permission and to the user. There is no copying or merging between member directories. Automatic checkpoints do not modify project Git staging or create project commits.

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

Safe unresolvable stored assignments remain visible in member source/readiness inspection but provide no derived implementation-context authority and cannot run. New member validation and run admission resolve real nodes; no old-layout content fallback or automatic migration is introduced.

Prompt assembly and permission resolution use accepted design revisions. File tools read shared pending bytes under existing read permissions; pending design differences are not accepted authority. No read-only file copies are hydrated.

## Web capabilities

Every member receives web_search({query,count?,original_question?}) and web_fetch({url}) from the fixed execute base even when allowedCommands is empty. Search filters live in query; count defaults to 5 (1–50), query and original_question allow 1–128 Unicode characters. Fetch requires an HTTP/HTTPS URL with a host and no credentials, at most 8192 characters. Backend deployment manages the DeepSeek API key; no member configuration fields or credential inspection are introduced. Runtime and active harness inspection expose the same capability names and file-backed rules.

Each tool returns one Markdown text content block, followed by a distinct <metadata> block using named YAML fields. Search core content contains titles, URLs and snippets capped at 300 Unicode characters each; fetch preserves page Markdown. Metadata records attribution, retrieval time, status and truncation. There is no outer JSON string and no extra summarizing model call. Empty search is successful. Invalid input, missing credentials, HTTP/network/timeout/response failures become recorded tool errors under the existing runtime failure behavior; cancellation aborts the request. No automatic retries are added. Body reads are limited to 4 MiB, the entire request to 30 seconds and Markdown core text to 64 KiB with explicit truncation. Bash isolation and file/Git permissions remain enforced independently.

## Scoped file review

`GET /workspaces/:workspaceId/team/members/:memberId/harness/:part/review` returns `{memberId,partId,revision,base,changes}` for an active member's writable part. changes is a flat array `{path,action,patch,truncated}` of committed-to-current pending file differences. The immutable reviewed snapshot and committed base are the exact tokens for existing user commit controls. Review does not commit, activate, edit workspace files or change staged content; it may persist a harness checkpoint. Missing/cross-workspace member or unknown part is 404. Large/binary patches retain existing snapshot-diff limitations and truncation indication.

### Shared project execution and Git

Every member file/Bash environment is the registered project directory. Existing working/dependency read/write authority stays enforced. Pending edits, including incomplete changes after failure/cancellation, remain visible in that directory. Existing private member worktree artifacts are preserved but unused; no automatic import, deletion or reconciliation of those old files occurs.

Scoped implementation Git operates on the project repository's current branch and one shared index. If no .git directory exists at the workspace root, first implementation Git use initializes it without an initial commit or changing project files. Existing repository history/branch are preserved. Linked external .git metadata is not supported by this prototype boundary. Supported syntax remains status/diff/add/rm/log/show/restore/commit with the documented restricted options. Implementation log/show/restore use project revisions; protected and implementation-context scopes use their harness revisions.

Stage only authorized implementation files. A commit accepts staged bytes only, preserving unstaged edits. If any staged change belongs outside the current implementation authority, refuse without committing or discarding unrelated staging. No automatic implementation semantic commit occurs at run completion. Git-ignored untracked dependencies/build artifacts are excluded from implementation checkpoints and ordinary staging; already tracked files remain eligible. Checkpoints and protected approval records stay in private harness storage, separate from project Git versions. Scope checkpoints record the actor/run without duplicating project working directories.

The user reviews/runs the same directory. Stable review requires an idle or stopped team; concurrent user edits remain the user's responsibility. Design/member acceptance still requires exact reviewed tokens, and member activation remains separate and workspace-idle. Opening an environment never writes accepted dependency snapshots into the workspace.
