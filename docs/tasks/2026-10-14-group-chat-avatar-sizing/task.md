# Group chat avatar sizing

Status: complete
Task start commit: 961f5572d0c38e14d85b4c437b29dde0a44c346b
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Size user and member avatars from the height of a one-line user message box, aligning the avatar center with that reference box.
- [delivered] Keep this shared avatar size and top anchoring for multiline input, long reports and expanded work.
- [delivered] Preserve equal avatar gaps, matching message right edges and the 800px maximum reading/composer width.

## Decisions and open questions

A one-line user bubble is the common sizing reference: 14px type at 1.65 line height plus 12px padding above/below, about 47.1px. Derive avatar diameter from those same CSS values rather than a separate guessed size. Members use the same diameter; their private work and long reports do not change it. Derive gutters from diameter plus the accepted 12px desktop/8px narrow gap. Keep identities and names outside boxes. Narrow pill text can wrap with left alignment, and composer controls can wrap as the larger gutters reduce available width.

## Checkpoints and remaining work

Delivered avatars derived from the one-line user bubble height: measured 47.09375px with identical one-line bubble/avatar centers. Build and desktop/390px/320px plus panel-open browser checks passed, covering retained avatar size and top anchoring during multiline/expanded work, equal gaps, message right edges, compact pill wrapping, keyboard disclosure and 800px reading/composer maximum. The browser procedure resets view state and waits for the sidebar transition; a rerun blocked by retained panel state is recorded before the corrected procedure passed. Canonical docs match drafts and code; links/whitespace passed. See tests.jsonl. Unrelated .claude/ files are preserved.
