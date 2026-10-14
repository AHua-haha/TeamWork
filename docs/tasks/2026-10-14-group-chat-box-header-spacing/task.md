# Run box header spacing

Status: complete
Task start commit: 98f96c2a1994ee7fd9fd69eedfba0b808d0edf67
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Move run metadata closer to the box top by reducing top padding to 8px.
- [delivered] Extend the fixed 2px colored header divider from the left box edge to the right box edge.

## Decisions and open questions

Keep side/bottom padding at 20px (14px narrow), outside avatars, left-aligned metadata/chevron, untitled working section and 800px reading/composer maximum. The divider expands through side padding but remains inside the box and separate from the avatar gutter. No remaining design choice is required.

## Checkpoints and remaining work

Delivered 8px top padding and the full-width fixed divider. Build, desktop/390px/320px browser geometry, panel-open layout, chevron/keyboard disclosure, reading/composer alignment and canonical/draft parity checks passed; see tests.jsonl. The separator meets both box edges and excludes the outside avatar in collapsed and expanded states. Canonical documents are promoted with the CSS. Unrelated .claude/ files are preserved.
