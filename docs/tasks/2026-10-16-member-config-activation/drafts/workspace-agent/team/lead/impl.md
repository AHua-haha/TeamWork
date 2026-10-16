<!-- Task proposal; current contract is under docs/systems/ -->
# Lead agent implementation

## Contract

[Lead](design.md) provides file-based member maintenance with restricted updates and separate user commit/activation. File editing/validation are agent capabilities; user commit and activation remain separate.

## Responsibilities and decomposition

[Team](../design.md) owns validation/change planning and atomic idle activation. [Harness](../../harness/design.md) owns scoped file/Git authority and maintenance prompts. Group chat/runtime retain publication and execution. No lead-specific execution loop or structured lifecycle mutation tool is introduced.

## Coordination and data flow

Backend-maintained management/member Markdown rules are updated to explain create/update/delete, the three allowed update categories, validation and the separate user commit/activation steps. The lead edits pending files with common capabilities and obtains validation feedback. Backend tracks identity/revision/source; agents do not maintain bookkeeping. User action commits exact files; another user action activates the reviewed committed state while the whole workspace is idle.

## Decisions and constraints

No agent activation or implicit acceptance from conversation/run completion. Existing model discovery stays read-only. Supplementary member prompts are editable; fixed base rules remain backend-owned. Deleted workers retain their prior history/files. validate_member_config accepts only a path naming .team/members, contributes no activation authority and is assembled only for the lead. Member JSON examples and maintenance rules live in management-members.md; MemberContext supplies current member locations. Frontend activation presentation remains separate.

## Code map

- [Member instructions](../../../../../../../backend/src/member-context.ts), [management base](../../../../../../../backend/prompts/harness/management.md), [member maintenance rules](../../../../../../../backend/prompts/harness/management-members.md).
- [Team composition](../../../../../../../backend/src/team-system.ts), [member service](../../../../../../../backend/src/member-config.ts), [harness assembly](../../../../../../../backend/src/harness.ts).

## Verification

Prompt/tool assembly checks cover valid/forbidden update examples, protected lead deletion, user-only commit/activation and preservation of normal group behavior. The implementation must also satisfy the team/harness contract checks. Member activation unit/HTTP and MySQL integration tests verify this workflow.
