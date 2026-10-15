<!-- Task proposal; current contract is under docs/systems/ -->

# Team implementation

## Contract

[Team design](design.md). Preserve member identity/lifecycle, readiness, design-based authority, shared communication and independent private execution.

## Responsibilities and decomposition

TeamService owns member validation, lifecycle, lead initialization and readiness. The [group chat child](group-chat/design.md) owns durable shared publication, delivery timing, trigger admission, parallel activation, budgets, observation and cancellation. The [lead child](lead/design.md) owns design collaboration and file-bundle member configuration; assignments are model-generated shared responses. Neighboring [harness](../harness/design.md) supplies tools and design/file context; [context base](../context-base/design.md) owns durable design records; [workspace](../workspace/design.md) owns registration and files; [runtime](../../agent-runtime/design.md) owns the single execution loop.

TeamSystem composes these services. MemberContext supplies role, roster and cooperation instructions. Team routes expose management and delegate chat operations to TeamRunner. The HTTP agent input route refuses member input and preserves solo-agent behavior.

## Coordination and data flow

MySQL transactionally creates a member and its agent record, enforces unique lead/name keys, and guards changes by revision. Workspace creation includes its lead. Startup supplies missing leads, migrates old context scopes to empty harnesses, and freezes old design mappings into explicit implementation scopes with accepted source bundles once; legacy scope grants no authority. New member creation imports shared messages into context through the group store. Member lifecycle writes and group publications serialize on the workspace row; retirement records a final group-delivery position and cancels private execution.

Readiness combines model settings, empty catalog tool selections and a nonempty design or implementation assignment with all selected designs resolvable. Team run config uses these checks and resolves model snapshots. Group publication validates all selected recipients and resolves every snapshot before persistent admission. Tools remain harness-owned and check current scope.

The runtime policy wraps the standard policy for members: buildRequest augments current role/roster/running information and replaces tools with harness tools plus lead-only operations. Tool responses continue private execution. A response without tools is submitted to group publication with its exact committed record identity. Successful acceptance ends the sender and triggers independent runs. Expected refusals append a private feedback message to the same run and continue it; runtime failure/step limits still apply. Solo policy behavior is unchanged.

## Decisions and constraints

Shared message delivery changes stored model context without manufacturing private run-history records. The private history, mutable context, and group transcript have separate purposes. Model settings remain run snapshots; file authority remains current per operation. MemberConfigService captures version 2 manifests with harnesses.project {designScope, implementationScope} and ordered Markdown prompts through harness file access, validates authority/schema/references/revision, then persists exact source bytes/digest and projected fields in one member write. Invalid bundles never reach persistence. Submission is serialized per workspace and with sender file actions; existing targets also serialize activation with their review/restore/file operations. updateMember checks idle state under the same workspace/agent locks as publication; publication rechecks prepared member revisions so a changed config cannot activate with a stale model snapshot. There are no `send_message` or `assign_member` tools or call-chain restrictions. Private histories are retained; automated maintenance is deferred.

## Code map

- [Member service and run configuration](../../../../backend/src/team.ts)
- [Role/cooperation instructions](../../../../backend/src/member-context.ts)
- [File submission and stable bundle reads](../../../../backend/src/member-config.ts), [bundle representation](../../../../backend/src/member-config-format.ts)
- [Management tools](../../../../backend/src/member-tools.ts)
- [Composition/runtime policy](../../../../backend/src/team-system.ts)
- [Management and chat HTTP routing](../../../../backend/src/team-routes.ts)
- [Group chat implementation](group-chat/impl.md), [lead implementation](lead/impl.md), [harness implementation](../harness/impl.md), [database implementation](../../database/impl.md)

## Verification

[Lifecycle tests](../../../../backend/test/team.test.ts), [context/tool tests](../../../../backend/test/team-context.test.ts), [group chat tests](../../../../backend/test/team-group-chat.test.ts), [HTTP tests](../../../../backend/test/team-routes.test.ts), and [MySQL integration](../../../../backend/test/integration/backend.test.ts) verify the composed design. Integration drives common pending-design edits, member/harness assignment, implementation commits, user design acceptance, worktree commands and return mentions. Group tests verify parallel work, refusal feedback, deferred delivery, immutable private history and persistent group records.

The group child persists display reservations and lifecycle changes alongside publication. Team management and runtime continue their existing responsibilities; frontend queries reconstruct presentation from these records and load private work separately. Model settings can be changed per member through its existing revision-checked management endpoint.

HarnessService owns worktree roots, the combined project harness and separate command harness, and scoped history. The project definition keeps design, implementation and lead member-config parts independent. Existing internal/user HTTP assignment fields remain unchanged. TeamSystem checkpoints before final publication and supplies the runtime afterRun callback for other terminal paths. Lead-only read_design/save_design tools are removed; all members use common file tools and harness commit policies. Team routes add member-scoped review/history/user commit/restore operations alongside the path-only submit tool and stable bundle read endpoint. Existing user HTTP create/update writes generate an accepted JSON/Markdown bundle, including frontend settings edits. Missing editable copies are materialized in the lead worktree with current member ID/revision; existing drafts are preserved. Member configuration is never activated by generic scope commits.

Accepted source records store {path, files, digest, submittedBy, submittedAt} alongside projected fields in the same member JSON/revision. A generated user/bootstrap bundle records full settings without inline prompt and puts instructions in prompts/member.md. Submitted manifests may inherit unspecified model settings at submission, and the resulting projection is retained; runtime never reparses mutable draft files. The tool result supplies member ID/revision for subsequent edits. On materialization only missing files are created; a missing manifest is rebased to current member ID/revision without changing the retained submitted source. Existing stale drafts must be reconciled explicitly. Configuration submission and generic scope commit are intentionally separate operations.

File submission validates model/provider/catalog references before the member write; invalid or incomplete run settings preserve the accepted bundle. User HTTP settings edits can still retain incomplete selections for later repair.

The accepted-source format migration runs once for active members during initialization: migrateMemberSource upgrades version 1 design/implementation siblings to version 2 harnesses.project, retains Markdown file bytes and path, and records a new source digest with harness attribution and an advanced member revision. It preserves the projected member fields and all Git scope definitions/reference identities. Old sources are read only by this startup converter; the active submit path accepts version 2 exclusively. Missing source bundles and pre-explicit-scope records still use the earlier one-time initialization path. Editable files already present in the lead worktree remain untouched and stale/version-1 drafts require explicit reconciliation.

Retired members retain their historical accepted bundle format and revision; initialization does not replay retirement effects solely to upgrade their config representation.
