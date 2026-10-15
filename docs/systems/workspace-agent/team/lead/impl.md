# Lead agent implementation

## Contract

[Lead design](design.md). Preserve design collaboration, user-only design acceptance, file-based member configuration and shared mention assignment.

## Responsibilities and decomposition

The team owns MemberConfigService and lifecycle persistence. The lead tool adapter exposes only submit_member_config for creation/update, with a path argument; retire_member and list_models remain team operations. The [harness](../../harness/design.md) supplies common file tools, mandatory base rules and .team/members draft scope. The [group chat](../group-chat/design.md) owns publication and activation. No separate lead design-save or structured assignment service remains.

## Coordination and data flow

Before each lead request the team materializes missing member bundles from accepted source records without overwriting drafts. Roster instructions include member IDs, current revisions and bundle paths, plus a complete manifest example. The lead edits manifests/prompts with common tools, submits the path, then uses a shared response to mention the accepted member. MemberConfigService validates caller authority from the active lead record, captures exact bytes and resolves design references before an atomic member write. Busy/stale/refused submissions return private recoverable feedback. Pending design edits and their user acceptance still use independent harness Git history.

## Decisions and constraints

JSON is configuration and Markdown carries optional member instructions. The combined project base owns maintenance prompts, reusable file tools and separate design/implementation commit policy. Its version 2 manifest assignment is harnesses.project {designScope, implementationScope}. Implementation scopes are explicit. The separate command base owns run_command and current command matching; richer boundary configuration is deferred; file submissions inherit the lead's existing command allowances for new members and preserve the target's allowances on update. Workspace model settings have a separate revision-checked HTTP boundary; member HTTP writes are removed. list_models returns workspace choices/default, and submitted member model selections are constrained to those choices while unchanged existing selections may remain. Self-updates require idle state; a running lead cannot change its own assignment or model. Catalog publishing and peer worktree integration remain deferred.

## Code map

- [Submission tool](../../../../../backend/src/lead-tools.ts)
- [Role/cooperation instructions](../../../../../backend/src/member-context.ts)
- [Team implementation](../impl.md) owns file submission, lifecycle and stable source records.
- [Harness implementation](../../harness/impl.md) owns generic tools, pending history and user commit authority.

## Verification

[Bundle tests](../../../../../backend/test/member-config.test.ts) verify exact submitted bytes, pending isolation, schema/policy/path validation, source persistence failures, revisions, busy/foreign targets and commands. [Lead tests](../../../../../backend/test/lead.test.ts) verify common design editing and user acceptance. [MySQL integration](../../../../../backend/test/integration/backend.test.ts) drives actual lead file editing/submission, worker prompts/tools, semantic implementation commits and user-only design acceptance.

## Unified streaming and model completion

The lead uses ordinary assistant text for its final report, question or assignment. Its tools cover project work and member management, without a special completion tool. Normal team completion/publication rules apply, and only accepted final mentions activate peers.
