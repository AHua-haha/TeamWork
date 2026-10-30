> Existing behavior reference inside its owning system implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

> Historical implementation reference. The current React Harness contract is documented in the owning system’s impl/README.md and Agent design. Separate Harness permission, sandbox, Git approval and startup-switch descriptions below are superseded; they are not current instructions.

# Lead agent implementation

Permission and approval enforcement below describes the default enabled mode. The operator's optional startup setting `harnessPermissionsEnabled: false` bypasses harness permission gates; semantic validation, user activation and runtime lifecycle rules remain in force.

## Contract

[Lead](design.md) provides file-based member maintenance with restricted updates and separate user commit/activation. File editing/validation are agent capabilities; user commit and activation remain separate.

## Responsibilities and decomposition

[Team](../design.md) owns validation/change planning and atomic idle activation. [Harness](../../../../../../../../../../../_ctx/internal/legacy/retired-harness/implementation/implementation-notes.md) owns scoped file/Git authority and maintenance prompts. Group chat/runtime retain publication and execution. No lead-specific execution loop or structured lifecycle mutation tool is introduced.

## Coordination and data flow

Backend-maintained management/member Markdown rules are updated to explain create/update/delete, the three allowed update categories, validation and the separate user commit/activation steps. The lead edits pending files with common capabilities and obtains validation feedback. Backend tracks identity/revision/source; agents do not maintain bookkeeping. User action commits exact files; another user action activates the reviewed committed state while the whole workspace is idle.

## Decisions and constraints

No agent activation or implicit acceptance from conversation/run completion. Existing model discovery stays read-only. Supplementary member prompts are editable; fixed base rules remain backend-owned. Deleted workers retain their prior history/files. validate_member_config accepts only a path naming .rsi/members, contributes no activation authority and is assembled only for the lead. Member JSON examples and maintenance rules live in management-members.md; MemberInstructions supplies current member locations. Frontend activation presentation remains separate.

## Code map

- [Member instructions](../../../../../../../../../../../../../backend/src/core/team/member-instructions.ts), [management base](../../../../../../../../../../../../../backend/src/core/react-harness/default/prompts/instructions.md), [member maintenance rules](../../../../../../../../../../../../../backend/src/core/react-harness/default/prompts/instructions.md).
- [Team composition](../../../../../../../../../../../../../backend/src/core/team/team-system.ts), [member service](../../../../../../../../../../../../../backend/src/core/team/member-config.ts), [harness assembly](../../../../../../../../../../../../../backend/src/core/react-harness/default/harness.ts).

## Verification

Prompt/tool assembly checks cover valid/forbidden update examples, protected lead deletion, user-only commit/activation and preservation of normal group behavior. The implementation must also satisfy the team/harness contract checks. Member activation unit/HTTP and MySQL integration tests verify this workflow.

## Harness tool integration

HarnessService assembles native Pi factories with default operations and input authorization for write/edit, preserving content/details. The custom Bash service owns persistent shells and background process lifetime. TeamRunner invokes shell reset on idle chat reset, retirement and close; configuration activation resets affected members after successful atomic application. Run completion performs no Git checkpoint and does not stop background jobs. Model-visible Bash results remain plain text plus metadata.

## Operator permission mode

The project environment's harnessPermissionsEnabled setting defaults to true. With false all active members can use the available native file/Bash and management tools; file workspace/assignment/role/link guards, Bash OS sandbox and explicit Git approval/classification are bypassed. Design assignments remain work guidance. Active member identity, file schemas/update constraints and separate atomic idle user activation retain their existing rules. This setting is operator-owned and requires backend restart; member files cannot select it.

## Startup permission mode

Project configuration derives RSI_HARNESS_PERMISSIONS_ENABLED only for the selected backend child. main parses the Boolean strictly (absent means true), passes it through TeamSystem to HarnessService and MemberInstructions, and keeps it immutable for the backend lifetime. Disabled assembly enables all available tools and uses the file-backed permissions-disabled prompt instead of enforcement prompts; assignments/design context still load. fileInvocation resolves native paths without authorization. Management model discovery and file validation omit the lead gate in disabled mode, while semantic validation remains. Bash skips sandbox setup and the Git broker, uses a clean host HOME/PATH environment, and keeps framing, serialization, jobs, timeout and cleanup in the same shell service. The shell registry replaces a session if execution mode differs, so a permissive shell is never reused as an enforced one. No backend credentials are copied into the host shell environment.

[Mode tests](../../../../../../../../../../../../../backend/test/harness-permission.test.ts) cover both modes, unrestricted files/commits, unchanged validation, secret isolation, timeout and restoration. Existing sandbox/Git suites continue to verify enabled behavior.
