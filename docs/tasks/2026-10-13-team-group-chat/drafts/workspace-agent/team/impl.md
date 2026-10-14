<!-- Task proposal; current contract is under docs/systems/ -->
# Team implementation

## Contract

[Team design](design.md). Preserve member identity/lifecycle, readiness, design-based authority, shared communication and independent private execution.

## Responsibilities and decomposition

TeamService owns member validation, lifecycle, lead initialization and readiness. The [group chat child](group-chat/design.md) owns durable shared publication, delivery timing, trigger admission, parallel activation, budgets, observation and cancellation. The [lead child](lead/design.md) owns design maintenance and harness configuration; assignments are model-generated shared responses. Neighboring [harness](../harness/design.md) supplies tools and design/file context; [context base](../context-base/design.md) owns durable design records; [workspace](../workspace/design.md) owns registration and files; [runtime](../../agent-runtime/design.md) owns the single execution loop.

TeamSystem composes these services. MemberContext supplies role, roster and cooperation instructions. Team routes expose management and delegate chat operations to TeamRunner. The HTTP agent input route refuses member input and preserves solo-agent behavior.

## Coordination and data flow

MySQL transactionally creates a member and its agent record, enforces unique lead/name keys, and guards changes by revision. Workspace creation includes its lead. Startup supplies missing leads and migrates old scopes to empty harnesses once; legacy scope grants no authority. New member creation imports shared messages into context through the group store. Member lifecycle writes and group publications serialize on the workspace row; retirement records a final group-delivery position and cancels private execution.

Readiness combines valid resolved model settings, empty catalog selections and resolvable nonempty worker design scope. Team run config uses these checks and resolves model snapshots. Group publication validates all selected recipients and resolves every snapshot before persistent admission. Tools remain harness-owned and check current scope.

The runtime policy wraps the standard policy for members: buildRequest augments current role/roster/running information and replaces tools with harness tools plus lead-only operations. Tool responses continue private execution. A response without tools is submitted to group publication. Successful acceptance ends the sender and triggers independent runs. Expected refusals append a private feedback message to the same run and continue it; runtime failure/step limits still apply. Solo policy behavior is unchanged.

## Decisions and constraints

Shared message delivery changes stored model context without manufacturing private run-history records. The private history, mutable context, and group transcript have separate purposes. Model settings remain run snapshots; file authority remains current per operation. There are no `send_message` or `assign_member` tools or call-chain restrictions. Private histories are retained; automated maintenance is deferred.

## Code map

- [Member service and run configuration](../../../../backend/src/team.ts)
- [Role/cooperation instructions](../../../../backend/src/member-context.ts)
- [Management tools](../../../../backend/src/member-tools.ts)
- [Composition/runtime policy](../../../../backend/src/team-system.ts)
- [Management and chat HTTP routing](../../../../backend/src/team-routes.ts)
- [Group chat implementation](group-chat/impl.md), [lead implementation](lead/impl.md), [harness implementation](../harness/impl.md), [database implementation](../../database/impl.md)

## Verification

[Lifecycle tests](../../../../backend/test/team.test.ts), [context/tool tests](../../../../backend/test/team-context.test.ts), [group chat tests](../../../../backend/test/team-group-chat.test.ts), [HTTP tests](../../../../backend/test/team-routes.test.ts), and [MySQL integration](../../../../backend/test/integration/backend.test.ts) verify the composed design. Integration drives real design save, member/harness configuration, shared assignments, scoped work and return mentions. Group tests verify parallel work, refusal feedback, deferred delivery, immutable private history and persistent group records.
