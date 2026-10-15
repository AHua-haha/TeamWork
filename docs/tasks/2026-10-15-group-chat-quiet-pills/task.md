# Quiet pills with semantic run status

Status: complete
Task start commit: 5424f4acd83f38d1f3b747d4aef60abb4a823d22
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Use pale green completed and pale red failed/interrupted status pills, without borders, keeping duration/time muted gray.
- [delivered] Use a neutral transparent Work button with a faint border, subtle hover/expanded fill and visible keyboard focus.
- [delivered] Preserve compact geometry, avatar identity colors, open responses and the fixed light divider.

## Decisions and open questions

Completed: #f0f6f0 fill and #52765a status text. Failed/interrupted: #faf1f0 fill and #a3635c status text. Other statuses: #f5f6f5 fill and #727a73 text. Duration/time stay #727a73. Work: transparent fill, #e7eae6 border, #727a73 text; hover #f1f3f0 with darker text, expanded #eef1ed with dark gray text. Remove the obsolete member-outline token. Keep the keyboard focus ring. No open choices.

## Checkpoints and remaining work

Delivered muted semantic status backgrounds/text and neutral Work states, preserving the compact geometry and open response layout. Frontend build and desktop/390px browser checks passed for completed/failed/working/cancelled colors, metadata gray, faint Work border, hover/expanded states, keyboard focus/folding and no horizontal overflow. Failed early browser checks compared viewport coordinates across automatic scroll; the check now measures header position relative to its message and waits for font readiness. No product change was needed for those test failures. Screenshots visually reviewed; canonical/draft parity, links and whitespace passed. See tests.jsonl. Unrelated .claude/ files preserved. No remaining design decisions.
