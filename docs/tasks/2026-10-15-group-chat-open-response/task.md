# Open responses with a light header divider

Status: complete
Task start commit: b8997ea790b425bd19baa910ad75a6cef1df8464
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Render member responses open, without a box background or surrounding border.
- [delivered] Add a thin light divider below the compact pills across the response area, excluding the avatar gutter. Keep it above expanded work and fixed when work expands.
- [delivered] Preserve user bubbles, compact pills, shaded private work and reading/composer/avatar alignment.

## Decisions and open questions

Use a 1px #e9ede8 header bottom border with 8px space between pills and divider. Keep the existing response padding and header-to-body gap to retain the reading column and avatar anchor. The response container becomes transparent with no corner treatment. No open choices.

## Checkpoints and remaining work

Delivered transparent open responses and a 1px #e9ede8 divider below the pills. Build and desktop/390px/320px plus panel-open browser checks passed: transparent backgrounds across members/statuses, divider width/color/placement, fixed position during expansion, preserved avatar centers/gaps, user right edges, reading/composer alignment and keyboard disclosure. Desktop appearance visually reviewed. Canonical/draft parity, relative links and whitespace verified; see tests.jsonl. Unrelated .claude/ files preserved. No remaining design decisions.
