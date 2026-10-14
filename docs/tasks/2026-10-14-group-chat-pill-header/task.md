# Compact group chat pill headers

Status: complete
Task start commit: c9b1c7a5d3401afb2d1c8e6a2aae137618114477
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Replace the tinted full-width header and divider with a passive status/timing pill and separate Work disclosure pill button.
- [delivered] Use compact 24px capsules, matching heights and vertical centers, with a 6px gap; align left and wrap when necessary.
- [delivered] Preserve semantic status colors, outside avatar/name stacks, full Markdown reports and per-run private inspection.

## Decisions and open questions

Interpret button-position feedback as placing Work directly beside the status pill, vertically centered with matching capsule geometry. Use 11px text, compact padding and a 12px standard chevron. Only Work toggles private inspection; the status tag is read-only. Retain the light run box, compact top inset, neutral pill fill, and 800px reading/composer maximum. On narrow panes capsules wrap without clipping. Touch pointers have an enlarged invisible Work hit area. This supersedes the prior header tint and full-width divider.

## Checkpoints and remaining work

Delivered the compact pill header with a passive status/timing tag and adjacent Work button. Build, desktop/390px/320px and panel-open checks passed, including matching 24px geometry, 6px adjacency, narrow wrapping, read-only tag behavior, standard chevron, keyboard disclosure, status colors, per-run trace/final separation and pending/cancelled states. The 800px reading/composer maximum is preserved. Canonical docs match drafts and code; link/whitespace checks passed. See tests.jsonl. Unrelated .claude/ files are preserved.
