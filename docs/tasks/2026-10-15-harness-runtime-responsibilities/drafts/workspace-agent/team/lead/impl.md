<!-- Task proposal; current contract is under docs/systems/ -->

# Lead agent implementation

## Contract

[Lead design](design.md). Preserve design collaboration, user-only design acceptance, team management and independent harness assignment.

## Responsibilities and composition

LeadService owns existing role-checked assignment configuration and uses [design parts](../../context-base/design-parts/design.md), [harness](../../harness/design.md) and [team](../design.md) contracts. Design editing, history and approval are provided by the shared harness rather than a lead-specific service. The [group chat](../group-chat/design.md) owns publication and activation.

## Coordination and data flow

The lead's default design harness grants pending `.context/user` edits. Common file tools execute in its managed worktree; commit_scope enforces the same user design-approval policy used for any member. MemberContext prompts guide choices and explaining pending changes. configure_harness validates existing references and revision-updates a member without changing its model. Assignments use shared final responses and configured designs, with no blocking private call.

## Decisions and constraints

The lead has no read_design/save_design tools and cannot directly update original context as an agent. Existing original-workspace DesignService attributed saves remain backend import/setup primitives, not a model tool. Approval records and checkpoint/semantic-commit distinction belong to the harness. Original-catalog publication of accepted harness snapshots is deferred.

## Code map

- [Assignment configuration](../../../../../backend/src/lead.ts), [tool adapter](../../../../../backend/src/lead-tools.ts)
- [Role/cooperation instructions](../../../../../backend/src/member-context.ts)
- [Harness implementation](../../harness/impl.md) owns generic tools, pending history and user commit authority.
- [Team implementation](../impl.md) owns lifecycle and management; [group chat implementation](../group-chat/impl.md) owns publication and triggering.

## Verification

[Lead tests](../../../../../backend/test/lead.test.ts) verify generic pending design writes and explicit user acceptance plus assignment/model independence. [MySQL integration](../../../../../backend/test/integration/backend.test.ts) verifies lead/worker worktrees, common file tools, semantic implementation commits, user-only design commits and retained runtime/group history.
