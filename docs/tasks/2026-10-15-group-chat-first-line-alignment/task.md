# Align response first lines with avatar centers

Status: complete
Task start commit: 6b7c91428116aa979bb2b4315450c5bd55be439a
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Align the center of the first paragraph or heading line of a folded response with the member avatar center, including wrapped paragraphs and narrow layouts.
- [delivered] Keep the divider on the message top, pills above it, existing avatar centers/sizing, and the reading/composer alignment.

## Decisions and open questions

The previous 18px response top padding positioned the first line below the avatar center. For responses beginning with a paragraph or heading, replace it with a first-block inset derived from that block's actual CSS line height (1lh), the shared avatar reference diameter and the 1px divider. This handles heading font sizes without fixed offsets. Other Markdown blocks and expanded work retain their existing spacing. No open choices.

## Checkpoints and remaining work

Delivered line-height-based first-paragraph/heading spacing with unchanged avatar centers and divider/pills. Frontend build and controlled desktop/390px browser checks passed for wrapped Chinese/English paragraphs and h1–h6 first-line centers (within 0.1px of avatar center), shared user/member avatar reference offsets, divider and pill placement, horizontal gaps and reading/composer alignment. Expanded work remains below the divider and folding restores the aligned final. Screenshots visually reviewed; canonical/draft parity, links and whitespace passed. See tests.jsonl. Unrelated .claude/ files preserved. No remaining work for this correction.
