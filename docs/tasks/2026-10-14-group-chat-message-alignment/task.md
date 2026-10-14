# Group chat message alignment

Status: complete
Task start commit: c81502d957584e4560876b6ba0119d9f613a9a1c
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Move the pill row slightly left so its leading status text aligns with the report text.
- [delivered] Align each user bubble's right edge with the member run box's right edge.
- [delivered] Match avatar-to-message gaps and retain avatar/message top-edge alignment for both sender types.

## Decisions and open questions

Shift the pill row left by its 9px pill-content inset; the row stays inside the card and keeps its 6px gap. Remove the user bubble's extra report-padding inset so its outside edge follows the member box, rather than the inner report column. The existing symmetric avatar gutters provide equal gaps: 12px desktop, 8px narrow, with both avatars already top-aligned by the shared grid. Verify these relationships directly. Preserve the outlined boxes, status colors, compact controls and 800px report/composer maximum.

## Checkpoints and remaining work

Delivered the left-shifted pill row and user bubble edge alignment. Build and browser checks at desktop/390px/320px plus panel-open layouts passed. Measurements confirm status text aligns with report text, both avatar tops match message tops, user/member right edges match, and avatar gaps are equal (12px desktop, 8px narrow). Compact pills, semantic colors, private disclosure and 800px reading/composer alignment remain verified. Canonical docs match drafts and code; links/whitespace passed. See tests.jsonl. Unrelated .claude/ files are preserved.
