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

MemberConfigService.validate captures a pending checkpoint and returns a change review; review reads the current user-committed member-config head. The review digest covers immutable revision, the workspace activation marker, all active ID/revision pairs, workspace model revision and referenced accepted-design revisions. Capture and activation serialize through the lead file-operation queue. Source envelopes retain exact manifest/referenced prompt bytes. No agent-supplied control metadata or structured lifecycle mutation tool exists.

TeamRunner.workspaceOperation serializes publication/admission and user control; idleWorkspace refuses any active/admitted/finalizing job. A run-ID job map outlives early sender mention-slot release until runtime.finished settles, so finalization is included in the idle condition. Pending operations are included in shutdown waits. User scope commit/restore routes use the same workspace gate. Activation never queues waiting for work completion: a busy workspace returns an explicit refusal after coordination checks.

MySqlStore.activateMembers holds the workspace row, checks the complete active revision set and workspace model revision, checks/locks the previous member_activation marker, then locks/checks all active agents. One transaction retires/updates rows and inserts members/conversations/shared context. Retirements precede inserts to allow reviewed replacements to reuse names. All writes/source projections and the new activation revision/time roll back together. Existing retired records, worktrees and private history remain intact. Result assembly uses in-memory plan data after commit, avoiding a fallible provider/config reread after successful persistence.

HarnessHistory initializes one private persistent bundle marker after seeding. Activation pre-registers paths already represented by accepted files before database writes. Missing files after that point are intentional pending deletions, even across restart. Marker preparation changes no active settings and is safe if persistence later fails. No materialization overwrites existing pending bytes or recreates intentionally deleted files. Scoped Git rm provides file removal under existing authority with pre-removal checkpoint/index rollback; there is no extra lifecycle deletion tool.

The low-level GET team/configuration still selects pending or committed semantic review. The frontend uses GET team/configuration/current and separate POST configuration/commit and configuration/activate controls. Member inspect/list stays read-only. Current file inspection may materialize/checkpoint the shared workspace; it does not activate or accept files.

## Code map

- [Member source/validation service](../../../../backend/src/member-config.ts), [source format](../../../../backend/src/member-config-format.ts), [team fields and lifecycle](../../../../backend/src/team.ts).
- [Composition](../../../../backend/src/team-system.ts), [admission coordinator](../../../../backend/src/team-runner.ts), [routes](../../../../backend/src/team-routes.ts).
- [Harness history](../../../../backend/src/harness-history.ts), [database](../../../../backend/src/database.ts), [member instructions](../../../../backend/src/member-context.ts).
- Base rule Markdown under backend/prompts/harness must describe validation and the separate user commit/activation sequence.

## Verification

Tests cover valid create/update/delete; every forbidden update field; lead deletion; malformed/missing prompt/model/design references; committed versus pending bytes; exact stale review/base failures; whole-workspace busy/finalizing work; atomic persistence/rollback; concurrent admission; retained history/shared delivery; deliberate deletions surviving materialization; and unchanged harness enforcement. The disposable MySQL suite verifies real transaction rollback, busy/stale checks, replacement/shared-history inheritance and committed-versus-pending source isolation. Unit/HTTP tests verify both admission race orders and finalization blocking.

## Current configuration inspection

MemberConfigService captures pending and committed snapshots under the lead operation queue and supplies active/current file comparison, parsed valid current members, validation, pending state, commit history and exact committed activation review. A workspace activation revision/time is stored in the database in the same transaction as member mutations. Legacy teams without this marker derive active file content from stable member source and explicitly flag unknown historical activation boundaries. HarnessHistory provides immutable text snapshot import, file comparison patches and committed history anchored at the activation revision. The current configuration GET is an operational read that can materialize/checkpoint files; active member GET remains read-only.

GET team/configuration/current returns active baseline metadata, current configuration/files, a flat file-change list with text patches, independent pending/commit/validation state and exact commit/activation tokens. POST team/configuration/commit accepts reviewed current revision, committed base and commit message. Existing explicit activation consumes only the committed revision/digest while whole-workspace idle. Review state changes refuse rather than applying a different snapshot. The frontend treats diff and operation data as separate consumers of this response.

