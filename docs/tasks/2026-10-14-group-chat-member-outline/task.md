# Member outline response treatment

Status: complete
Task start commit: 942f3e0c19239f46020ef4ade917e0056246c76e
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Implement the selected Member outline: white run surface with a thin darker member-colored perimeter.
- [delivered] Give Work a soft member-colored fill and matching outline while keeping the status tag neutral and current semantic text colors.
- [delivered] Preserve compact aligned 24px pills, outside avatar/name identity, full Markdown and reading/composer alignment.

## Decisions and open questions

Use a 1px outline mixed from 40% member color and white, darker than the preview's 22%. Work uses a 9% member-color fill and the same outline (15% fill on hover). Keep 14px card corners, no shadow, and no long header divider or tinted header band. Account for card border width outside the 800px text maximum so it remains aligned with the composer. Compensate Work padding for its new border so pill geometry stays unchanged.

## Checkpoints and remaining work

Delivered the white Member outline surface, darker 40% member-colored border and softly tinted outlined Work pill. Build, desktop/390px/320px and panel-open checks passed, including border identity by member, 24px pill alignment, keyboard/click disclosure, passive timing tag, semantic status colors, private-work/final separation, no overflow and preserved 800px reading/composer maximum. Canonical documents match drafts and code; links/whitespace passed. See tests.jsonl. Unrelated .claude/ files are preserved.
