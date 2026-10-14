# Group chat reading layout

Status: complete
Task start commit: 94e254e58d777eba33638b8c7fe6150601eb9366
Review boundaries: workspace group chat presentation and its frontend parent.

## Design outcomes

- [delivered] Center a constrained response reading column with proportions matching the user’s Codex screenshot; align the composer with it.
- [delivered] Place member avatars in a left gutter outside the response body, and user avatars on the right outside their bubbles.

## Decisions and open questions

Use 800 CSS pixels as the maximum response/composer width inferred from the supplied image. The screenshot is a visual reference, not a source of exact app CSS. Symmetric gutters keep the body centered; smaller panes shrink the column and gutters without page overflow. Member name/color and full unboxed Markdown, folded work, right-side bubbles and persisted ordering remain.

## Checkpoints and remaining work

Implemented centered response/composer widths and outside avatars. Browser geometry checks at 1600px (panel open/closed) and 390px confirm the reading cap, exact composer alignment, outside avatar positions and no horizontal overflow. The production frontend build passes. Canonical frontend and group-chat documents agree with the delivered layout. The task trailer identifies the resulting commit. Existing unrelated .claude/ files remain untouched.
