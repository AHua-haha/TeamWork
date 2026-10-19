# Harness

## Purpose and boundary

A harness defines permitted scope, capabilities and maintenance rules for one purpose. Tools are reusable across agents. Runtime runs an agent using the tools and prompts assembled from its harnesses. All members use the registered workspace directory directly. The team executes one member at a time through finalization. Implementation uses the project Git repository and one shared index; protected scopes retain independent harness history.

Three fixed bases provide management, implementation and execute authority. The agent configures working/dependency designs; the backend derives implementation paths from accepted designs. Member changes follow file validation, user commit and a separate idle user activation.

## Inputs and preconditions

A member assignment contains designScope: {working: [node metadata paths], dependencies: [node metadata paths]}. The lists must be disjoint, valid and resolvable. It contains no independently configurable implementationScope. The fixed execute base grants broad Bash execution to every active member; persisted command-rule fields remain source-format data and do not admit or restrict execution.

The lead can edit all .rsi/context/design and .rsi/members with scoped file tools immediately. All members can read workspace content. Other members follow exact working/dependency designs; read-only tools can inspect the whole workspace. For write/edit invocations and scoped Git, both roles derive implementation context from assigned nodes under .rsi/context/implement and source code from accepted mappings; dependency implementation/context is read-only. Implementation-code authority starts empty until accepted design mappings grant paths. Working-design implementation context is independently writable even with no code mappings.

Pi ls/read/grep/find/write/edit use default operations and preserve native content, details and truncation. Harness input checks keep paths inside the workspace and restrict write/edit targets by accepted assignments; reads do not use assignment filters. One custom bash tool takes {command, cwd?, timeout?, background?, metadata?: {git?: {scope}}}; scope is design, member-config, implementation or a listed impl-context-<hash> part when that member owns the part. No identity, revision, approval, repository, index or reference may be supplied through metadata.

Every member can run arbitrary Bash without an executable or exact-command allowlist. Optional Git metadata selects the controlled Git workflow and never changes filesystem write authority. Without it, Git is native project Git. Native Git and direct workspace metadata writes are possible under the broad sandbox, so scoped checks are not an exclusive security boundary. The OS enforces resource access during execution, including child processes. A denied operation does not roll back earlier effects.

Bash requires Git, Node.js and a supported OS sandbox: macOS sandbox-exec, or Linux bubblewrap with the sandbox runtime's dependencies. Unsupported/unavailable isolation fails closed. Bash allows outbound network and local server binding through the sandbox runtime network infrastructure. Docker daemon/socket authority is not granted. The backend separately provides web_search and web_fetch through the fixed execute base for all members, independently of historical command-rule fields and model provider.

## Outputs and observable effects

### Purpose harnesses

| Base | Scope and capabilities | Semantic commit policy |
| --- | --- | --- |
| management | Lead-only write/edit authority for design and member files; broad workspace reads; optional scoped Git; lead model discovery and file validation | User acceptance for design and member-config |
| implementation | Writable implementation from accepted working mappings and paired working-design context; read-only dependency implementation/context; common file tools and scoped Git Bash | Agent may commit code and implementation context independently |
| execute | Persistent Bash per member: system reads, whole-workspace/workspace-temp writes, networking, native background jobs and no executable control; web_search/web_fetch | Scoped Git enforces its workflow; raw Bash/Git writes are deliberately broader |

Base harness rule prompts are maintained as backend-owned Markdown files, including shared rules, per-scope maintenance instructions and initial Markdown templates. Runtime and inspection use those same file contents. Templates receive backend-owned workspace/command values; files cannot grant permissions or replace enforced policy. They load when the backend starts; changing source prompts requires restarting development mode or rebuilding/restarting the compiled backend. Missing or empty required prompt files fail startup rather than using hardcoded fallback rules.

Tool names are deduplicated from the bases at request preparation and all base/member prompts form the system prompt. Member files cannot override base policy. Working mappings yield writable implementation; dependency mappings yield read-only use paths. Read-only wins overlaps. Git metadata, .rsi/context and .rsi are excluded from implementation even for root mappings. Pending design edits grant no authority. Accepted designs are resolved at inspection, tool and request preparation. Pending design filesystem changes do not grant implementation authority; accepted harness snapshots and explicit user context saves supply semantic reads.

### System context authority and rules

A node reference is design-root-relative metadata.json (root) or backend/metadata.json. metadata.json stores only accepted implementation mappings. Design content is design.md or design/README.md plus Markdown documents; implementation context independently uses impl.md or impl/README.md plus Markdown documents. Multiple documents remain one node/assignment; actual child systems have separate metadata and assignments. Exact working/dependency nodes do not inherit descendants.

