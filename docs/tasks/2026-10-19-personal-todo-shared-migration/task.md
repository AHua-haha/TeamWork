# Personal todo shared-workspace migration

Status: complete
Task start commit: 2a0ccfdd363b2b56eea09f788ccc570820a528c5
Review boundary: personal-todo workspace data migration to the committed shared-directory harness.

## Outcomes
- [delivered] Import owned legacy files without overwriting newer shared files or changing approval/activation state.
- [delivered] Preserve existing backend implementation commits in the real project Git repository and retain pending edits as pending.
- [delivered] Preserve members, chats, private history, providers and newer frontend work; verify all member environments use the shared folder.

## Decisions
- Operational migration only; no production contract/code changes or model calls.
- Compare against the original worktree seed, use only each member's owned source/context and lead management files. Found 23 imports and no conflicting edits.
- Stop the idle backend temporarily. Back up the complete project and database privately before applying files. Retain old worktrees and approval objects.
- The project Git repository has no commits/staged changes. Import the existing backend semantic commit chain, preserving its commit identities; frontend files remain untracked/pending.

## Verification and completion
- [Result](result.json) and [live verification](verification.json): all 23 imports hash-match, all four member HTTP harness views resolve to the registered shared directory, and the chat stays at position 61.
- Native project HEAD is the existing e41dcf1 backend commit: three semantic implementation commits plus their original empty baseline. Backend files are clean; newer frontend files remain untracked/pending.
- All 15 stable SQL tables have identical row counts/content fingerprints before and after, including members, activation, chats, agent contexts/messages/runs and provider/model configuration. ContextBase recorded imported context files through its normal observation mechanism.
- Approved Git pointers and archived worktree files are unchanged. Member configuration is valid, with no pending member edits or activation changes. No model calls, automatic approvals, configuration reset or source rewrite occurred.
- Private backup: .run/private-migration-backups/personal-todo-2026-10-19/project.tar.gz and database.sql, with private filesystem permissions. Full file/hash baselines remain alongside the backups, outside tracked task artifacts.
- The first live check hit the shell proxy; reran with loopback NO_PROXY. Backend launch was detached into its own process session so it survives the execution shell. Live backend/frontend checks passed afterward.
- Backend and frontend are available on ports 3000/5273. No production code/contract change was needed; no remaining migration work.
