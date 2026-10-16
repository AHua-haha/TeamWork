# Member configuration validation and activation

Status: complete
Task start commit: e87fa3db5349378c9f5bf694f64a4202844ea363
Review boundaries: [Team](drafts/workspace-agent/team/design.md), [Harness](drafts/workspace-agent/harness/design.md), [Lead](drafts/workspace-agent/team/lead/design.md)

## Design outcomes

- [delivered] File-based member changes have create, update and delete semantics; delete retires and retains history/files; lead deletion is refused.
- [delivered] Existing members may change only execute rules, supplementary prompt references/content and responsibility. Name, role, settings and working/dependency assignments remain fixed. Implementation authority stays derived from accepted designs.
- [delivered] Agents validate pending files through one path-based validation capability; validation never accepts or activates them.
- [delivered] User acceptance commits exact member files. User activation applies a reviewed accepted change set atomically only when the whole workspace team is idle.
- [delivered] Invalid/stale/busy activation changes nothing, preserves prior stable configuration and retains drafts. Backend owns identity/revisions and source associations.

## Decisions and open questions

The user selected whole-workspace idle gating, atomic reviewed change-set activation and updates limited to execute/prompt/responsibility. Create assigns new identity with valid accepted design references and workspace model choices/default. Delete is retirement; the lead cannot be deleted. Changing an existing assignment needs an explicit replacement (create/delete), not update. Model/name/role changes are not permitted by update. The user selected separate commit and activation actions. Validation remains a file-based capability without activation authority. Exact endpoint/tool names, manifest placement and UI presentation are implementation details, not additional behavioral choices.

The settled sequence is edit -> validate -> user commit -> separate user activation. A user commit does not activate settings, and activation excludes uncommitted files. Activation reads immutable accepted files, revalidates exact configuration/design/base state and checks workspace idleness/admission under coordinated locking. It does not start any member. Prompt/base policy stays backend-owned; execute config changes cannot override filesystem/Git acceptance policy. Deliberate file deletions must not be recreated by per-request materialization.

The user explicitly authorized implementation after settling the design. Implementation starts from e87fa3db5349378c9f5bf694f64a4202844ea363; canonical documents were promoted with the completed implementation during candidate commit preparation.

## Checkpoints and remaining work

During design discussion the agent started code prematurely; the user instructed settling the design first, and all six premature application/test edits were restored. That earlier proposal-only state was superseded by the final explicit implementation authorization. The settled design and implementation are delivered together in this task commit.

Delivered file-derived planning/validation; a lead-only path-based validation tool; separate committed-snapshot user review/activation APIs; atomic SQL persistence with workspace admission/finalization gating; create/update/retire semantics; deletion-safe materialization and scoped Git rm; backend-owned source migration; file-maintained maintenance prompts; and reconciled canonical documents. API usage is in [backend README](../../../backend/README.md#member-configuration-activation). Frontend inspection remains unchanged and no activation UI is added.

Final verification: 99 backend unit/HTTP tests passed, with one existing watcher test skipped because this platform reports no file events; all 44 disposable MySQL integration tests passed; backend build passed. The unchanged frontend also passed all 56 tests and its production build. Documentation verification passed for 29 task/canonical/README documents, including canonical/draft parity, sections, links, JSON examples and whitespace. Detailed successes and development failures remain in [tests.jsonl](tests.jsonl), all tied to the starting commit above. The final backend checks ran after the last code edit and canonical promotion.

No agreed backend outcome remains. Frontend activation presentation remains a separate future task. Unrelated .claude/, backend/.DS_Store and backend/prompts/.DS_Store are preserved and excluded. No push or merge is requested.
