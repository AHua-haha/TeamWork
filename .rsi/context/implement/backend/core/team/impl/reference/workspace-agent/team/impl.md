> Existing behavior reference inside its owning system implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

# Team implementation

Permission and approval enforcement below describes the default enabled mode. The operator's optional startup setting `harnessPermissionsEnabled: false` bypasses harness permission gates; semantic validation, user activation and runtime lifecycle rules remain in force.

## Contract

[Team](design.md) owns active member identity/configuration, file-derived validation and separate atomic idle activation. Git history belongs to the project; approved commits do not automatically change active SQL snapshots.

## Responsibilities and decomposition

TeamService owns active source/projections, workspace models, readiness and lifecycle. MemberConfigService compares current/committed files with active bundles, validates create/update/delete and constructs activation plans. [Harness](../../../../../harness/impl/reference/workspace-agent/harness/design.md) supplies file authority, ordinary control-file reads and explicit commit approval. [Lead](lead/design.md) supplies management instructions; [group chat](group-chat/design.md) and [conversation context](conversation-context/design.md) own shared/private messages. SQL owns atomic activation and durable contexts.

## Coordination and data flow

Bootstrap writes lead/context files once and stores an initial baseline and activation marker. Current inspection reads filesystem bytes, normal committed Git member files (baseline before tracking), active source bundles and read-only native Git log after activation. No private snapshot/checkpoint or periodic file materialization occurs. Deleting a file stays a proposed deletion across restart. Validation parses whole member bundles and prompt references, derives implementation authority from accepted designs and enforces immutable identity/model/design assignments for updates; responsibility, supplementary prompts and historical execute fields may change. New workers need valid assignments/workspace models; the lead cannot be deleted and retired bundle paths cannot be reused.

Committed review uses current ordinary project Git files, independently of newer pending edits. Its digest covers committed revision, activation marker, active identity/revisions, workspace models and accepted designs. idleWorkspace refuses admitted/running/finalizing work. Activation revalidates exact revision/digest and stores all member mutations plus activation marker atomically; changed/retired member shells stop afterward. User model overrides remain separate and survive activation. No review/validation/commit operation triggers work.

TeamRunner uses separate workspace publication/admission and execution queues. Runtime execution authority lasts through effects/terminal persistence; handoffs do not start recipient execution early. TeamSystem policy prepares per-run conversation context and per-call harness instructions, then publishes selected final text naturally. No checkpoint callback runs before publication, afterRun or restart recovery. Durable failed working history remains a SQL responsibility.

## Decisions and constraints

Pending approval endpoints operate directly on the pending request store, outside the tool-operation queue held by waiting Bash. Accept authorizes one exact candidate, not member activation. Old harness/history/restore/commit and configuration/commit routes are removed. configuration/current, pending/committed validation and configuration/activate remain. Changes compares current files with ordinary committed content without expensive full semantic validation. Active detail remains read-only.

## Code map

- [Team](../../../../../../../../../../backend/src/core/team/team.ts), [composition/policy](../../../../../../../../../../backend/src/core/team/team-system.ts), [runner](../../../../../../../../../../backend/src/core/team/team-runner.ts).
- [Member files/activation](../../../../../../../../../../backend/src/core/team/member-config.ts), [source format](../../../../../../../../../../backend/src/core/team/member-config-format.ts), [instructions](../../../../../../../../../../backend/src/core/team/member-instructions.ts).
- [Git reads/initial import](../../../../../../../../../../backend/src/core/workspace/workspace-git.ts), [approval](../../../../../../../../../../backend/src/core/harness/git-approval.ts), [routes](../../../../../../../../../../backend/src/api/team-routes.ts), [SQL](../../../../../../../../../../backend/src/core/team/data.ts).

## Verification

Member activation/configuration tests cover create/update/delete, immutable assignment/model identity, malformed files, separate commit/activation, newer pending edits, whole-workspace idle gates, stale reviews and atomic rollback. Inspection/HTTP tests cover ordinary file diffs/native history, active source durability and removed scope endpoints. Runtime/MySQL tests retain shared publication, waiting-run cancellation, failed private history, handoff ordering and restart recovery without Git checkpoints.

TeamRunner removes settled job/admission bookkeeping directly from the shared runtime completion promise. It retains genuine finalization exclusion without a duplicate SQL completion-read race after ordinary runtime.finished() callers return.

## Effective working subtrees

Member readiness, derived implementation mappings and configuration-review design revisions use resolveHarness, which expands working roots through DesignService.working. TeamSystem inspection uses those effective paths for harness resources while retaining the original assignment in member/configuration data. Conversation preparation uses the same resolver for each effective node README. No assignment rewriting or extra activation is introduced.

## Operator permission mode

The project environment's harnessPermissionsEnabled setting defaults to true. With false all active members can use the available native file/Bash and management tools; file workspace/assignment/role/link guards, Bash OS sandbox and explicit Git approval/classification are bypassed. Design assignments remain work guidance. Active member identity, file schemas/update constraints and separate atomic idle user activation retain their existing rules. This setting is operator-owned and requires backend restart; member files cannot select it.

## Startup permission mode

Project configuration derives RSI_HARNESS_PERMISSIONS_ENABLED only for the selected backend child. main parses the Boolean strictly (absent means true), passes it through TeamSystem to HarnessService and MemberInstructions, and keeps it immutable for the backend lifetime. Disabled assembly enables all available tools and uses the file-backed permissions-disabled prompt instead of enforcement prompts; assignments/design context still load. fileInvocation resolves native paths without authorization. Management model discovery and file validation omit the lead gate in disabled mode, while semantic validation remains. Bash skips sandbox setup and the Git broker, uses a clean host HOME/PATH environment, and keeps framing, serialization, jobs, timeout and cleanup in the same shell service. The shell registry replaces a session if execution mode differs, so a permissive shell is never reused as an enforced one. No backend credentials are copied into the host shell environment.

[Mode tests](../../../../../../../../../../backend/test/harness-permission.test.ts) cover both modes, unrestricted files/commits, unchanged validation, secret isolation, timeout and restoration. Existing sandbox/Git suites continue to verify enabled behavior.
