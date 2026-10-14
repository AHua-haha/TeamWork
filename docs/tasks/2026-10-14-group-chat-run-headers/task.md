# Group chat run headers

Status: complete
Task start commit: 880992896f00c1114e4ffcbc0ebe437cb36bc2d7
Review boundaries: frontend group-chat presentation and its parent frontend contract.

## Design outcomes

- [delivered] Agent name sits beneath its avatar in the outside left gutter, removing the name row above response content.
- [delivered] Each member response starts with a member-colored run header that separates messages and toggles private work.

## Decisions and open questions

Header uses a subtle member-color tint and separator borders, with textual run status, elapsed duration, start time and disclosure arrow. It appears during work and after completion/failure/cancellation/interruption. Whole header is a keyboard-accessible disclosure button. The 800px reading/composer alignment and right-side user avatar remain. Long member names wrap in the gutter rather than overlap reports. No unresolved choice.

## Checkpoints and remaining work

Implemented the identity stack and colored run header. Controlled browser checks on desktop/mobile verify outside names beneath avatars, unchanged reading/composer alignment, header click/Enter/Space disclosure, accepted-final deduplication, start time/duration metadata and Working/Completed/Failed/Cancelled states without fabricated finals. Canonical docs match the delivered behavior. Production build and documentation audit provide the final commit gates. The Task-ID trailer identifies the checkpoint. Unrelated .claude/ files are preserved.
