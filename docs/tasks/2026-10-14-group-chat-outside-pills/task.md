# Outside pills and light response fill

Status: complete
Task start commit: 20ee1c05691efd1a48b3e8a52ce8b96ee34b0ed5
Review boundaries: [Group chat](drafts/frontend/group-chat/design.md), [Frontend](drafts/frontend/design.md).

## Design outcomes

- [delivered] Move both status/timing and Work pills above the message box, with the pill row’s left edge aligned to the box’s left border.
- [delivered] Give the message box a very pale member-colored fill while retaining the darker member outline.
- [delivered] Keep expanded work inside the box; preserve avatar centers relative to the box, equal gaps, message right edges and full reports.

## Decisions and open questions

Implement the selected Both pills outside preview. Use an 8px gap above the box and a 4% member-color/white body fill. The existing 40% member outline and compact pill styles remain. A two-row message grid places pills in row one, with the identity and card in row two so avatars stay beside the actual message box. Card content has an 18px top inset; remove the obsolete leading report/work margin and retain spacing between expanded work and final content. Empty pending cards keep at least the reference avatar-slot height and do not fabricate a report. Keep the 800px text/composer maximum.

## Checkpoints and remaining work

Delivered both pills outside above the pale member-tinted message box, with the row aligned to its left border. Build and desktop/390px/320px plus panel-open browser checks passed. Measurements verify outside containment, exact left alignment, 8px box gap, retained avatar reference centers/gaps and message right edges, full report/composer width, keyboard disclosure and private-work/final separation. Pending work stays inside its reserved box and cancellation preserves the entry without a fabricated final. Canonical docs match drafts and code; links/whitespace passed. See tests.jsonl. Unrelated .claude/ files are preserved.
