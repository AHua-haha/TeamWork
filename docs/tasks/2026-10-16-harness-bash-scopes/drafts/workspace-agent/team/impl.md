<!-- Task proposal; current contract is under docs/systems/ -->
# Team implementation

## Contract

[Team](design.md) preserves durable cooperation/private history and read-only member inspection while using backend-owned metadata, user-approved member files and design-derived implementation authority. Configuration change/activation is deferred.

## Responsibilities and decomposition

TeamService owns active identity, stable fields/source, model readiness and lifecycle revision checks. [Lead](lead/design.md) owns collaboration instructions, [harness](../harness/design.md) owns authority/worktrees/Git/Bash, and [group chat](../../../../../systems/workspace-agent/team/group-chat/design.md) owns admission/publication/delivery. [Runtime](../../../../../systems/agent-runtime/design.md) owns model execution; [database](../../../../../systems/database/design.md) persists stable members/chat/history.

MemberConfigService materializes missing accepted JSON/Markdown for the lead and returns stable active bundles. It has no submit/activate operation. Structured agent lifecycle tools are absent; list_models remains lead-only. Internal backend lifecycle methods support initialization and existing callers without adding HTTP member writes.

## Coordination and data flow

1. Workspace creation inserts its default-configured lead transactionally. Startup initializes missing leads and migrates active legacy member sources once.
2. Generated manifests contain name/role/responsibility/settings/promptFiles/designScope. Backend envelope formatVersion=3, path, digest, attribution/time and member record revision/ID remain outside editable bytes. Source conversion retains exact previous bundle and every prompt byte; retired records remain historical. Existing drafts are never overwritten.
3. Lead policy materializes missing stable source files under its management worktree, using common file access. Edits and user-approved scope commits remain separate from stable active member settings. No configuration detection, approved-file validation-to-activation handler or automatic application to running members is implemented.
4. TeamService inspection/readiness resolves accepted design mappings through the harness resolver. Stored assignment omits implementationScope; MemberView includes derived paths/usePaths for caller inspection. Invalid/missing designs create readiness issues and no permissive fallback.
5. TeamSystem.inspect returns member, stable configuration and three inspectHarnesses definitions without opening harness Git. Existing member-write routes remain absent; review/acceptance/history/restore endpoints are retained.
6. Policy buildRequest assembles unique harness tools plus lead list_models, current member/roster instructions, base maintenance prompts and accepted member Markdown. shouldContinue preserves natural completion selection and atomic final publication; afterRun checkpoints settled effects, including failure/cancellation/recovery.
7. Existing internal updates retain revision/idle checks. Comparing assignment changes ignores the derived inspection-only implementationScope. Group admission verifies prepared revisions under database locking. No new configuration activation contract is inferred from these safeguards.

## Decisions and constraints

The source bundle represents the last stable active configuration; accepted Git member files are independently retained for later activation design. Even user file acceptance cannot silently create, update or retire a member. Removing submit_member_config/retire_member agent shortcuts avoids an unapproved alternate lifecycle path. Backend create/update/retire methods remain available to trusted composition/tests; frontend remains inspection-only.

Legacy implementationScope is stripped during startup. Accepted settings/identity/commands are preserved; effective authority now derives from accepted design mappings. Historical source is retained in previous, and existing worktree/history behavior belongs to the harness. Model defaults/choices and provider validity retain their current boundaries. No SQL schema change is required: member JSON already stores opaque versioned configuration data.

## Code map

- [Team records/readiness/migration](../../../../../../backend/src/team.ts), [composition](../../../../../../backend/src/team-system.ts).
- [Member content format](../../../../../../backend/src/member-config-format.ts), [stable source/materialization](../../../../../../backend/src/member-config.ts), [instructions](../../../../../../backend/src/member-context.ts), [model tool](../../../../../../backend/src/member-tools.ts).
- [Team routes](../../../../../../backend/src/team-routes.ts), [runner](../../../../../../backend/src/team-runner.ts), [harness implementation](../harness/impl.md).
- Frontend MemberInspector/TeamTab consume three fixed bases and backend-derived paths; Bash working-history summaries display command text. No frontend scope recomputation/member-write API is added.

## Verification

[Member configuration tests](../../../../../../backend/test/member-config.test.ts) verify clean manifests, exact stable bytes, invalid pending preservation, restart/materialization, legacy migration and admission revision conflicts. [Team tests](../../../../../../backend/test/team.test.ts), [context](../../../../../../backend/test/team-context.test.ts) and [HTTP](../../../../../../backend/test/team-routes.test.ts) cover identity/readiness, unique tools, fixed bases and read-only projection. [Harness](../../../../../../backend/test/harness.test.ts) covers real Git/sandbox authority and user approval. [SQL/runtime integration](../../../../../../backend/test/integration/backend.test.ts) verifies real tools, checkpoint ordering and group behavior. The independent existing frontend/client tests and build check caller compatibility.