[Inspection tests](../../../../backend/test/member-inspection.test.ts) exercise mixed committed/pending content, invalid/binary proposals, marker durability, legacy history and stale/failed operations. [HTTP tests](../../../../backend/test/team-routes.test.ts) cover strict read/commit/activate payloads; [MySQL tests](../../../../backend/test/integration/backend.test.ts) verify marker persistence/reopen and transaction rollback.


## Workspace-created lead baseline

WorkspaceService supplies newLead with root working design references and stores the generated exact source together with the filesystem bootstrap baseline. MemberConfigService accepts the committed revision equal to the active bootstrap marker as an already active baseline; all other prospective activations require a user commit. Normal review digest/base/idle gates remain unchanged. member-config paths and validation now use .rsi/members. The bootstrap design and source are the shared pending files; environment assembly never overwrites them.

MemberContext keeps design as the shared agreement and delegates implementation-context maintenance instructions to the harness. Harness definitions derive one paired context scope per working design; dependencies remain read-only. No member JSON fields, active source snapshots, activation workflow or runtime loop change is needed. Context continuity uses committed scope state independently of member identity.

Assignment syntax validation accepts safe context-relative references; semantic resolution requires metadata.json and valid Markdown design content. This separation preserves stable inspection of unavailable stored assignments without supporting old JSON-embedded designs. Member submission and run admission resolve actual nodes. Harness inspection omits invalid derived context parts; exact active source remains visible. New workspace leads refer to root metadata.json. MemberContext delegates layout and document rules to file-maintained base prompts.

The fixed management base contributes a writable design scope only for the lead. Ordinary members retain common implementation tools but path enforcement makes both working/dependency designs read-only. Assignment parsing normalizes physical design-root references; semantic resolution and readiness reject unavailable layouts.

## User-owned member model preferences

MemberRecord.modelSettings optionally stores connectionId, modelId and modelOptions within the existing durable member JSON envelope. The activated settings/source remain intact. TeamService validates the model-only schema and provider capability constraints using ConfigService, then uses updateMember with the reviewed member revision. The dedicated GET/PUT model-settings route is a user control boundary and contributes no agent tool. TeamSystem serializes saves through the workspace operation gate alongside run admission and file activation; it permits changes while work runs.

A single effectiveMemberSettings projection overlays the user fields on activated settings for readiness, inspection and teamRunConfig preparation. Prepared configs remain immutable snapshots. File validation continues freezing original manifest model fields, validates effective settings for updated members, and activation carries forward modelSettings on the current record. Restart normalization preserves preferences. Existing administrative reset removes them with the member records. HTTP tests check restricted payloads, conflicts, foreign/retired members and busy saves; member-file tests check activation preservation; real MySQL tests verify durable preferences, capability validation and independent prepared snapshots.

Agent cooperation uses the optional leading mention-header contract owned by [group chat](group-chat/design.md). MemberContext loads its fixed rules from backend/prompts/team/group-chat.md; TeamRunner separates header recipients from the body, and storage pins the body slice of immutable final source. User composer mention routing remains separate.

## Conversation reset

The group-chat child owns the reset contract; teamRoutes exposes POST team/chat/reset and TeamRunner coordinates workspace-idle admission with publication and member activation. MySqlStore owns atomic conversation deletion and persistent shared cursor boundaries. Runtime/harness execution logic and files remain unchanged.

The harness child exposes scoped pending file review through teamRoutes for the unified frontend Changes tab. Existing member current inspection, user file commit and separate idle activation contracts stay unchanged. Design acceptance remains its independent user harness commit; subsequent current inspection re-resolves accepted designs and can clear member activation blockers.

The fixed execute base always assembles Bash; source command-rule metadata does not select tools or authorize calls. Source snapshots remain exact and no activation/migration is performed for the broad base-policy change.
