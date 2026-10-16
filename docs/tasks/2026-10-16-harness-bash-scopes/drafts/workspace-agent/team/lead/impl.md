<!-- Task proposal; current contract is under docs/systems/ -->
# Lead agent implementation

## Contract

[Lead proposal](design.md). Preserve design collaboration, shared mention assignment and stable member configuration while moving member edits to lead-only/user-approved management scope with backend-owned metadata. This checkpoint persists a plan only.

## Responsibilities and decomposition

The [team](../design.md) owns accepted member identity/content and eventual validation/acceptance/activation coordination. The [harness](../../harness/design.md) owns three purpose bases, common file/Bash capability, management scope restrictions and Git approval policy. The [group chat](../../../../../../systems/workspace-agent/team/group-chat/design.md) keeps publication and trigger admission. Member role prompts explain the composed workflow; no lead-specific model loop or special file editor is introduced.

## Coordination and data flow

Materialize editable accepted content without overwriting drafts and without requiring agent version/revision bookkeeping. Backend retains bundle-to-member association and editing base. Lead common file operations create pending design/member edits. Bash scoped metadata selects an authorized Git context; the harness enforces path and commit rules.

User review must pin exact proposed member JSON and referenced prompt bytes plus their accepted base. Member-configuration change/activation integration, including validation-to-activation timing, is deferred to a later design step. Pending edits, automatic checkpoints, stale reviews and validation failures preserve previous accepted state. Lead assignments refer to accepted members and designs through existing final group mentions.

Runtime assembly includes management/implementation/execute prompts and tools. Implementation access comes from accepted design mappings. Lead bootstrap grants .context/user/ and .team/members/ maintenance immediately, with user-approved management commits and no implementation authority before accepted design assignment. Configuration-change/activation handling, including busy/running-target updates, is deferred. Protected identity/self changes, retirement and accepted mapping-source integration remain open details.

## Decisions and constraints

Supersede manifest examples requiring version/revision, harnesses.project implementation paths, dedicated history tools and run_command. Retain JSON/Markdown content and fixed base rules. The Bash metadata shape is illustrative; exact schemas and command support remain to be decided.

The future role of submit_member_config is open. It must not remain an unapproved activation shortcut while member commits require user acceptance. Likewise, the retirement tool's relationship to approved lifecycle content requires reconciliation. Backend-owned optimistic metadata and exact accepted-source persistence must remain effective even though agents no longer manage them.

## Code map

- [Lead adapter](../../../../../../../backend/src/lead-tools.ts): reconcile validation/activation after approval is specified.
- [Role/cooperation instructions](../../../../../../../backend/src/member-context.ts): current manifest, tool and scope instructions require revision.
- [Team implementation proposal](../impl.md): owns backend member metadata, accepted source, validation and activation.
- [Harness implementation proposal](../../harness/impl.md): owns file/Bash/Git authority, approval, checkpoints and derived implementation scopes.
- [Member tools](../../../../../../../backend/src/member-tools.ts): model discovery and retirement need consistency with the final lifecycle contract.

## Verification

Documentation-only checks apply at this checkpoint. Later tests must prove lead-only member file access through common tools and Bash, protected design/member commits, backend-owned control metadata, exact reviewed prompt bytes, stale/invalid preservation, accepted design-derived implementation authority and correct prompt/tool assembly. Retain group chat, model readiness, private-history and lifecycle regression tests. Full activation/self-update/retirement tests depend on the remaining design decisions.

## Unified streaming and model completion

The lead uses ordinary assistant text for its final report, question or assignment. Its tools cover project work and member management, without a special completion tool. Normal team completion/publication rules apply, and only accepted final mentions activate peers.
