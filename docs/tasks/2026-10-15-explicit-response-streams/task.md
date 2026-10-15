# Explicit working and response streams

Status: complete
Task start commit: e4b9bbd9438ff1d2668cf72ab68016bb9bdba6df
Review boundaries: [Team group chat](drafts/workspace-agent/team/group-chat/design.md), [Frontend group chat](drafts/frontend/group-chat/design.md)

## Design outcomes
- [delivered] Backend classifies working versus final-response output explicitly, from persisted records/chunks; frontend does not guess from tool-free text.
- [delivered] Working text/reasoning/tools stream in Work and explicit final-response text streams in the outside response area; fold controls visibility only.
- [delivered] Persist final reference including its exact response action, preserve refusal/parallel ordering and old immutable history.

## Decisions and open questions
Confirmed the screenshot's text was already accepted as final by the old backend rule. Replace implicit tool-free completion with a project-harness final_response(text) action. Ordinary assistant text is working output, including replies without tools; such replies continue privately with feedback. The explicit response action's text argument streams outside Work; publication is still atomically validated after its tool result is stored, with refusal feedback and no other member receiving previews. Backend read APIs identify the response tool call in stored completed/chunk data. No model-context inference in the frontend. Preserve .claude/ and existing user database/history.

## Checkpoints and remaining work
Delivered the explicit reusable final_response capability through the project harness, team continuation/publication rules, exact action references in existing JSON history, backend follow output annotations projected from stored records/chunks, and frontend channel routing before hidden/expanded visibility. Updated affected runtime/database/team/harness/lead/frontend contracts and implementations. The old frontend tool-free-text heuristic is removed.

The screenshot was checked through the running backend's read-only timeline API: its “let me check” text had a completed final reference, so this was also a backend implicit-completion bug. User workspace files and database history were not modified. Existing accepted records keep their original classification; new activations require the explicit response action. Restart the backend and reload the frontend together before trying new runs.

Verification: 86 backend unit/HTTP/routing tests, 40 disposable MySQL integration tests, 53 frontend client/projection tests, both production builds and documentation parity/links/whitespace. SQL integration verifies raw working prose never publishes, progressive response arguments are retained in DB chunks/read through follow, accepted references identify exact calls/results, refusals remain private, and old history still imports. Test evidence: [tests.jsonl](tests.jsonl), including initial compile failures before imports/test signatures were corrected.

Browser procedure: start [browser-server.mjs](browser-server.mjs) with Node on 127.0.0.1:4276; run Vite on 4274 with AGENT_BACKEND_ORIGIN=http://127.0.0.1:4276; use a fresh Playwright CLI session named explicit-stream and [browser-check.js](browser-check.js) via run-code --filename. The deterministic HTTP SSE fixture checks ordinary text streaming only inside Work (also while hidden), designated response text only outside, fold state without reconnect, compact layout, empty work, parallel/reverse completion, reconnect, accepted final replacement and preserved scrolling on desktop/mobile. SQL/runtime integration independently verifies the real database source and annotation contract. Screenshots are under output/playwright/. Local check servers/session are stopped afterward. No provider calls, push or merge are part of this task.
