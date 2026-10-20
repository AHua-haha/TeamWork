# Team implementation

## Contract

[Team](design.md) owns active member identity/configuration, file-derived validation and separate atomic idle activation. Git history belongs to the project; approved commits do not automatically change active SQL snapshots.

## Responsibilities and decomposition

TeamService owns active source/projections, workspace models, readiness and lifecycle. MemberConfigService compares current/committed files with active bundles, validates create/update/delete and constructs activation plans. [Harness](../harness/design.md) supplies file authority, ordinary control-file reads and explicit commit approval. [Lead](lead/design.md) supplies management instructions; [group chat](group-chat/design.md) and [conversation context](conversation-context/design.md) own shared/private messages. SQL owns atomic activation and durable contexts.

## Coordination and data flow

Bootstrap writes lead/context files once and stores an initial baseline and activation marker. Current inspection reads filesystem bytes, normal committed Git member files (baseline before tracking), active source bundles and read-only native Git log after activation. No private snapshot/checkpoint or periodic file materialization occurs. Deleting a file stays a proposed deletion across restart. Validation parses whole member bundles and prompt references, derives implementation authority from accepted designs and enforces immutable identity/model/design assignments for updates; responsibility, supplementary prompts and historical execute fields may change. New workers need valid assignments/workspace models; the lead cannot be deleted and retired bundle paths cannot be reused.

Committed review uses current ordinary project Git files, independently of newer pending edits. Its digest covers committed revision, activation marker, active identity/revisions, workspace models and accepted designs. idleWorkspace refuses admitted/running/finalizing work. Activation revalidates exact revision/digest and stores all member mutations plus activation marker atomically; changed/retired member shells stop afterward. User model overrides remain separate and survive activation. No review/validation/commit operation triggers work.

TeamRunner uses separate workspace publication/admission and execution queues. Runtime execution authority lasts through effects/terminal persistence; handoffs do not start recipient execution early. TeamSystem policy prepares per-run conversation context and per-call harness instructions, then publishes selected final text naturally. No checkpoint callback runs before publication, afterRun or restart recovery. Durable failed working history remains a SQL responsibility.

## Decisions and constraints

Pending approval endpoints operate directly on the pending request store, outside the tool-operation queue held by waiting Bash. Accept authorizes one exact candidate, not member activation. Old harness/history/restore/commit and configuration/commit routes are removed. configuration/current, pending/committed validation and configuration/activate remain. Changes compares current files with ordinary committed content without expensive full semantic validation. Active detail remains read-only.

## Code map

- [Team](../../../../backend/src/team.ts), [composition/policy](../../../../backend/src/team-system.ts), [runner](../../../../backend/src/team-runner.ts).
- [Member files/activation](../../../../backend/src/member-config.ts), [source format](../../../../backend/src/member-config-format.ts), [instructions](../../../../backend/src/member-instructions.ts).
- [Git reads/initial import](../../../../backend/src/workspace-git.ts), [approval](../../../../backend/src/git-approval.ts), [routes](../../../../backend/src/team-routes.ts), [SQL](../../../../backend/src/database.ts).

## Verification

Member activation/configuration tests cover create/update/delete, immutable assignment/model identity, malformed files, separate commit/activation, newer pending edits, whole-workspace idle gates, stale reviews and atomic rollback. Inspection/HTTP tests cover ordinary file diffs/native history, active source durability and removed scope endpoints. Runtime/MySQL tests retain shared publication, waiting-run cancellation, failed private history, handoff ordering and restart recovery without Git checkpoints.

TeamRunner removes settled job/admission bookkeeping directly from the shared runtime completion promise. It retains genuine finalization exclusion without a duplicate SQL completion-read race after ordinary runtime.finished() callers return.
