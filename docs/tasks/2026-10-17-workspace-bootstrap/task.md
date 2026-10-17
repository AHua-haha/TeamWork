# Fresh workspace bootstrap and local data reset

Status: complete
Task start commit: ec031fe6b7e8568a34a2827701d8ab6bd0bfaf84
Review boundaries: [Workspace draft](drafts/workspace-agent/workspace/design.md#fresh-workspace-bootstrap), [Harness draft](drafts/workspace-agent/harness/design.md), [Team draft](drafts/workspace-agent/team/design.md)

## Design outcomes

- [delivered] Initialize one managed filesystem root, context/design and member paths before workspace success.
- [delivered] Initialize a root design and ready active lead with its exact source bundle and working assignment.
- [delivered] Protect managed/private state and preserve project implementation and repository state.
- [delivered] Clear local workspace/runtime data and old managed history, preserving provider connections/API keys and implementation files.

## Decisions and open questions

User authorized updating design first and implementing. Managed root is .rsi; existing logical user/agent context paths remain API identities. Root design is user/design.json with empty implementation mappings. Bootstrap is a backend-owned initial baseline; later edits use user commit/activation. Fresh layout replaces previous storage paths without a data migration. Reset scope was explicitly selected by the user: workspace/runtime data only, keeping providers. No unresolved behavioral choice.

## Checkpoints and remaining work

Drafts were prepared before code changes. All sixteen draft/canonical document pairs are reconciled with implementation and tests. One feature-branch commit carries this Task-ID; Git records its resulting SHA. No push or merge is requested.

Verified: 108 backend tests, 45 disposable MySQL integration tests, 61 frontend tests and both builds. Coverage includes atomic bootstrap/context/marker persistence, ready lead/root design, exact source files, clean initial review, pending edits surviving reopen, collision/link refusal, adoption/transaction rollback, private metadata protection, individual-file scoped staging and reset ownership/provider/implementation preservation. [Evidence](tests.jsonl) records failed intermediate checks and successful replacements.

The authorized local reset removed 2 workspace registrations, 5 agents and all runtime/chat/context/agent-config state, plus their legacy context and scoped harness stores. Provider/app records (2) were compared by exact serialized hash before/after and after restart; they match. Project source file hashes were preserved during the reset (923 application/source files in this repository; the other project directory had no implementation files). The old empty sibling harness directory was removed. The backend was stopped for cleanup and restarted with the new code on port 3000; HTTP now reports empty workspaces/conversations. No demo workspace was left in the application database.

Earlier checks caught changed bootstrap assumptions and a native Git single-file staging failure; these were corrected rather than weakening permissions. Native staging now enumerates authorized regular files/tracked deletions and uses Git's documented literal NUL-delimited stdin pathspecs. The first local reset encountered an absent table in the older schema, rolled back database and file moves, then succeeded after table discovery was limited to known existing application tables. The first preservation check included its own generated .run/test-log files; the corrected check excludes those changing evidence files. All failures remain in tests.jsonl. The existing frontend bundle-size advisory remains.

No required work remains. Unrelated .claude/, backend/.DS_Store and backend/prompts/.DS_Store are preserved. Reload the frontend, then create/adopt a workspace to use the new bootstrap.
