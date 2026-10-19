# Streaming thinking indicator

Status: complete
Task start commit: 356eac3de8c4771fc89c2d42c652933777bb9300
Review boundaries: [Workspace group chat](drafts/frontend/group-chat/design.md)

## Design outcomes
- [delivered] Show a compact animated Thinking… row only while the member's live stream is producing thinking, keeping reasoning content hidden.
- [delivered] Clear the row when thinking ends, text/tool output begins, a message/run ends, final acceptance occurs, or the transient stream is lost. Preserve the existing Work disclosure and final rendering.

## Decisions and open questions
- Use the existing compact chunk API and live-message event metadata; no backend/storage changes or synthetic history records.
- Place the neutral row at the end of the current activity flow, inside Work. Collapsing Work hides it without stopping stream observation. Reopening during thinking shows its current state.
- Use a subtle three-dot animation, an accessible status label and a static reduced-motion presentation. No thinking content is rendered or used as a tooltip/label.

## Checkpoints and remaining work
- Persisted and promoted the agreed group-chat design and implementation guidance with the frontend change.
- isRunThinking derives current status from existing live compact frames; ResponseContent renders the neutral row inside Work with CSS-only dot animation and reduced-motion fallback. Stored thinking content is still excluded.
- Verification: all 78 frontend tests and the production build passed. Controlled compact-SSE browser checks passed for thinking/end/text/tools/completed history/gap/disconnect/reconnect/final/reload, Work collapse/reopen, content absent from DOM, reduced motion, and desktop/mobile layout. An initial browser attempt was blocked by the existing mobile sidebar overlay; the fixture check now closes it and waits for its transition before reviewing the chat.
- Canonical/draft and documentation-link audit passed. No backend or storage changes. Existing development UI receives the source change through Vite.
- [Test evidence](tests.jsonl), [browser fixture](browser-server.mjs), [browser check](browser-check.js). No remaining task work.
