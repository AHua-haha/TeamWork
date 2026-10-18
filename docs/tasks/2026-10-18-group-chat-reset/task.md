# Reset workspace group chat and member context

Status: complete
Task start commit: 3c8659327cd20b80ca8f4bc9cef662efe061bd9a
Review boundaries: [group chat](drafts/workspace-agent/team/group-chat/design.md), [frontend](drafts/frontend/group-chat/design.md).

## Design outcomes
- [delivered] User reset clears shared chat, reservations, all workspace members' private runtime history and model context atomically, enabling an empty test conversation.
- [delivered] Reset control confirms its effect, requires an idle workspace and synchronizes other connected/reconnecting clients.
- [delivered] Preserve member identity/settings, files, design/implementation context, harness state/history, provider settings and other workspaces/solo agents.

## Decisions and open questions
- Reset is explicit and irreversible. Entire team must be idle, including run finalization; Stop team remains available first. Refuse busy reset without deleting anything.
- Runtime conversation context is distinct from durable context documents: resetting does not erase project knowledge files or undo file effects.
- Preserve monotonic shared cursors and persist reset boundaries so current, delayed and reconnecting clients discard old entries without cursor reuse. Private agent history positions restart at zero and context revisions advance.

## Checkpoints and remaining work
- Delivered reset HTTP control, atomic workspace conversation deletion, persistent reset boundaries and cross-client clearing. Canonical documents match completed drafts.
- Header trash control uses the existing confirmation dialog. It is disabled while working or unsynchronized; backend also refuses finalizing/admitted jobs. Confirmation failure preserves the displayed conversation.
- Verified 148 backend tests, 52 MySQL integration tests, 70 frontend tests, both builds and desktop/mobile browser checks. SQL coverage includes busy refusal, injected-failure rollback, retired members, other workspace/solo isolation, existing-schema upgrade, reopen persistence, preserved config/files/harness and a fresh model request containing only the new group message. See [test evidence](tests.jsonl).
- The initial SQL run failed because the new test passed a malformed newLead fixture; fixed the fixture and reran successfully. The initial mobile browser script encountered the responsive sidebar overlay; corrected the interaction to close it. Final browser evidence uses complete private source history and passes without page errors.
- Browser reproduction: run [fixture](browser-server.mjs) on 4279, start frontend Vite on 5275 with AGENT_BACKEND_ORIGIN=http://127.0.0.1:4279, open ?workspace=reset-review and run [checks](browser-check.js) with the Playwright CLI. Ignored screenshots are under output/playwright/chat-reset-confirm-{desktop,mobile}.png. Disposable browser/fixture processes were closed.
- Restarted the idle managed local backend; compared existing workspace/member/chat/timeline/agent state before and after, allowing only new zero reset fields. Existing user history was not reset and no model requests were made.
- All agreed work is complete in this feature-branch checkpoint. No push or merge requested.
