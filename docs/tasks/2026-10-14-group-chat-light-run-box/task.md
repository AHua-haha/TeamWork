# Group chat light run box

Status: complete
Task start commit: 1373677a6db5216305caf8f6cbfce4c2856cb973
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Implement the selected Light run box: a subtle neutral rounded surface enclosing header, expanded work and final report; sender avatar/name outside.
- [delivered] Left-align status, duration, start time and standard chevron icon in that order, with no status dot. Chevron points right folded and down expanded.
- [delivered] Preserve the fixed 2px header divider, distinct untitled work area, full Markdown reports and user identity beneath its right avatar.

## Decisions and open questions

The user selected Light run box after comparing it with Light response box and Open response. Include the latest header refinements in the implementation. Use 14px corners and 20px padding (14px on narrow screens), with no card border or shadow. Preserve the 800px maximum text/composer width by allocating card padding outside that reading width. The header line extends slightly right within the card padding and never crosses the avatar. Pending and failed/cancelled runs use the same card and stable timeline positions.

## Checkpoints and remaining work

Delivered the selected run box and the left-aligned header with standard chevron. Frontend build, controlled browser checks at 1600px, 390px and 320px, panel-open geometry, keyboard disclosure, icon states, final-text deduplication, user identity placement and pending/cancelled work passed; see tests.jsonl. The final response retains its 800px text maximum aligned with the composer. Canonical documents match the task drafts and code; documentation links and whitespace checks passed. No backend behavior changed. Unrelated .claude/ files are preserved.
