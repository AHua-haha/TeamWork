# Harness

Permission and approval enforcement below describes the default enabled mode. The operator's optional startup setting `harnessPermissionsEnabled: false` bypasses harness permission gates; semantic validation, user activation and runtime lifecycle rules remain in force.

## Purpose and boundary

A harness defines tools, permitted resources and maintenance rules for one purpose. Runtime assembles its tools/prompts and runs the agent. Three fixed bases serve design/member management, implementation and execution. All members operate directly on the registered shared workspace; existing single-member execution ordering remains.

The agent manages ordinary project Git history. Harness responsibility for Git is a permission decision on explicit git commit commands submitted through the Bash tool. It does not manage Git scopes, private repositories, separate indexes/references, semantic history or automatic checkpoints.

## Inputs and preconditions

Member designScope has working and dependency design-node metadata references. Implementation context and project implementation paths derive from accepted design mappings; agents cannot configure independent source authority. Each working reference includes that node and all recursively nested accepted design nodes, following the design folder hierarchy. Overlapping parent/child references resolve each node once. The root metadata.json covers the entire accepted design tree. Dependency references remain explicit and do not expand. Pending child designs grant no authority; newly accepted descendants enter effective working scope on subsequent resolution without changing or reactivating member files. An invalid accepted descendant or incomplete catalog scan refuses resolution rather than silently granting a partial subtree. Pending design edits grant no new file-tool authority.

Pi read/ls/grep/find/write/edit retain default operations, schemas, content/details and truncation. Invocation checks retain workspace path boundaries; write/edit retain working/dependency assignment checks. Management tools remain lead-only. Existing Bash input, persistent member shells, stdout/stderr behavior, timeouts, background jobs, lifecycle and sandbox resource policy remain, except obsolete Git-scope selection is removed.

An explicit Git commit request is evaluated against the actual contents it would commit, not every dirty file. Options changing the candidate contents, such as -a or explicit paths, must be accounted for. Supported foreground forms use git commit [-a|--all] -m <message>, repeated/attached messages, and optional --allow-empty, --signoff/-s, --no-verify and quiet flags. Literal git -C <directory> and explicit absolute Git executables use the same gate. Path-only, interactive, amend, signing and repository/environment override forms refuse with staging guidance. Other Git operations remain native. Empty allowed commits run directly. Commit requests use ordinary project Git; no git.scope, scope IDs or agent-supplied approval authority are required.

## Outputs and observable effects

### Purpose bases and file authority

Management provides lead-only design/member file edits, model discovery, member-file validation and maintenance prompts. Implementation provides working-node implementation-context and accepted mapped-source edits. Execute provides persistent Bash and web tools. Required base prompts remain backend-owned Markdown files, assembled into the system prompt with member instructions. Tools are reusable and deduplicated; prompt changes cannot grant authority.

Permissions remain organized as working scope and dependencies, each with design context, implementation context and implementation. Lead can read/edit all design context and member files; other members read/follow designs without file-tool edits. Both roles edit effective working-node implementation context and mapped implementation files. Dependency implementation/context is read-only for file tools, with read-only precedence on overlaps. Lead design-management permission grants no extra implementation access. Read tools can inspect the workspace.

Bash retains system reads, whole-workspace and workspace-owned temporary writes, networking and no executable allowlist. Existing OS permissions apply. Bash assignment boundaries are instructions rather than filesystem restrictions; this commit gate does not become a complete security boundary.

### Explicit commit decision

| Actual candidate contents | Decision |
| --- | --- |
| Only implementation context under .rsi/context/implement and/or project implementation paths from design mappings | Execute directly |
| Design and/or member files mixed with implementation context or project implementation files | Refuse; tell the agent to split protected and implementation changes into separate commits |
| Only design under .rsi/context/design and/or member files under .rsi/members | Pause the Bash tool for user approval |

Design and member changes can share one approval-required commit. Dirty files excluded from the candidate do not affect the decision. Other Git operations use ordinary Git behavior; no backend scope staging, private accepted branch or scope restore is supplied. The agent stages, commits, inspects and restores through Git. Run success, failure, cancellation and interruption recovery create no automatic file checkpoint.

### Approval interaction

The pending tool call is associated with its workspace/member/run and the exact proposed command, repository and commit contents. User Accept executes only that reviewed candidate. Changed contents invalidate approval and require another review. Deny skips the commit and returns refusal as the tool result. Send feedback skips the commit and returns the user's text as the tool result so the agent can revise. The agent resumes after the tool resolves; opening review is not a decision. Waiting for the user suspends the foreground execution timeout. Run cancellation, shell reset or backend shutdown removes the pending request without replay; backend restart starts with no pending decisions. Frontend reload and other clients can read live pending requests. The first valid decision resolves the request; later decisions receive not-found. Commit execution remains in the Bash sandbox. Normal commit failure is returned to the agent. Hooks are disabled for mediated commits so they cannot change reviewed content.

Frontend offers a compact approval input above the composer and a Review action opening the right panel. Diff content belongs in that panel, not the popup. Mixed protected/implementation commits are refused directly without an approval popup.

