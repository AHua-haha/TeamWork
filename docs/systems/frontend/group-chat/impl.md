# Group chat implementation

## Contract

[Group chat](design.md) owns shared ordered reports, native activity streaming/folding, composer images and compact commit approval.

## Responsibilities and decomposition

GroupClient owns durable group timeline synchronization and submission. GroupChat reserves member sections and uses AgentClient for each activation's private history/progress. group-work derives ordered text/tool sets, hides reasoning and exact final sources, and supplies the transient thinking row. CommitApprovalInput owns user decision/feedback; CommitReviewTab owns right-panel details/diffs. Backend owns all approval authority and final message identity.

## Coordination and data flow

Existing group follow, completed-history reconciliation, incremental progress, final acceptance folding, image submission and model-avatar flows remain. The composer footer mounts a compact approval control before the form. It polls summary-only pending requests without overlapping reads (1.2 seconds during work, 5 seconds idle) and ignores disposed requests. Review selects the same request ID in WorkspacePage and opens the right panel's Commit review tab. Full diff data loads only there. Accept/Deny/feedback post the exact ID/action and optional message; buttons disable during submission, errors stay visible and the agent receives its original tool result. Opening/closing review makes no decision. Late/resolved requests produce explicit backend errors.

## Decisions and constraints

No diff/file list/command preview is embedded in the popup. Keep the main composer draft and streaming section intact. Old design/member scope acceptance controls are removed from Changes; activation remains separate and requires idle team state. Workspace switches clear the selected review. No runtime-internal context is a frontend data source.

## Code map

- [Group UI](../../../../frontend/src/ui/GroupChat.tsx), [approval UI](../../../../frontend/src/ui/CommitApproval.tsx), [approval client](../../../../frontend/src/client/commit-approval.ts).
- [Page](../../../../frontend/src/ui/WorkspacePage.tsx), [panel](../../../../frontend/src/ui/WorkspacePanel.tsx), [file diff](../../../../frontend/src/ui/FileDiff.tsx).
- [Group client](../../../../frontend/src/client/group-client.ts), [activity derivation](../../../../frontend/src/ui/group-work.ts), [styles](../../../../frontend/src/ui/styles.css).

## Verification

Frontend group/activity tests retain streaming, routing-header, final-folding, thinking-row and image contracts. Approval tests check decision controls without diff content, exact summary/detail/decision endpoints and errors. Browser checks verify popup placement and Review navigation. Changes tests verify independent idle activation without old scope mutation APIs.
