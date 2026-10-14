# Group chat header colors

Status: complete
Task start commit: e68fce9e55720ad0b2c7cd2ad8f321f8622f3632
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Give the full-width header band a pale tint derived from the member-colored divider.
- [delivered] Use status colors independently of sender identity: green completed, red failed/interrupted, neutral dark working/cancelled; remaining metadata and chevron stay neutral dark.

## Decisions and open questions

Tint the header with 7% member color mixed with white. Preserve the compact 8px top inset, rounded top corners, fixed 2px edge-to-edge divider, outside avatars, left-aligned metadata and reading/composer geometry. Cancelled represents user stop, so its status uses neutral dark text; failed/interrupted use red. Textual status remains present so color is supplementary.

## Checkpoints and remaining work

Delivered the tinted header band and status-based text colors. Frontend build, desktop/390px/320px and panel-open geometry, completed/failed/working/cancelled colors, keyboard/chevron disclosure, stable divider and reading/composer alignment passed; see tests.jsonl. Canonical documents match drafts and code; links/whitespace checks passed. Unrelated .claude/ files are preserved.
