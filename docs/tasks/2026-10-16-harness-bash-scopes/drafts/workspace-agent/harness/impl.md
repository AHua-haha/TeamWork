<!-- Task proposal; current contract is under docs/systems/ -->
# Agent harness implementation

## Contract

[Harness proposal](design.md). Implement three bases, design-derived implementation authority, backend-owned control metadata, user-approved management commits and scoped Git through one Bash capability. This is a design/implementation plan; current canonical behavior and application code remain unchanged.

## Responsibilities and decomposition

HarnessService remains the owner of resolved member authority, effective scope, tool/prompt assembly and operation coordination. Replace the project/command split with management, implementation and execute base definitions. The bases contribute rules to reusable file and Bash capabilities rather than separate tool implementations per agent.

Management defines design and member scopes, prompts and protected acceptance. Implementation derives file access from accepted design assignments and owns its independently staged/history part. Execute defines general command policy and the execution environment. HarnessHistory continues owning worktrees, objects, checkpoints and scoped history; it must support persistent scope staging and Git reference context for ordinary Git commands.

The [team](../team/design.md) owns member identity, accepted source/metadata, readiness and activation. The [runtime](../../../../../systems/agent-runtime/design.md) owns model/tool execution and cancellation. The [context base](../../../../../systems/workspace-agent/context-base/design.md) owns original design/catalog records. The parent integration must settle which accepted design snapshot feeds mapping resolution before implementation. No new child-system boundary or execution engine is selected by this proposal.

## Coordination and data flow

1. Read accepted member content and backend-owned identity/revision/base state. Resolve working/dependency designs from the agreed accepted-design source. Validate paths before composing authority; pending file bytes cannot widen scope.
2. Derive implementation paths from working mappings and use paths from dependency mappings. Apply read-only precedence and control-file exclusions. Build management, implementation and execute definitions and their prompts.
3. Expose each reusable tool once. File operations use resolved authority. The single Bash tool carries command input and optional requested Git-scope metadata; trusted member/run identity comes from runtime.
4. For scoped Git, resolve the requested scope against current accepted authority and prepare its backend-managed index/HEAD/reference context. Check actual Git operations/paths and refuse repository retargeting or metadata that attempts to supply backend authority. General command execution must preserve management restrictions.
5. Preserve separate mutable staging per member/scope. Status/diff/log/restore/commit use the selected scope; automatic checkpoints use separate temporary indexes and checkpoint refs. Git objects can remain shared; a separate index alone does not isolate HEAD/ref updates or filesystem effects.
6. Enforce user approval on design/member commits and agent permission on implementation commits. Review pins exact scope bytes and accepted base. Use conditional ref updates and appropriate serialization so a stale actor cannot overwrite newer acceptance or another scope.
7. Coordinate approved member bytes with team validation and activation through the eventual chosen contract. Do not retain immediate unapproved submit activation as a compatibility path. Preserve invalid/stale drafts and previous accepted configuration.
8. Keep run-end/failure/cancellation/restart checkpoints after outstanding effects settle and before terminal success claims. Group shared final publication remains separate from file/config acceptance.

## Decisions and constraints

The interface change removes commit_scope, scope_history, restore_scope and run_command from agent assembly when Bash/Git behavior is implemented. It must not expose old and new authority models in parallel merely to preserve obsolete behavior. Existing required history/failure guarantees stay intact.

The Bash metadata example {git: {scope: "implementation"}} is illustrative. One scope per invocation is a proposed simple default, not a finalized schema. Exact shell behavior, allowed Git commands/options, scope-less Git handling and command policy composition need to be specified. A managed Git executable/backend service is a possible internal mechanism; PATH routing alone is insufficient. No claim that regex checking or environment variables confine arbitrary Bash is made.

Backend metadata must associate editable member paths with accepted member identity and editing bases without requiring agents to write version/revision fields. The exact bundle schema, activation operation, busy/self/retirement behavior and approval transport remain open.

Migration must reconcile the accepted-design source and existing explicit assignments, worktree files, staging/history refs and accepted source bundles. Do not silently restore the former mapping-derived implementation logic without checking the new authority/acceptance model. Preserve original checkout/index and unrelated changes. The timing of accepted mapping changes for active agents is unresolved.

## Code map

Existing owners to revise:

- [Bases](../../../../../../backend/src/harness-bases.ts): replace two purpose definitions with three and make member-config commits user-controlled.
- [Harness config](../../../../../../backend/src/harness-config.ts), [resolution and integration](../../../../../../backend/src/harness.ts): accepted design assignment validation and derived implementation authority.
- [Tool adapters](../../../../../../backend/src/harness-tools.ts), [command lifecycle](../../../../../../backend/src/harness-command.ts): replace argv-only command and dedicated history tools with reusable Bash execution plus scoped metadata/context checks. The concrete execution mechanism is still open.
- [File access](../../../../../../backend/src/member-files.ts): preserve file boundaries and align them with execution authority.
- [Scoped history](../../../../../../backend/src/harness-history.ts): independent staging/ref context, checkpoint indexes and protected acceptance.
- [Team policy assembly](../../../../../../backend/src/team-system.ts), [member instructions](../../../../../../backend/src/member-context.ts): assemble new bases, common tools and ordinary Git instructions.
- [Team implementation proposal](../team/impl.md): owns member bundle/control metadata and approval/activation coordination.
- [Design service](../../../../../../backend/src/design.ts): resolve the agreed accepted-design view; canonical source integration remains an explicit design item.

Follow-up changes to inspection, storage and review routes must use the same effective authority; frontend callers must not recompute scope independently.

## Verification

This checkpoint verifies documentation only. Implementation acceptance must include:

- Three-base tool/prompt assembly, common Bash registration and removal of superseded agent tools.
- Real scoped Git status/diff/add/log/restore/commit and independent index/reference state across scopes and agents.
- Protected design/member commits, exact reviewed bytes/base, approval failure and unaffected implementation history/staging.
- Worker denial for member files through file tools, Bash and scoped Git metadata; attempts to redirect Git context or use nested scripts must obey the chosen execution contract.
- Accepted mapping derivation, dependency overlap, root mappings/control exclusions, pending mapping edits and invalid/missing designs.
- Stable accepted member configuration after invalid/stale/unapproved drafts; backend-owned metadata through creation and updates.
- Run-end checkpoints that preserve staging, cancellation effect ordering, restart recovery and refusal of success after checkpoint failure.
- Migration with existing accepted/pending source and scoped histories; no silent widening or loss of unrelated files.
- Reconciled frontend inspection, runtime/SQL contracts and group-chat regression behavior.

Existing harness-history, member-files, harness, member-config, team-context, lead, HTTP and MySQL integration suites are the starting locations. Tests asserting explicit independent implementation assignments or immediate unapproved submission require replacement when the new behavior is implemented.