Design content lives under .rsi/context/design and implementation context under .rsi/context/implement, with matching relative node paths. Only the lead receives global write/edit tool permission for design/metadata. Both roles can edit exact working implementation context and accepted mapped source paths, while dependency implementation/context stays read-only. Global design management also covers designs used as dependencies without expanding implementation authority. Private state/member policy remains unchanged. File and directory forms have the same authority.

Each working node has an impl-context-<hash> part, with ID derived from the first 16 SHA-256 hex characters of lower-case metadata reference. It covers both impl.md and impl/ and permits agent semantic commits independently of code/design/member history. Context files are shared directly across assignments, including pending edits. Opening a scope never materializes or restores older snapshots over current files.

Management design parts have a design context selector: only metadata and design documents belong to their snapshots/staging, including future nodes. Implementation-context parts use an impl selector. These selectors participate in scope identity, filter native Git operations and keep purpose-root parts disjoint. Metadata cannot override them. User acceptance validates immutable reviewed metadata/Markdown; implementation-context semantic commits validate the selected snapshot/staged structural form. Choose one representation, with README.md for directory form, 1–100 nonempty Markdown documents and 1 MiB total. Checkpoints may retain pending invalid forms for repair; semantic refusals preserve pending/staged state.

Base prompts prescribe complete design context (purpose/boundaries, Interface contract, requirements), independently of document count, and actual implemented contracts with Input, Output, Effect and Usage examples. Reading relevant context, updating examples/facts and surfacing inconsistencies are prompt instructions. No fixed per-section file split, semantic prose parser, new agent tool or maintenance loop is added. Reusable knowledge remains deferred outside context.

### File-tool and scoped-workflow permission structure

These working/dependency components govern write/edit tool inputs and controlled Git scopes. All read-only Pi tools can inspect workspace content. Bash separately permits whole-workspace writes and does not enforce these assignment boundaries.

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
| Design context | Read workspace/edit the entire design tree, including metadata/mappings | Read workspace/follow assigned nodes; no file-tool edits |
| Implementation context | Read workspace/edit exact working nodes under implement/ | Read workspace/edit exact working nodes under implement/ |
| Implementation | Read workspace/edit accepted working-design source mappings | Read workspace/edit accepted working-design source mappings |

The lead's global design-management permission belongs to the design-context component of its working scope. It grants no additional implementation-context or source-code access. An ordinary member follows its accepted design and reports required design changes to the lead.

### Dependencies

Dependency scope supplies resources used by the work. It grants no write/edit mutation or scoped semantic commit capability; broad Bash authority remains separate.

| Component | Lead | Other member |
| --- | --- | --- |
| Design context | Already covered by its global working design-context permission; dependency use adds no edit authority | Read/follow exact dependency design nodes |
| Implementation context | Read exact dependency nodes; no edits | Read exact dependency nodes; no edits |
| Implementation | Read accepted dependency source mappings; no edits | Read accepted dependency source mappings; no edits |

The lead's design management still covers a system whose implementation it uses as a dependency. Its design context is already in the lead's global working design-context scope; that does not permit editing the system's dependency implementation context or source code. Read-only dependency restrictions win overlapping implementation/source mappings. Ordinary members' design context remains read-only in both working and dependency scope.

### Derivation, commits and purpose harnesses

Implementation context follows exact working/dependency design nodes. Project implementation follows the accepted metadata mappings of those nodes. A working node with an empty source-code mapping can still have writable implementation context. Context directories do not grant descendant-node ownership; mapped source directories cover their source descendants subject to protected paths and dependency restrictions.

The management harness provides design/member capabilities and maintenance rules. Only the lead receives a writable design Git scope. It can create/move/delete design nodes/documents, edit metadata/mappings and stage/restore design within that scope, while semantic design commit requires user acceptance. Other members receive read-only working/dependency designs through the common read tools and no writable design scope.

The implementation harness provides implementation-context and project-file capabilities within the resolved working/dependency components. Both roles can stage/restore/commit their writable implementation context and source code through their separate scopes. Private .rsi/.git state remains excluded from project-code access. File-tool and scoped-Git authority cannot expand another component. Bash has independent whole-workspace write authority, including these components; maintenance instructions still require members to follow their assignments.

Member validation and file-tool editing remain lead-only: edit configuration and prompts within its existing member scope, user commit, then separate user activation while the whole workspace is idle. Pending design/mapping edits cannot expand implementation authority before user acceptance. Design, implementation context, source-code and member histories remain independently controlled.

### Scoped Git and stable history

Agents use ordinary git status, diff, add, log, show, restore and commit syntax through bash with one selected scope. When metadata selects a scope, backend supplies trusted Git context and enforces ordinary Git invocations through its PATH bridge, including scripts. Without metadata, native project Git runs normally. Absolute native Git and direct metadata writes remain possible with the broad resource policy. Repository retargeting, arbitrary revisions, hooks and unsupported options are refused. Supported forms:

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

