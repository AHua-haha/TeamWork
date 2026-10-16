<!-- Task proposal; current contract is under docs/systems/ -->
# Lead agent

## Purpose and boundary

The lead helps the user maintain project design, maintain member configuration, form the team and assign work through shared mentions. It uses reusable tools assembled from management, implementation and execute harnesses. Design and member acceptance belong to the user; runtime owns execution and backend owns control metadata. This draft records the agreed direction and explicitly leaves activation details open.

## Inputs and preconditions

User workspace model choices/default and shared group input remain inputs. New members obtain omitted model choices/options from the workspace default and may select valid workspace choices. Member JSON and referenced Markdown hold meaningful configuration content; backend maintains format version, member/path identity and accepted revision/base metadata.

The lead's management harness permits pending design and member file editing. Among agents only the lead can read/edit member paths. Design and member semantic commits require user approval. The member's only configurable harness assignment is its working/dependency design scope; backend derives implementation access from accepted design mappings. Fixed base prompts/tools/commit rules cannot be replaced in member files.

Bash is the unified shell/Git capability. Scoped Git metadata requests an authorized context while backend supplies trusted metadata. Detailed manifest/Bash schemas and protected self-change rules remain open. The lead management base grants access to maintain .context/user/ design files and .team/members/ configuration directories from workspace initialization, even before any design exists. Design dependencies remain read-only and both management parts retain user-approved commits. Implementation access starts empty and derives only from accepted assigned designs. Configuration-change/activation handling and application to active members are deferred.

## Outputs and observable effects

- The lead discusses unsettled design choices and waits for user decisions before dependent work. It explains pending design/member edits and requests review of exact proposed content.
- Common file tools edit the permitted files. Ordinary Git commands through Bash inspect/stage/restore/commit the selected scope under harness rules. Dedicated commit_scope/scope_history/restore_scope and run_command agent tools are superseded.
- The harness automatically checkpoints runs without accepting protected files or resetting staged changes. Implementation semantic commits remain agent-authorized. Design and member configuration commits require user approval.
- Pending member edits and failed validation preserve the prior accepted configuration. The configuration-change/activation sequence and role of submit_member_config are deferred; retirement workflow remains to be settled; a Git commit is not implicitly an activation operation in this draft.
- Assignments and reports remain ordinary accepted group final responses with mentions. Private work is not shared with peers. Configuration acceptance, file acceptance and group publication remain distinct effects.

## Failure behavior

Invalid content, unavailable designs/models, out-of-scope file/Git requests, unapproved design/member commits or stale review/base state fail explicitly and preserve accepted configuration. Backend metadata and approval cannot be supplied as trusted facts by the agent. Group admission/refusal and checkpoint/storage failure behavior remain required. Exact activation failures and continuation transport are open.

## Guarantees and limits

Member paths remain lead-only among agents, and design/member commits remain user-approved. Lead identity, schema/revision bookkeeping and acceptance authority are backend-owned. Implementation authority derives from accepted design assignments with read-only dependency precedence. Tools are common capabilities, and base policy is fixed.

This proposal does not select a new approval UI, detailed execution policy schema, member lifecycle activation operation, sandbox engine or active-run scope refresh. Lead bootstrap scope is selected as described above. Protected self/retirement changes remain to be reconciled; configuration-change/activation handling is explicitly deferred. Existing group chat and final response presentation remain unchanged.

## Acceptance examples

1. A workspace starts without a design. Lead management access permits pending design/member maintenance while implementation access stays empty until an accepted design assignment exists.
2. The lead edits member JSON and a Markdown prompt without carrying version/revision fields. Pending changes are checkpointed. User approval is needed before those configuration files can be accepted.
3. The lead assigns working backend and dependency contract designs. Backend receives writable backend implementation and read-only contract implementation from accepted mappings without separate implementation path configuration.
4. The lead stages implementation and pending design independently through Bash/Git. Its implementation commit does not accept design or member files or reset their staging.
5. A worker requests member-config Git metadata or tries to read a member prompt path. The harness refuses access.
6. A design mapping is edited only in the lead's pending worktree. Worker authority remains based on accepted mappings; active-run refresh timing is resolved by a later design decision.
7. Validation or user review becomes stale. The previous accepted member state remains intact and the pending changes stay available.
## File configuration workflow

Member files continue to use JSON plus ordered Markdown prompt references. Their configurable harness assignment is designScope only; implementation scope is backend-derived. The lead edits through management file access and uses ordinary scope Git commands through Bash. User approval is required for member-file semantic commits. Backend maintains member identity/path association and schema/revision/base metadata.

The existing immediate submit_member_config flow must be redesigned in relation to validation, user acceptance and activation. This discussion does not decide whether that tool remains, which operation activates accepted files, how creation is represented, or how protected self/retirement updates proceed. Configuration-change/activation handling is reserved for a later design step. The current harness work must not infer or add that lifecycle behavior.

## Workspace model selection

Workspace model choices/default remain the source for initialization and selectable member models. Existing selected models and per-model options must be preserved under the eventual validated update contract. Provider/model validity is checked before activation. The frontend retains read-only member inspection and the existing workspace model configuration boundary.

## Unified streaming and model completion

The lead uses ordinary assistant text for its final report, question or assignment. Its tools cover project work and member management, without a special completion tool. Normal team completion/publication rules apply, and only accepted final mentions activate peers.
