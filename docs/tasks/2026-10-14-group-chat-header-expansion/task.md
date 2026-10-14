# Group chat header expansion

Status: complete
Task start commit: 24de69d484cd34347eb9aa707cab49e6a55c1d74
Review boundaries: frontend group-chat presentation and its parent frontend contract.

## Design outcomes

- [delivered] Remove the header box/fill and top/side borders; use one thicker colored bottom separator.
- [delivered] Keep expanded private work inside the run-header area, before its bottom separator, including pending/running work.
- [delivered] Extend the separator across the complete message area including the avatar gutters, slightly beyond its edges, without changing the reading/composer width.

## Decisions and open questions

Use a 2px member-colored line, extending 12px beyond each message-grid edge (8px on narrow screens). Header metadata and working content stay aligned with the reading column. The expandable area includes the identity gutter so its bottom line stays below both the identity and expanded work. The final response remains outside that area, below the separator. The incomplete “pending” clause is interpreted as applying this same grouping to running/pending work. No additional pending mode or scheduling behavior is introduced.

## Checkpoints and remaining work

Implemented the unboxed header and integrated working expansion, with a full-message 2px bottom separator extending 12px per side (8px on narrow screens). Controlled browser checks cover collapsed/expanded states, pending work and cancellation, keyboard disclosure, final-text deduplication, desktop/mobile and panel-open geometry without page overflow. Canonical docs match the delivered hierarchy. Build and documentation/whitespace checks provide the commit gates; the Task-ID trailer identifies this checkpoint. Unrelated .claude/ files are preserved.
