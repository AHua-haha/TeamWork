<!-- Task proposal; current contract is under docs/systems/ -->
# Team implementation

## Contract

[Team proposal](design.md). Preserve member identity, group cooperation, private history and read-only inspection while changing file configuration metadata, user acceptance and harness assignment. This plan is not implemented by the documentation checkpoint.

## Responsibilities and decomposition

TeamService retains lifecycle identity, readiness and accepted configuration ownership. The [lead](lead/design.md) edits proposed member content and forms assignments. The [harness](../harness/design.md) owns management/implementation/execute capabilities, lead-only member file scope and protected commits. The [group chat](../../../../../systems/workspace-agent/team/group-chat/design.md) retains admission/publication/delivery; the [runtime](../../../../../systems/agent-runtime/design.md) retains the model loop.

Member configuration coordination must associate a bundle path and exact edited bytes with backend-owned schema, identity, revision/base, validation and approval state. Capture/validation and accepted projection must preserve the previous stable configuration on failure. Configuration-change/activation coordination is explicitly deferred. This harness proposal must not silently infer an activation policy from file acceptance or the existing submission tool.

## Coordination and data flow

1. Materialize meaningful accepted member JSON/Markdown content for the lead without overwriting pending drafts or asking the lead to maintain format version/revision. Retain path/member/editing-base association in backend metadata.
2. The lead management base has .context/user/ and .team/members/ bootstrap access before an initial design exists, with user-approved management commits. Implementation access starts empty until accepted design assignment. Common file tools or authorized Bash operations edit only allowed member/design paths. Automatic harness checkpoints retain pending bytes without accepting them.
3. Capture and validate an exact bundle for user review, including prompts, model choices, names, design references and current member availability under the eventual activation rules. Approval pins those bytes/base. Invalid/stale/unapproved content retains the prior accepted configuration.
4. Derive implementation authority from the agreed accepted working/dependency designs and construct the three effective harnesses. Apply read-only precedence and exclusions. Do not maintain a second independently configurable implementationScope.
5. Defer configuration-change detection, validation-to-activation integration, activation timing and busy/running-target application to the later activation design. Keep pending edits, accepted file state and active settings conceptually distinct.
6. Feed effective configuration into TeamSystem tool/prompt assembly, admission checks and read-only inspection. Group-chat triggering and natural final acceptance remain unchanged.
7. Preserve member/workspace locking, revision conflict checks and accepted-source persistence even though agents no longer write control metadata. Coordinate those checks with Git accepted bases rather than removing stale-update protection.

## Decisions and constraints

JSON plus ordered Markdown remains the member content format. Exact new manifest placement of designScope and member/path identity is open. Supersede version-2 manifests that require agents to provide version/member revision and explicit implementation paths; migration is separate from active parsing and must preserve accepted/pending state.

The [harness plan](../harness/impl.md) replaces project/command bases, argv-only execution and dedicated scoped-history tools. Backend metadata remains a validated trusted source even when Bash metadata requests a scope. Member edit/commit authority is lead-only/user-approved, respectively.

Do not silently retain immediate submit_member_config activation, generic member-config agent commits or obsolete path grants. Submission/validation-to-activation handling is deferred. Retirement/protected lead changes still need lifecycle clarification. Existing HTTP read-only member inspection and workspace model configuration boundaries stay in place. Approval UI and detailed execute configuration are deferred.

## Code map

- [Member service](../../../../../../backend/src/team.ts): accepted content/effective config and backend identity/readiness bookkeeping.
- [Bundle format](../../../../../../backend/src/member-config-format.ts), [file workflow](../../../../../../backend/src/member-config.ts): remove agent-required version/revision, preserve exact source, introduce approved-content coordination under the chosen activation contract.
- [Lead tool adapter](../../../../../../backend/src/lead-tools.ts), [management tools](../../../../../../backend/src/member-tools.ts): reconcile validation, activation and retirement once settled.
- [Member instructions](../../../../../../backend/src/member-context.ts): teach backend-owned metadata, three harnesses, derived scopes and Bash/Git use.
- [Composition](../../../../../../backend/src/team-system.ts): reusable tools, harness prompts and unchanged group publication/lifecycle checkpoint composition.
- [Routes](../../../../../../backend/src/team-routes.ts), [database](../../../../../systems/database/impl.md): reconcile inspection/review and durable accepted metadata after the approval/activation contract is fixed.
- [Harness proposal](../harness/impl.md) owns file/command/Git authority and scope derivation.

Frontend workspace-client, TeamTab, MemberInspector and design-state consumers require follow-up inspection/schema reconciliation; their display must use the backend's derived scopes. This proposal adds no frontend write API.

## Verification

Documentation checks only are run for this proposal. Later verification must cover exact accepted source and backend-owned metadata, invalid/stale/unapproved edits, prompt capture, identity/path association, lead-only member access, user-approved acceptance, model validation, derived implementation paths, mapping changes and read-only inspection.

Replace tests expecting agent-supplied version/revision, explicit implementationScope or immediate unapproved submission when their new contracts are implemented. Migration must preserve accepted source, pending files, lifecycle identity and scope histories. Retain real SQL/runtime group-chat tests for parallel admission/refusal, context delivery, checkpoints, restart and immutable final references.
