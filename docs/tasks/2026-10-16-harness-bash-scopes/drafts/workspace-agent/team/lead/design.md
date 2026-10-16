<!-- Task proposal; current contract is under docs/systems/ -->
# Lead agent

## Purpose and boundary

The lead collaborates with the user on design and member configuration and assigns accepted members through shared group mentions. Common tools come from management, implementation and execute harnesses. User acceptance, file acceptance and active member configuration are separate. Member change/activation workflow remains deferred.

## Inputs and preconditions

User input is the workspace group chat and its workspace model choices/default. Member JSON contains name, role, responsibility, settings, promptFiles and designScope, with ordered Markdown instruction files. Backend owns schema version, identity association, revisions and accepted bases. Agents maintain no control bookkeeping in these files.

The management base grants lead-only access to .team/members and design maintenance under .context/user immediately, before initial design exists. Dependencies remain read-only. Implementation access starts empty and derives from accepted assigned design mappings. General commands use backend-controlled execute allowances. Base policies/tools/prompts cannot be overridden by member files.

## Outputs and observable effects

The lead offers concrete choices for unsettled decisions, waits for the user's choice before dependent work, and explains pending design/member changes. Common ls/read/write/edit tools operate in its management/implementation scope. One bash tool accepts command and optional metadata.git.scope for authorized Git operations. list_models reads workspace choices.

Working design/member edits are pending. Automatic checkpoints retain them without acceptance or changing Git staging. Implementation semantic commits are agent-authorized; design/member-config commits require exact user review and acceptance through the existing harness review API. Git metadata cannot supply user approval.

Final ordinary assistant text is offered for group acceptance; mentions assign currently active members. Private tools/commentary stay private. No special completion tool exists. Configuration creation/update/activation/retirement through files is deferred; submit_member_config, retire_member and dedicated Git tools are absent. Editing or committing a member draft does not change the roster or active settings.

## Failure behavior

Out-of-scope file/Git requests, protected commits without user approval, unsafe designs/mappings, stale reviews/bases or unavailable execution isolation fail explicitly. Pending edits remain available and stable active member source remains unchanged. Group busy/readiness/mention-limit refusals preserve private feedback and trigger nobody. Storage/checkpoint failures cannot claim successful publication.

## Guarantees and limits

Only the lead accesses member files among agents. Design/member acceptance remains user-only. Runtime owns the model loop; reusable tools and harness policies determine capabilities. Workspace model defaults/choices preserve current selections and initialize backend-created members independently of lead settings.

No new member activation/self-update/retirement policy, approval UI, active-run update protocol, network allowance or automatic context-maintenance algorithm is introduced. Accepted design snapshots feed semantic reads/scope resolution but are not automatically copied to original checkout/peer worktrees. Lifecycle and peer refresh details remain future work.

## Acceptance examples

1. An empty workspace lead creates pending design/member files but cannot edit implementation until accepted designs are assigned.
2. The lead edits a member manifest and prompt without version/revision fields; user file acceptance does not activate it.
3. A member assigned a working backend design/dependency contract gets writable backend and read-only contract implementation from accepted mappings.
4. Lead implementation commits leave staged design/member changes pending. The agent cannot self-approve protected scopes.
5. A worker requests member-config scope: refuse. A lead final mentioning that worker assigns work through group admission.
6. User review becomes stale after another edit: acceptance refuses rather than authorizing different bytes.
