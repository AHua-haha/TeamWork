<!-- Task proposal; current contract is under docs/systems/ -->
# Harness

## Purpose and boundary

A harness defines tools, permitted resources and maintenance rules for one purpose. Runtime assembles its tools/prompts and runs the agent. Three fixed bases serve design/member management, implementation and execution. All members operate directly on the registered shared workspace; existing single-member execution ordering remains.

The agent manages ordinary project Git history. Harness responsibility for Git is a permission decision on explicit git commit commands submitted through the Bash tool. It does not manage Git scopes, private repositories, separate indexes/references, semantic history or automatic checkpoints.

## Inputs and preconditions

Member designScope has working and dependency design-node metadata references. Implementation context and project implementation paths derive from accepted design mappings; agents cannot configure independent source authority. Pending design edits grant no new file-tool authority.

Pi read/ls/grep/find/write/edit retain default operations, schemas, content/details and truncation. Invocation checks retain workspace path boundaries; write/edit retain working/dependency assignment checks. Management tools remain lead-only. Existing Bash input, persistent member shells, stdout/stderr behavior, timeouts, background jobs, lifecycle and sandbox resource policy remain, except obsolete Git-scope selection is removed.

An explicit Git commit request is evaluated against the actual contents it would commit, not every dirty file. Options changing the candidate contents, such as -a or explicit paths, must be accounted for. Exact supported explicit command forms are an implementation follow-up; the check must not silently inspect a different candidate. Commit requests use ordinary project Git; no git.scope, scope IDs or agent-supplied approval authority are required.

## Outputs and observable effects

### Purpose bases and file authority

Management provides lead-only design/member file edits, model discovery, member-file validation and maintenance prompts. Implementation provides working-node implementation-context and accepted mapped-source edits. Execute provides persistent Bash and web tools. Required base prompts remain backend-owned Markdown files, assembled into the system prompt with member instructions. Tools are reusable and deduplicated; prompt changes cannot grant authority.

Permissions remain organized as working scope and dependencies, each with design context, implementation context and implementation. Lead can read/edit all design context and member files; other members read/follow designs without file-tool edits. Both roles edit exact working implementation context and mapped implementation files. Dependency implementation/context is read-only for file tools, with read-only precedence on overlaps. Lead design-management permission grants no extra implementation access. Read tools can inspect the workspace.

Bash retains system reads, whole-workspace and workspace-owned temporary writes, networking and no executable allowlist. Existing OS permissions apply. Bash assignment boundaries are instructions rather than filesystem restrictions; this commit gate does not become a complete security boundary.

### Explicit commit decision

| Actual candidate contents | Decision |
| --- | --- |
| Only implementation context under .rsi/context/implement and/or project implementation paths from design mappings | Execute directly |
| Design and/or member files mixed with implementation context or project implementation files | Refuse; tell the agent to split protected and implementation changes into separate commits |
| Only design under .rsi/context/design and/or member files under .rsi/members | Pause the Bash tool for user approval |

Design and member changes can share one approval-required commit. Dirty files excluded from the candidate do not affect the decision. Other Git operations use ordinary Git behavior; no backend scope staging, private accepted branch or scope restore is supplied. The agent stages, commits, inspects and restores through Git. Run success, failure, cancellation and interruption recovery create no automatic file checkpoint.

### Approval interaction

The pending tool call is associated with its workspace/member/run and the exact proposed command, repository and commit contents. User Accept executes only that reviewed candidate. Changed contents invalidate approval and require another review. Deny skips the commit and returns refusal as the tool result. Send feedback skips the commit and returns the user's text as the tool result so the agent can revise. The agent resumes after the tool resolves; opening review is not a decision. The existing timeout/cancellation interaction while awaiting user input must be specified during implementation rather than treating user deliberation as an ordinary command execution timeout.

Frontend offers a compact approval input above the composer and a Review action opening the right panel. Diff content belongs in that panel, not the popup. Mixed protected/implementation commits are refused directly without an approval popup.

User-authorized Git commit and member activation remain separate. Committing member files does not activate them. Existing whole-team-idle, validation and atomic activation guarantees remain; active member snapshots stay in backend durable storage. Removing private Git history requires replacing its accepted-design/member-source dependencies with ordinary committed project contents and the existing backend projections; it must not recreate another scope history system.

### Workspace storage

.rsi/context/design contains design Markdown and metadata. .rsi/context/implement contains implementation context, including each assigned node's impl/README.md result summary, file lookup and automatic retrieval configuration. .rsi/members contains member manifests and prompt files. These structures retain their existing meaning.

No mandatory .rsi/harness directory is needed for this design. Ordinary history/index/objects belong to the project .git. Backend approval records are control state, not another Git history; their physical storage/API are implementation details to settle. Persistent shell homes, caches and temporary files remain in the existing backend-session workspace temporary area outside .rsi. Rule prompt files stay in the backend source, not copied into .rsi/harness.

Legacy .rsi/harness/repository.git, scoped staging/indexes, run/checkpoint/accepted-design refs and obsolete member worktrees are no longer used by the target. Existing member materialization markers have a separate initialization purpose and require replacement before retiring old storage; deleting an intentionally removed member file must not silently recreate it. Migration must preserve current project/context/member files and required accepted/active data before retiring old state. This design discussion does not authorize deleting existing workspace metadata.

## Failure behavior

Mixed commits return an actionable tool refusal without committing. Deny/feedback skip execution and return control to the agent. Approval cannot authorize changed contents. Git execution errors are ordinary tool results; do not claim a commit succeeded when Git failed. Existing validation, sandbox and member activation failures preserve their guarantees.

Paths outside the three recognized content categories, cross-category renames, unusual repository layouts, exact explicit syntax and approval restart/cancellation behavior remain implementation design follow-ups. No permissive default is agreed for unknown paths.

## Guarantees and limits

Detection covers explicit git commit commands submitted in Bash requests. Indirect commits inside scripts/programs are outside this prototype's detection contract. This is a workflow guard, not comprehensive Git or filesystem enforcement. Shared files remain visible immediately; no member checkout synchronization is introduced. Completed SQL chat history and retained failed working history are unrelated to Git checkpoints and remain durable.

## Acceptance examples

1. Stage implementation files and implementation context, leaving a dirty design unstaged: commit directly; leave the design pending.
2. Stage design and implementation together: refuse and request separate commits; do not alter the staged files.
3. Stage only design and member files: show approval input; Review opens the right-panel diff; Accept executes that reviewed commit.
4. Deny or send feedback: no commit occurs; the agent receives the decision/text and can continue.
5. Modify the candidate after review: an earlier Accept cannot commit the new candidate.
6. Finish or fail a run: preserve ordinary pending files without harness checkpoints or a second Git history.
