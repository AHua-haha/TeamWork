# Team implementation

## Contract

[Team](design.md) requires file-derived create/update/delete plans, a restricted update allowlist and separate user commit/activation. Activation is atomic and requires the whole workspace to be idle. The member service coordinates scoped Git source with stable database state; group/runtime guarantees remain unchanged.

## Responsibilities and decomposition

Team owns active identity, stable exact source/projection, validation and lifecycle admission coordination. The [harness](../harness/design.md) supplies scoped pending files, checkpoints/Git and user file acceptance. [Lead](lead/design.md) supplies workflow instructions. Existing group publication and runtime remain responsible for shared messages, private execution and completed effects. Database owns atomic member persistence.

## Coordination and data flow

Capture proposed bundles from pending files for validation. Classify create/update/delete against stable backend member/path associations. Validate schema, references, resulting unique names, workspace model choices and protected lead identity. Restrict existing-member changes to responsibility, supplementary prompts and execute rules. Preserve design assignments and derive implementation authority from accepted designs.

User file commit and user activation are separate. Activation reads immutable reviewed committed files, revalidates current bases and applies all member changes in one durable transaction. Coordinate with workspace group admission and local runtime finalization so the idle check cannot race new work. Pending files, accepted Git state and active source/projection remain separate.

Materialization must distinguish initial seeding from intentional pending deletion. A missing referenced prompt is invalid; it must not silently restore or retire the member. Scoped Git rm removes files within the selected part, with recoverable checkpoints. Backend seed markers preserve intentional deletions.

## Decisions and constraints

Do not add automatic activation, implicit user approval or structured agent create/update/delete bypasses. Preserve exact source, IDs, revisions, prior private/shared history and historical Git records. Retire deleted members rather than erasing records. A new member receives shared chat history; updates retain identity/history. Fixed base prompts and scope/Git policies remain backend-owned.

Member JSON adds execute.allowedCommands; backend source formatVersion 4 and optional acceptedRevision remain outside editable files. The startup converter retains previous source and current command policy while preserving drafts. Canonical normalized settings/assignment comparisons freeze existing identity/name/role/model settings and working/dependency reference sets; only responsibility, prompts and command rules may change. New models come from the workspace choices/default. Relevant bytes are read from immutable Git blobs with strict UTF-8 decoding and bounded text validation.

MemberConfigService.validate captures a pending checkpoint and returns a change review; review reads the current user-committed member-config head. The review digest covers immutable revision, all active ID/revision pairs, workspace model revision and referenced accepted-design revisions. Capture and activation serialize through the lead file-operation queue. Source envelopes retain exact manifest/referenced prompt bytes. No agent-supplied control metadata or structured lifecycle mutation tool exists.

TeamRunner.workspaceOperation serializes publication/admission and user control; idleWorkspace refuses any active/admitted/finalizing job. A run-ID job map outlives early sender mention-slot release until runtime.finished settles, so finalization is included in the idle condition. Pending operations are included in shutdown waits. User scope commit/restore routes use the same workspace gate. Activation never queues waiting for work completion: a busy workspace returns an explicit refusal after coordination checks.

MySqlStore.activateMembers holds the workspace row, checks the complete active revision set and workspace model revision, then locks/checks all active agents. One transaction retires/updates rows and inserts members/conversations/shared context. Retirements precede inserts to allow reviewed replacements to reuse names. All writes/source projections roll back together. Existing retired records, worktrees and private history remain intact. Result assembly uses in-memory plan data after commit, avoiding a fallible provider/config reread after successful persistence.

HarnessHistory initializes one private persistent bundle marker after seeding. Activation pre-registers paths already represented by accepted files before database writes. Missing files after that point are intentional pending deletions, even across restart. Marker preparation changes no active settings and is safe if persistence later fails. No materialization overwrites existing pending bytes or recreates intentionally deleted files. Scoped Git rm provides file removal under existing authority with pre-removal checkpoint/index rollback; there is no extra lifecycle deletion tool.

HTTP GET team/configuration selects pending or committed review. POST configuration/activate accepts only revision/digest, enters idle coordination and revalidates before persistence. Member inspect/list stays read-only. Frontend UI design is separate.

## Code map

- [Member source/validation service](../../../../backend/src/member-config.ts), [source format](../../../../backend/src/member-config-format.ts), [team fields and lifecycle](../../../../backend/src/team.ts).
- [Composition](../../../../backend/src/team-system.ts), [admission coordinator](../../../../backend/src/team-runner.ts), [routes](../../../../backend/src/team-routes.ts).
- [Harness history](../../../../backend/src/harness-history.ts), [database](../../../../backend/src/database.ts), [member instructions](../../../../backend/src/member-context.ts).
- Base rule Markdown under backend/prompts/harness must describe validation and the separate user commit/activation sequence.

## Verification

Tests cover valid create/update/delete; every forbidden update field; lead deletion; malformed/missing prompt/model/design references; committed versus pending bytes; exact stale review/base failures; whole-workspace busy/finalizing work; atomic persistence/rollback; concurrent admission; retained history/shared delivery; deliberate deletions surviving materialization; and unchanged harness enforcement. The disposable MySQL suite verifies real transaction rollback, busy/stale checks, replacement/shared-history inheritance and committed-versus-pending source isolation. Unit/HTTP tests verify both admission race orders and finalization blocking.