User-authorized Git commit and member activation remain separate. Committing member files does not activate them. Existing whole-team-idle, validation and atomic activation guarantees remain; active member snapshots stay in backend durable storage. Accepted design/member file reads use ordinary committed project contents, a bootstrap/import baseline before those paths enter Git, and existing user-authored context saves. No separate Git histories or scope approval endpoints remain.

### Workspace storage

.rsi/context/design contains design Markdown and metadata. .rsi/context/implement contains implementation context, including each assigned node's impl/README.md result summary, file lookup and automatic retrieval configuration. .rsi/members contains member manifests and prompt files. These structures retain their existing meaning.

No mandatory .rsi/harness directory is needed for this design. Ordinary history/index/objects belong to the project .git. Backend approval records are control state, not another Git history; they are session-bound backend state exposed by the team approval endpoints; no new approval files are written under .rsi. Persistent shell homes, caches and temporary files remain in the existing backend-session workspace temporary area outside .rsi. Rule prompt files stay in the backend source, not copied into .rsi/harness.

Legacy .rsi/harness/repository.git, scoped staging/indexes, run/checkpoint/accepted-design refs and obsolete member worktrees are not maintained by the runtime. Existing member materialization markers have a separate initialization purpose and are retired because bootstrap creates files once and ordinary reads never re-materialize active bundles; deleting an intentionally removed member file must not silently recreate it. A one-time durable SQL baseline imports legacy accepted design/member content without writing over pending files or changing project Git. New bootstrap records initial control content in that same baseline. Ordinary project commits replace baseline content once the protected paths are tracked. Existing legacy .rsi/harness data is left untouched and unused after import; new workspaces do not create it. Active member snapshots and SQL message/context history are preserved.

## Failure behavior

Mixed commits return an actionable tool refusal without committing. Deny/feedback skip execution and return control to the agent. Approval cannot authorize changed contents. Git execution errors are ordinary tool results; do not claim a commit succeeded when Git failed. Existing validation, sandbox and member activation failures preserve their guarantees.

Unrecognized paths refuse. Renames are evaluated as deletion plus addition, so both categories count. Git requires a directory repository at the registered workspace root; linked/nested/external repositories are unsupported. Initialize Git through ordinary Bash if needed. Refusals preserve staging and working files. General review/activation control files must be regular UTF-8 text within 1 MiB per file, 16 MiB per read and 2,000 files; binary/link/over-limit content refuses explicitly. Commit diff previews are capped at 262,144 characters per file with a truncation flag. Working-file changes after staging do not invalidate a staged-only candidate; changes affecting its actual candidate or HEAD do.

## Guarantees and limits

Detection covers explicit git commit commands submitted in Bash requests. Indirect commits inside scripts/programs are outside this prototype's detection contract. This is a workflow guard, not comprehensive Git or filesystem enforcement. Shared files remain visible immediately; no member checkout synchronization is introduced. Completed SQL chat history and retained failed working history are unrelated to Git checkpoints and remain durable.

## Acceptance examples

1. Stage implementation files and implementation context, leaving a dirty design unstaged: commit directly; leave the design pending.
2. Stage design and implementation together: refuse and request separate commits; do not alter the staged files.
3. Stage only design and member files: show approval input; Review opens the right-panel diff; Accept executes that reviewed commit.
4. Deny or send feedback: no commit occurs; the agent receives the decision/text and can continue.
5. Modify the candidate after review: an earlier Accept cannot commit the new candidate.
6. Finish or fail a run: preserve ordinary pending files without harness checkpoints or a second Git history.
7. Assign backend/metadata.json: include backend/auth/metadata.json and every deeper accepted child; load their design/context and grant their mapped implementation edits. Do not include sibling backend-extra or children of a dependency. An explicit dependency inside the working subtree keeps read-only precedence for its implementation/context.

## Approval and review API

GET /workspaces/:workspaceId/team/commit-approvals returns {approvals:[{id,workspaceId,memberId,runId,command,directory,message,createdAt}]}; summaries omit diffs. GET the same path plus /:id returns that request with changes [{path,action,patch,truncated}]. POST /:id accepts {action:"accept"|"deny"|"feedback",message?:string}; feedback requires nonempty text, at most 10,000 characters. Resolution returns {resolved:true}; the original tool delivers the eventual execution/refusal result. Unknown or resolved requests return 404. No user-supplied scope, actor, repository, revision or approval flag grants authority.

GET team/changes remains read-only current-versus-committed design/member file review. The old member/harness review/history/restore/commit routes and configuration/commit route are removed. Current configuration inspection and the separate configuration/activate route remain.

## Optional permission bypass

The operator may disable harness permission enforcement using the environment's harnessPermissionsEnabled Boolean in the project configuration; omitted means true. The setting takes effect at backend startup. With false, every active member receives all available tools, native file tools accept paths outside the workspace and through links without assignment checks, Bash runs without the OS sandbox, and explicit Git commits run without classification or user approval (including background commits). Ordinary host OS permissions remain, without administrator privilege. Shells retain host HOME and toolchain PATH without receiving backend credentials. Native tool schemas/truncation, input validation, timeouts, cancellation, persistent session cleanup, maintenance responsibilities and user-only configuration activation remain. Restoring true and restarting restores existing harness rules. This mode changes permissions, not configuration validation or group-chat lifecycle rules.
