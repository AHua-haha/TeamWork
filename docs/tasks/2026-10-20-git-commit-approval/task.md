# Agent-managed Git and explicit commit approval

Status: complete
Task start commit: 6aa818217dafb15732d03f82893f0a5895e66588
Implementation increment start commit: b86d32cc456fa66f93c044b0eacbea6ab9bbf444
Review boundaries: [Harness](drafts/workspace-agent/harness/design.md), [Bash](drafts/workspace-agent/harness/tools/bash/design.md), [Group chat approval](drafts/frontend/group-chat/design.md).

## Design outcomes

- delivered: ordinary project Git replaces harness scope histories, persistent indexes/refs, checkpoints and restore APIs. See [canonical harness contract](../../systems/workspace-agent/harness/design.md).
- delivered: explicit commits classify their actual candidate files. Implementation-only commits run, mixed protected/implementation commits refuse, and design/member-only commits require user approval. See [canonical Bash contract](../../systems/workspace-agent/harness/tools/bash/design.md).
- delivered: a compact approval input above the composer provides Accept, Deny, Send feedback and Review. Exact candidate details and file diffs open in the right panel. See [canonical group chat contract](../../systems/frontend/group-chat/design.md).
- delivered: ordinary committed configuration projections, separate idle atomic member activation, bootstrap baselines and one-time read-only legacy import. All 26 affected canonical documents match the completed task drafts.

## Decisions and open questions

Detection covers explicit Git commit requests only; indirect scripts/programs remain outside this prototype guard. Dirty files outside a commit candidate do not affect classification. Unknown paths refuse, and renames classify both source and destination. Design and member files may share an approval-required commit.

The prototype supports standard message commits, including tracked-file `-a` commits. Advanced modes, repository/index overrides, linked/external repositories and background commit requests refuse with guidance. A short-lived candidate index freezes reviewed bytes; there are no persistent scope indexes or scope Git references. The actual commit remains sandboxed. Approval rechecks the candidate and HEAD before execution.

Approval state belongs to the backend session. Waiting suspends the foreground timeout. Cancellation, reset and shutdown remove pending decisions, and restart never replays them. Reloaded frontends can rediscover outstanding requests. A decision resolves once. Deny and feedback skip execution and return recoverable private tool results. Commit and idle atomic member activation remain separate.

New workspaces create context/member files and an initial durable SQL baseline without creating `.rsi/harness` or making a Git commit. Existing accepted control files can be imported once from legacy storage without overwriting pending edits. Existing `.rsi/harness` archives are preserved on disk and unused after import. Ordinary Git versions tracked files; agent-owned Git replaces backend checkpoints. Durable SQL chat histories, private working histories and context versions remain.

No unresolved design decisions remain for this increment.

## Checkpoints and remaining work

- `b86d32c`: persisted proposed design only; canonical behavior and runtime were unchanged at that checkpoint.
- Final implementation increment: removed obsolete Git mechanisms, integrated approvals and the right-panel review, reconciled bootstrap/configuration/activation, prompts, API callers and documentation. Removal of checkpoint delays exposed concurrent SQL chat-clock locking and completion-order races; exclusive clock writes and coalesced runtime completion reads resolve these while preserving durable history.
- Verification: backend 176 passed with one existing filesystem-watcher test skipped because this environment delivered no events; frontend 87 passed; MySQL integration 65 passed; both builds passed. After the final explicit `git -C` routing adjustment, all eight affected approval/migration tests and the backend build passed. Documentation parity/link checks and whitespace checks passed. The frontend build retains its existing bundle-size warning.
- Real desktop/mobile browser checks used a disposable database and workspace: Review opened the exact diff, Accept created one ordinary commit, Deny and feedback created none, the popup stayed above the composer without embedding a diff, and no horizontal document overflow occurred. The disposable services and database were cleaned up.
- [Test evidence](tests.jsonl) retains failed iterations and their subsequent passing checks, with the full increment starting SHA. No remaining implementation work. The live deployment and personal workspace data were not changed; loading this version requires a backend restart or the normal deployment update.
