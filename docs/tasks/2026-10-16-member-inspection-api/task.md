# Member inspection API and frontend

Status: complete
Task start commit: 53f8ac3aea0bca063f453718582bc0ea46174cec
Review boundaries: [Frontend design draft](drafts/frontend/design.md#member-tree-active-details-and-configuration-changes), [Team API design draft](drafts/workspace-agent/team/design.md#backend-api-guidance-for-member-display-and-configuration-review)
Current contracts: [Frontend](../../systems/frontend/design.md), [Team](../../systems/workspace-agent/team/design.md)

## Design outcomes

- [delivered] Read active member information, exact stable configuration and effective harness scope/rules.
- [delivered] Inspect current editable configuration, pending state, validation and commit history since activation, with one active-to-current file diff.
- [delivered] Separate user Commit and atomic workspace-idle Activate operations against exact reviewed state.
- [delivered] Design folder/file tree with member cards attached on the right, lead at workspace root, avatar hover/focus preview and complete active-only details on click/tap.
- [delivered] Separate Configuration changes view with independent status/history and operations above a flat changed-file list and conventional text diff.

## Decisions and open questions

The user selected one active-to-current diff instead of separate active-to-committed and committed-to-pending views. Commits awaiting activation and further pending edits can coexist. Activation consumes committed files only; current file content may still be invalid or incomplete. Active member information remains a database snapshot with exact source bytes and validated fields, independently usable from its Git reference.

The final preview settles a conventional design file tree with member cards attached to applicable nodes, including the lead at the workspace root. This supersedes the member-only connected-node preview. Working assignments determine placement; dependencies stay in details. Multiple assignments/owners, unassigned designs and unavailable references remain visible. The tree does not define a reporting hierarchy.

The user chose active-only avatar details and a separate changes view; embedded Active/Changes tabs inside member details are superseded. The final changes sidebar is a flat file list, superseding its folder-tree preview. Commit history/pending/validation and Commit/Activate controls remain independent of file review. The user approved this preview and authorized implementation. No unresolved behavioral choice remains.

Implementation choices: current configuration is GET team/configuration/current, with POST configuration/commit and existing POST configuration/activate. A workspace activation revision/time is persisted atomically with roster/source changes and participates in stale reviews, including unchanged-file activations. Existing low-level review and generic file operations remain available.

Legacy limitation: older active configurations have no recorded workspace activation boundary. Their database source snapshots supply the file comparison; history is explicitly labeled available rather than claiming a known activation boundary. The next successful activation establishes the marker. Inspection text/patch/history limits are explicit in the team contract.

## Checkpoints and remaining work

One complete candidate implements and promotes all seven draft/canonical document pairs with backend/frontend code and tests. The protocol-required commit carries this Task-ID; Git history identifies its resulting SHA. No push or merge is part of this task.

Verification is recorded in [tests.jsonl](tests.jsonl): 105 backend tests, 61 frontend tests, 44 disposable MySQL integration tests and both builds passed. Database tests cover atomic marker persistence/reopen and rollback; focused tests cover mixed committed/pending files, malformed proposals and stale/no-change activation reviews. Browser checks use the actual frontend and HTTP backend with disposable data, verifying desktop/mobile tree, active details, flat diff and separate commit/activate while preserving pending edits. Screenshot evidence is .run/member-tree-implemented.png (ignored local artifact). Final document audit checks canonical/draft parity, sections, links, JSON examples and whitespace.

Earlier failed checks remain recorded: initial design-only document audit, temporary fixture module startup, and desktop size containment. The fixture and layout were corrected and successful checks supersede those failures. The frontend build retains its existing large-bundle advisory. Unrelated .claude/, backend/.DS_Store and backend/prompts/.DS_Store remain untouched. No required work remains.
