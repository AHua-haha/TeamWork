# Shared workspace and sequential members

Status: complete
Task start commit: 8d9cf0e0cfd7bbf242030396628c2e0ee817d3e9
Review boundaries: workspace harness and group chat execution.

## Design outcomes
- [delivered] All members use the registered project directory directly, with unchanged scope permissions and user acceptance of design/member files.
- [delivered] Implementation semantic commits use the project Git repository; harness checkpoints and protected acceptance remain separate.
- [delivered] Only one member executes per workspace, including finalization. Agent final routing names at most one distinct member. Existing user routing, busy refusal, limits and delivery remain unchanged.

## Decisions
- Agent multi-recipient publications are refused atomically with private revision feedback.
- Admitted user recipients execute in order; busy mentions are not queued/retried. A handoff waits for sender finalization before recipient tools/model execution.
- No automatic restoration/materialization overwrites shared files. Old private worktree artifacts remain preserved and unused; they are not automatically merged.
- Review uses the real project folder. Pending shared edits are visible immediately. Existing unrelated user staging must never be committed by a member.

## Verification and completion
- Canonical [harness](../../systems/workspace-agent/harness/design.md), [group chat](../../systems/workspace-agent/team/group-chat/design.md) and affected runtime/workspace/context/team/database documents match the delivered drafts and code.
- Final backend suite: 155 passed, one existing filesystem-watcher check skipped because this environment delivered no events. MySQL suite: all 59 passed, including sender-finalization exclusion and cancellation of waiting runs. Frontend regression suite: all 76 passed. Backend build and exact-file Git restore check passed.
- Earlier failures are retained in tests.jsonl: superseded isolation/stale-base assertions, native exact-file staging with exclusion pathspecs (fixed using authorized NUL-separated staging), pending design authority, and a tool-chain fixture timeout under concurrent verification. The latter now permits 60 seconds; the verified full run completed that fixture in about 26 seconds. The admission-order race was fixed before final SQL verification.
- Tests used disposable databases/projects and mock model streams, with no paid provider calls or real workspace reset/restart. No frontend API shape or UI changes were needed.
- Existing private directories are deliberately preserved and unused. Pending work left there requires explicit reconciliation; the implementation does not silently import it into shared files.
- No remaining work in this task. Restart the backend to load the updated prompts and runtime rules.