### Tool execution and persistent Bash

The [tool contract](tools/design.md) defines native Pi integration and model-visible custom results. Read/ls/grep/find freely inspect workspace content using Pi defaults; write/edit authorize target inputs against accepted assignments. Existing path ancestors resolving outside the workspace are refused; mutation paths through symbolic links are refused. These are invocation checks, not OS isolation of the backend's default filesystem operations against concurrent Bash changes. Internal member-file helpers remain available for backend management workflows and are not injected into agent tools.

The [Bash contract](tools/bash/design.md) defines one persistent shell per member, command/cwd/timeout/background/metadata input, combined foreground output and native background job IDs. Its OS sandbox permits reads of the system subject to existing OS permissions, writes to the whole workspace and workspace-owned temporary area, and networking. There are no additional executable restrictions or working/dependency write filters. This includes .rsi and native .git under the workspace. Backend environment credentials are not inherited, but filesystem confidentiality of host files is not promised by this system-read policy.

Foreground calls retain the last 50 KiB with a visible notice and have a 60-second default timeout; explicit positive timeout overrides it. Background jobs have no default timeout. They inherit /dev/null stdout/stderr, overridden by redirection inside the unchanged agent command, and return native job_id. Agents use jobs, wait and kill through Bash; there are no new job-management tools or automatic output files. Commands use noninteractive stdin. Foreground timeout/cancellation resets the shell and its jobs; an explicit background timeout terminates that job. Shell state/jobs survive runs and stop on reset, retirement, affected member configuration activation/update, or backend shutdown. Raw command output is readable text followed by execution metadata, with no cwd or PID fields.

Bash and user file operations enter the workspace operation queue; running background jobs deliberately continue outside that queue. A checkpoint is an observation of current files, not a promise that a still-running background job cannot change them later. User review still identifies exact snapshot/base tokens. Scoped Git and user-acceptance APIs retain their own checks, while unrestricted workspace Bash effects are not claimed to be protected by those checks.

## Failure behavior

Invalid metadata, unknown scopes, unsupported Git syntax, unsafe paths, links in managed snapshots and out-of-scope operations fail explicitly. Out-of-assignment write/edit invocations and unsupported scoped Git requests are refused. Bash writes to workspace dependencies and control files are intentionally allowed. Invalid/missing design mappings never grant permissive implementation scope.

Unapproved protected commits preserve pending files and staging. Stale reviews/bases fail instead of overwriting newer accepted state. Bash results contain combined command text and a metadata footer with status, exit code/duration/truncation for foreground calls, or native job_id for background starts. Timeout and shell-restart metadata are explicit. Git refusals appear as nonzero shell status with an error code in stderr; tool validation/authority failures use explicit refusal feedback. Missing sandbox dependencies fail without an unrestricted fallback.

## Guarantees and limits

The registered project directory is the shared working copy. Pending changes are immediately visible to members with read permission and to the user. There is no copying or merging between member directories. Automatic checkpoints do not modify project Git staging or create project commits.

Startup converts active legacy member records to backend-owned metadata and design-only assignments, preserving identity/settings/commands, exact prior source and pending drafts. Old Git references remain reachable; matching scopes retain their history. When a scope shape changes, existing pending files are preserved and a new scope reference is initialized; old references are retained. Stale or legacy drafts are not rewritten automatically. Historical command-rule fields remain in the source schema but have no effect on the fixed broad execute policy. Linux isolation requires its external dependencies; verification in this task uses macOS.

## Acceptance examples

1. An empty workspace lead creates pending design/member files. Its scoped implementation file-tool authority starts empty until accepted assignments grant paths; Bash still has whole-workspace write authority. Both controlled management commits require user acceptance.
2. A working backend mapping grants backend edits; a dependency shared mapping grants reads only. A pending mapping change cannot grant another directory.
3. A worker requests member-config Git scope: refuse that broker request. Reading a lead prompt inside the workspace is allowed. A broad Bash write can change workspace files even where the same member's write/edit input would be refused.
4. A member stages implementation A, edits it to B, then finishes a run. The checkpoint records B, the index still contains A, and git commit accepts A only.
5. Design and implementation are staged separately. An implementation commit preserves design staging and acceptance.
6. A user reviews design, then files change: acceptance refuses the stale revision. Accepting a current design snapshot makes its mapping visible to semantic reads and scope resolution.
7. A lead stages member JSON/prompt changes. Agent commit is refused; user file acceptance alone does not change active member settings.
8. A Bash child writes a management/dependency path or native Git metadata inside the workspace: the resource policy allows it. A write outside the workspace and workspace-owned temporary area is denied, without rolling back earlier allowed effects.

Harness storage is .rsi/harness inside the managed workspace root. It is excluded from scoped snapshots and scoped project-file edits. Read-only Pi tools and broad Bash can access it; this prototype does not isolate its metadata from those capabilities. Bootstrap initializes the lead design/member scopes as accepted baselines; later commits retain their user-only policy.

