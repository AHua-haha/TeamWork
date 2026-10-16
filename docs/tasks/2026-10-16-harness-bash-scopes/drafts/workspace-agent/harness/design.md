<!-- Task proposal; current contract is under docs/systems/ -->
# Harness

## Purpose and boundary

A harness defines an agent's permitted scope, capabilities, operating rules and context-maintenance instructions for a purpose. Reusable tools serve every agent; runtime assembles their harness-derived environment and runs the model loop. Members retain separate worktrees and independent scoped history.

The proposed bases are management, implementation and execute. Management owns design and member maintenance. Implementation owns implementation access derived from accepted designs. Execute owns general command execution. This is a proposed contract, not a claim that these bases or the Bash replacement are implemented.

## Inputs and preconditions

The member's editable harness assignment contains designScope with working and dependencies lists. It does not contain independent implementation paths/usePaths. Working/dependency references must resolve to accepted user designs, be disjoint and satisfy safe-path constraints. Identity, model selection, responsibility and supplementary Markdown instructions remain member configuration content.

Design and member configuration files are editable pending state. Backend owns schema-version handling, member identity association, accepted revisions/bases and approval metadata; agents do not maintain version/revision fields in member manifests. Among agents only the lead may read or edit member configuration paths.

One reusable Bash tool accepts shell input and may carry metadata selecting a requested Git scope. For example, command "git status && git diff" with metadata {git: {scope: "design"}} illustrates the intent. Exact field names and supported command/options are not frozen. Metadata requests context; it does not confer permissions, approval or arbitrary repository/index/ref selection.

Existing exact-command/executable allowances are evidence of the baseline. The execute harness's detailed Bash-rule schema and enforcement mechanism remain open. No broader agent-facing execution configuration is agreed by this draft.

## Outputs and observable effects

### Three purpose harnesses

| Harness | Responsibility | Authority |
| --- | --- | --- |
| Management | Maintain design and member files; supply maintenance and allowed scoped-Git instructions | Working design edit, dependency design read, lead-only member access; user-approved design/member commits |
| Implementation | Read and edit the implementation corresponding to accepted assigned designs | Writable working-design mappings and read-only dependency mappings; agent-authorized implementation commits |
| Execute | Control general command execution and its environment | Allowed execution within applicable file boundaries; no override of management or Git acceptance policy |

Management can supply its restricted Git capability through the common Bash tool without enabling general commands. Generic capabilities are assembled once even when several harnesses use them. A purpose base fixes its tools, mandatory prompts and commit policy; assignment files cannot replace those rules. Supplementary member prompts are assembled with the base prompts.

### Design-derived implementation authority

Working-design implementation mappings produce writable implementation paths. Dependency-design mappings produce read-only use paths. Deduplicate and validate the effective paths. Read-only dependencies take precedence on overlaps. Git metadata and .context/.team control files remain excluded from implementation ownership, including when a mapping names the project root. A working design's pending mapping edits do not grant additional access.

For example, working user/backend.json mapping backend/ and dependency user/contracts.json mapping shared/contracts/ provide editable backend/ and read-only shared/contracts/. Accepted mapping changes can alter effective authority. The authoritative accepted-design source, integration into that source and application timing for active runs are explicitly unresolved.

### File maintenance and scoped Git through Bash

Common file tools read/create/edit files within each harness scope. Member configuration JSON and referenced Markdown use the same pending file, checkpoint, review and commit model as design. Only the lead can access member paths among agents. Committing member files requires user approval.

Agents use ordinary Git commands through the unified Bash capability for status, diff, staging, history, restore and semantic commit. Dedicated commit_scope, scope_history and restore_scope agent tools and argv-only run_command are replaced by that interface. Metadata selects a scope and backend supplies the authorized Git environment. Actual Git operations, including descendant invocations, must obey scope and approval rules. Selecting a different scope cannot authorize an operation forbidden to that agent.

Independent scope indexes/reference context preserve staging and history. Restoring one scope preserves other scopes and does not implicitly change accepted state. Implementation commits remain agent-authorized. Design and member-config scopes require user approval. Scope acceptance pins exact proposed bytes and expected accepted base; stale reviews or subsequent edits cannot authorize different content. Design and member configuration remain independently acceptable.

### Checkpoints, acceptance and activation

The harness automatically checkpoints finished runs and before successful final group publication, after tool/policy effects settle. Interrupted-run recovery preserves pending work before terminal recovery. Automatic checkpoints use their own indexes/references, preserve agent staging, and never imply user acceptance.

Configuration validation/acceptance/activation ordering remains open. Pending or invalid configuration cannot replace the prior accepted configuration, and a Git checkpoint/commit must not be silently treated as activation until that contract is settled. Exact user-facing review endpoints and UI are not selected here.

Each member retains its own worktree, pending files and scoped histories. Shared objects and accepted references remain backend-owned. No new automatic merge into the original checkout or peer worktrees is promised.

## Failure behavior

Out-of-scope file/Git operations, worker access to member paths, unknown scope metadata and attempts to supply trusted approval state are refused. Invalid/unresolved designs and unsafe mappings do not grant implementation authority. A command exceeding its allowed context is not permitted merely because it runs inside a shell script.

Unapproved design/member commits remain pending. Stale accepted bases or reviewed bytes are refused explicitly. Invalid configuration retains the prior accepted state. Execution cancellation and completed effects remain observable; history/checkpoint failure cannot be presented as successful acceptance. Exact failure transport and approval continuation behavior remain to be designed.

## Guarantees and limits

The agreed target has three purpose harnesses, one Bash execution interface, backend-owned control metadata, lead-only member-path access, user-only design/member acceptance and implementation authority derived from accepted design mappings. File tools and Bash must preserve these boundaries; execution permission cannot independently expand protected file/Git authority.

Metadata labels, PATH wrappers and command-string inspection alone do not establish enforcement against arbitrary subprocesses. The concrete mediation/isolation mechanism must be chosen and verified before this guarantee is promoted. This proposal does not claim an implemented sandbox.

Automatic context-maintenance algorithms, richer execution-rule configuration, approval UI, exact manifest/Bash schemas, active-run mapping refresh and approved-config activation remain outside the settled detail. Required existing stable history, per-member worktree, independent scope and group-publication guarantees remain.

## Acceptance examples

1. The lead edits a member JSON file and its prompt with common file tools. The changes are pending and checkpointed. An agent-originated Git commit cannot accept them; the user reviews exact bytes before acceptance.
2. A worker requests the member-config Git scope in Bash metadata. The harness refuses it; choosing a scope does not grant lead authority.
3. A member assigned working backend design and dependency contract design edits backend implementation but cannot change contract implementation. A dependency overlap remains read-only.
4. An agent edits an implementation mapping in pending design JSON to include another directory. Its implementation authority remains based on accepted design until the change is accepted and applied under the eventual refresh policy.
5. Bash with implementation Git metadata runs ordinary status/add/commit commands within that scope. It cannot stage design or member configuration, nor choose arbitrary internal refs/indexes through metadata or command options.
6. An implementation commit advances only implementation history. Pending design/member edits and staging remain independent.
7. Automatic run-end checkpointing preserves pending and staged changes without accepting protected scopes or resetting the agent's index.
8. A nested script attempts a forbidden Git operation. Harness enforcement must still apply; accepting its outer Bash invocation is insufficient.
9. Configuration validation fails or the accepted editing base has changed. Previous active configuration remains available and the pending edits are retained.
