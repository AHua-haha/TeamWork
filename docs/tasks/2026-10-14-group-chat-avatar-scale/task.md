# Scale avatars around their centers

Status: complete
Task start commit: 95aa26c5c37618107a1a2532bbcbce89a66aabd9
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Shrink visible user/member avatars around their existing centers without changing message, gutter or name positions.
- [delivered] Preserve the one-line reference center and equal visible avatar gaps for both sender types.

## Decisions and open questions

Use 80% visual scale, about 37.7px from the 47.1px reference size. Apply a center-origin transform to the avatar alone; its layout slot and name remain unchanged. Visible avatar tops therefore inset from message tops while their reference centers stay fixed. Long messages keep the same anchor at their start. This supersedes matching the visible avatar diameter to the bubble height.

## Checkpoints and remaining work

Delivered 80% center-origin visual scaling (about 37.7px visible diameter). Build and desktop/390px/320px plus panel-open browser checks passed. Measurements compare scaled and unscaled centers, confirm unchanged message/name rectangles, preserve the one-line bubble center, equal visible gaps and reading/composer alignment, and detect no page overflow. Canonical docs match drafts and code; links/whitespace passed. See tests.jsonl. Unrelated .claude/ files are preserved.