9. A root lead with empty implementation mappings edits its root implementation context and commits it through its listed context scope; its file-tool code writes still require accepted mappings. A dependency context is readable/searchable but not writable through write/edit or selectable as a controlled commit scope.

Safe unresolvable stored assignments remain visible in member source/readiness inspection but provide no derived implementation-context authority and cannot run. New member validation and run admission resolve real nodes; no old-layout content fallback or automatic migration is introduced.

Prompt assembly and permission resolution use accepted design revisions. File tools read shared pending bytes under existing read permissions; pending design differences are not accepted authority. No read-only file copies are hydrated.

## Web capabilities

Every member receives web_search({query,count?,original_question?}) and web_fetch({url}) from the fixed execute base independently of historical command-rule fields. Search filters live in query; count defaults to 5 (1–50), query and original_question allow 1–128 Unicode characters. Fetch requires an HTTP/HTTPS URL with a host and no credentials, at most 8192 characters. Backend deployment manages the DeepSeek API key; no member configuration fields or credential inspection are introduced. Runtime and active harness inspection expose the same capability names and file-backed rules.

Each tool returns one Markdown text content block, followed by a distinct <metadata> block using named YAML fields. Search core content contains titles, URLs and snippets capped at 300 Unicode characters each; fetch preserves page Markdown. Metadata records attribution, retrieval time, status and truncation. There is no outer JSON string and no extra summarizing model call. Empty search is successful. Invalid input, missing credentials, HTTP/network/timeout/response failures become recorded tool errors under the existing runtime failure behavior; cancellation aborts the request. No automatic retries are added. Body reads are limited to 4 MiB, the entire request to 30 seconds and Markdown core text to 64 KiB with explicit truncation. Bash filesystem isolation and file/Git permissions remain enforced independently.

## Scoped file review

`GET /workspaces/:workspaceId/team/members/:memberId/harness/:part/review` returns `{memberId,partId,revision,base,changes}` for an active member's writable part. changes is a flat array `{path,action,patch,truncated}` of committed-to-current pending file differences. The immutable reviewed snapshot and committed base are the exact tokens for existing user commit controls. Review does not commit, activate, edit workspace files or change staged content; it may persist a harness checkpoint. Missing/cross-workspace member or unknown part is 404. Large/binary patches retain existing snapshot-diff limitations and truncation indication.

### Shared project execution and Git

Every member file/Bash environment is the registered project directory. Accepted assignments constrain write/edit inputs and scoped Git. Bash separately has whole-workspace write authority. Pending edits, including incomplete changes after failure/cancellation, remain visible in that directory. Existing private member worktree artifacts are preserved but unused; no automatic import, deletion or reconciliation of those old files occurs.

Scoped implementation Git operates on the project repository's current branch and one shared index. If no .git directory exists at the workspace root, first implementation Git use initializes it without an initial commit or changing project files. Existing repository history/branch are preserved. Linked external .git metadata is not supported by this prototype boundary. Supported syntax remains status/diff/add/rm/log/show/restore/commit with the documented restricted options. Implementation log/show/restore use project revisions; protected and implementation-context scopes use their harness revisions.

Stage only authorized implementation files. A commit accepts staged bytes only, preserving unstaged edits. If any staged change belongs outside the current implementation authority, refuse without committing or discarding unrelated staging. No automatic implementation semantic commit occurs at run completion. Git-ignored untracked dependencies/build artifacts are excluded from implementation checkpoints and ordinary staging; already tracked files remain eligible. Checkpoints and protected approval records stay in private harness storage, separate from project Git versions. Scope checkpoints record the actor/run without duplicating project working directories.

The user reviews/runs the same directory. Stable review requires an idle or stopped team; concurrent user edits remain the user's responsibility. Design/member acceptance still requires exact reviewed tokens, and member activation remains separate and workspace-idle. Opening an environment never writes accepted dependency snapshots into the workspace.

## Broad Bash execution resources

System reads and workspace/workspace-owned temporary writes apply to the whole persistent shell and its descendants. Installed toolchains are reached through controlled PATH; writable shell HOME/cache/tmp live in the workspace temporary area. Arbitrary backend environment variables are not inherited. The system-read policy does not promise confidentiality for readable host files.

Network access and local binding use sandbox runtime proxies. Compatibility with programs that ignore proxy settings is not promised. macOS grants the member's Git bridge socket; Linux retains runtime Unix-socket compatibility. No CPU/memory quota is introduced. Foreground execution has a 60-second default timeout and last-50-KiB output limit; background jobs persist until stopped, reset, changed configuration, shutdown or an explicit job timeout. Git metadata selects the controlled workflow without reducing raw Bash/native Git authority.
