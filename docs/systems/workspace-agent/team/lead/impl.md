# Lead agent implementation

## Contract

[Lead](design.md) defines collaboration, pending management edits, user acceptance and shared assignment. Configuration-change/activation remains deferred.

## Responsibilities and decomposition

The [team](../design.md) owns stable active member identity/content and model choices. The [harness](../../harness/design.md) owns three purpose bases, scoped file/Bash/Git authority and acceptance. [Group chat](../group-chat/design.md) owns final publication and mentions. Lead behavior is prompts and assembled reusable capabilities; there is no special lead execution loop or editor.

## Coordination and data flow

TeamSystem materializes missing stable bundles for the lead without replacing pending files. MemberContext supplies role/roster/model guidance, meaningful JSON/Markdown examples and current group rules. Harness prompts explain management scope, derived implementation authority, Bash metadata, checkpoint/staging separation and user-only protected commits.

The lead edits pending files with generic tools, inspects/stages/restores through ordinary scoped Git and requests user review of exact bytes/base. User acceptance persists member files without changing stable active settings. No submit/activate/retire adapter is exposed. Assignments mention active members in a naturally completed final response; atomic group admission and private refusal feedback remain unchanged.

## Decisions and constraints

Version/revision/identity bookkeeping belongs to the backend envelope. Editable config has designScope only for harness assignment. Management bootstrap is fixed; implementation remains empty until accepted designs are assigned. Backend model listing is read-only and lead-gated. The obsolete lead-tools module and immediate submission path are removed, rather than retained beside the approved-file model. Internal backend lifecycle methods remain for trusted composition.

## Code map

- [Role/member examples](../../../../../backend/src/member-context.ts), [lead model discovery](../../../../../backend/src/member-tools.ts).
- [Policy assembly](../../../../../backend/src/team-system.ts), [stable bundle materialization](../../../../../backend/src/member-config.ts).
- [Team implementation](../impl.md) owns stable identity/source; [harness implementation](../../harness/impl.md) owns scopes, Bash and Git.

## Verification

[Lead tests](../../../../../backend/test/lead.test.ts) prove bootstrap file editing, protected commits, semantic design acceptance and no implicit member activation. [Context tests](../../../../../backend/test/team-context.test.ts) verify prompts and unique common tools. [Member config tests](../../../../../backend/test/member-config.test.ts) cover metadata/stable drafts. [SQL integration](../../../../../backend/test/integration/backend.test.ts) verifies real model tool calls, independent implementation commits and user design acceptance through group execution.
