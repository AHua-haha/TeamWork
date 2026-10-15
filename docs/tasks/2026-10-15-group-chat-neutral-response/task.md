# Neutral borderless response boxes

Status: complete
Task start commit: 36ef6b66851ecc419ce65e71106228fc1f7647bf
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Remove member response box borders and give every member response the same neutral light background.
- [delivered] Preserve outside pills, distinct private work, avatar positions and reading/composer alignment.

## Decisions and open questions

Use #f6f7f6 for every response card, independent of member identity. Remove obsolete card-border geometry offsets along with the border. Retain member color on avatar/name and Work pill; keep user bubbles and status colors unchanged. No open choices.

## Checkpoints and remaining work

Delivered borderless response cards with a shared #f6f7f6 background. Removed obsolete border offsets while preserving the 800px reading/composer alignment, outside pill placement and avatar gaps/centers. Frontend build, desktop/390px/320px collapsed/expanded browser checks, panel-open geometry, shared fill across members/statuses, keyboard disclosure and canonical/draft parity/link/whitespace checks passed; see tests.jsonl. Desktop screenshot visually reviewed. Unrelated .claude/ files are preserved. No remaining design decisions.
