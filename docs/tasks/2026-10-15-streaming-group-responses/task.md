# Streaming group responses and compact working history

Status: complete
Task start commit: 9cab536b613a609a822dab14053fb8ce09716a07
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md)

## Design outcomes
- [delivered] Stream each active member's current assistant text in its reserved response even when Work is folded; accepted final references remain authoritative.
- [delivered] Empty work expands without placeholder text or an empty tinted area.
- [delivered] Compact unboxed working list with neutral icons, one-line tool summaries and expandable details, without a background or sender stripe.

## Decisions and open questions
Use the existing persisted private follow/chunk API; backend publication and context-sharing rules stay unchanged. A streaming reply is provisional: if tools or publication refusal make it intermediate, its text belongs in Work. Only the exact accepted final remains the group response. Keep per-run boundaries, stable positions, fold state, error/retry and user scroll position. Follow running entries independently of expansion; load completed private work on demand. No unresolved behavioral choices.

## Checkpoints and remaining work
Implemented active per-run follow outside the Work disclosure, provisional-text projection with authoritative group final replacement, empty work omission, compact neutral tool/reasoning rows and pinned timeline resizing. Promoted matching [frontend](../../systems/frontend/design.md) and [group chat](../../systems/frontend/group-chat/design.md) contracts and implementations. Backend APIs/storage/runtime and solo UI retain their contracts. Preserve unrelated .claude/.

Verification covers frontend projection/client regressions and production build, plus a browser using real incremental HTTP SSE from a deterministic local fixture: parallel folded streams, progressive text, work toggles without new subscriptions, arguments/results, compact transparent desktop/mobile rows, empty final-only work, reconnect reconstruction, reverse completion, accepted final replacement, bottom-follow and preserved scroll-up. Test evidence: [tests.jsonl](tests.jsonl). Initial browser runs failed because the test left the mobile sidebar over its controls and its abrupt fixture socket destruction did not close the proxied browser response; the fixture/procedure were corrected before the passing complete flow. No production streaming failure was hidden by those fixture changes.

To reproduce browser checks: start [browser-server.mjs](browser-server.mjs) with Node on 127.0.0.1:4276; start Vite on 4274 with AGENT_BACKEND_ORIGIN=http://127.0.0.1:4276; open a Playwright CLI session named streaming-group, then run [browser-check.js](browser-check.js) via run-code --filename. Restart the fixture for a fresh scenario. Screenshots are under output/playwright/. No provider credentials or paid calls are used. Local check servers/session are stopped after verification. No push or merge requested.
