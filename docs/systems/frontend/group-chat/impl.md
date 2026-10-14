# Workspace group chat implementation

## Contract

[Workspace group chat design](design.md). The agreed UI defaults are included.

## Responsibilities and decomposition

`GroupClient` in group-client.ts owns accepted group records, persisted response reservations, contiguous change-cursor tracking, synchronization, activity snapshots and submission/stop commands. Workspace chat presentation renders centered Markdown response sections with outside avatar gutters and author names, ordered by the backend's timeline positions. Existing design/team/file panel capabilities remain composed beside it. Solo AgentClient behavior stays separate.

A per-run inspection view owns private history loading and expansion state. It uses the existing private follow protocol and projects working messages/tool outcomes for the selected activation. Collapsed sections can derive duration/status from group activity without loading every private trace.

## Coordination and data flow

Create member sections from accepted backend reservations keyed by run/slot identity. Group entries directly identify the member/run; finalized references identify the accepted assistant record. Render the accepted final in that existing section. Keep backend timeline order independent from the change cursor used for synchronization. Do not infer reservations from local send time, timestamps, response text, state-array order or member display name.

The backend admission transaction reserves recipient response sections and exposes them in history/follow and POST acknowledgement. Group history stores user input and member reply entries; final publication pins a reference to the exact immutable private assistant message in its existing entry and records working-range boundaries. Accepted final text is resolved for shared delivery and frontend reads. Rejecting admission creates no reservation. Persist order so reconnecting clients reconstruct the same layout, and notify completion with a change cursor independent of display order.

Private follow synchronization includes the agent's history prefix through the selected run. Filter completed records by `record.runId`, not the event envelope's selected run ID, and include live records only for that activation. Private and group cursors remain independent. Keep earlier private records out of the expanded section.

Use the pinned final-message reference supplied by the backend to identify the accepted candidate. Render its resolved final text in the main section and project working history using the entry's stable range; hide accepted final text in the working projection while retaining any separate inspectable working content. Do not infer the reference from the member's latest message, mutate source records or delete private history. Record the start boundary at activation and fix the end at successful completion or terminal failure.

GroupChat wraps entries in a centered group-timeline. Each member/user entry uses three grid columns: left avatar gutter, padded run surface, right avatar gutter. The member identity stack occupies the left gutter. group-run-card encloses group-run-area and group-member-body with 14px radius, white fill and a 1px outline mixed from 40% member color with white, 8px top padding and 20px side/bottom padding (14px narrow), and no shadow.

The run area is a wrapping flex row with center alignment and a 6px gap. Its -9px left margin offsets the leading pill’s 9px content padding so status text aligns with the report column while the capsules stay inside the card. group-run-info is a passive div containing status, duration and start time. The adjacent group-work-toggle is the only disclosure button, containing Work followed by a Glyph chevron. Shared group-run-pill styles set 24px minimum height, 11px text, 16px line-height, 2px/9px padding and fully rounded ends. The info tag keeps left alignment when its text wraps on a narrow pane. The status tag uses #e9ede8 fill; Work uses a 9% member-color/white fill, 1px member outline and 1px/8px padding to compensate for its border. Hover raises Work fill to 15%. Both retain #303733 text. Timing remains neutral; data-status on the info tag colors completed #3d7850 and failed/interrupted #b04b43. Sender identity and private work’s subdued accent retain member color. No header tint, divider pseudo-element or line-width variable remains.

The button retains aria-expanded and the controlled private-history ID; its accessible label identifies the member and show/hide action. CSS rotates its 12px standard chevron 90 degrees while expanded. Native click/keyboard activation controls the existing expansion state, keyed by run identity. Its focus outline remains visible; coarse pointers get a vertically enlarged transparent hit area. The following body mounts untitled, distinctly shaded WorkingHistory before the full Markdown final or terminal explanation. Stored status/timestamps, private inspection and final-reference projection are unchanged.

User bubbles contain only message text and align right within the middle column without an extra margin inset, so their right edge aligns with the member card edge. The shared grid uses align-items:start so each avatar layout slot aligns with its message top edge; the avatar diameter is derived from shared user-bubble typography/padding tokens (14px × 1.65 + 2 × 12px, about 47.1px), matching the height of a single-line bubble. Both member and user avatar slots keep that diameter for longer messages. The avatar element scales visually to 80% around transform-origin:center, producing a roughly 37.7px visible circle while preserving its center, slot, name and surrounding layout. Gutters derive from the reference slot diameter plus a shared slot gap of 12px desktop or 8px narrow. Visible circle-to-box gaps increase equally by half the scaled size reduction. Initial glyphs use 18px before the same visual transform. A right-gutter identity stack places the avatar above the existing You label. Identity stacks share group-identity and group-identity-name styling; the prototype has no account/profile name source. styles.css keeps the 800px maximum text width by adding card padding, the 1px card border and avatar gutters to the timeline maximum. Composer side padding includes those same offsets and its maximum stays 800px. Responsive variables shrink card padding and the avatar gap. Narrow composer actions wrap, and the info capsule wraps text without losing its leading alignment. Markdown.tsx and markdown-parser.ts render reports fully; code and tables retain contained horizontal scrolling. Tool activity stays subdued.


## Verification

Check immediate reservation after accepted mention, parallel completions in reverse order, later user messages, final-response replacement in place, and identical ordering after reconnect/reload. Also check author identity through rename, run-specific filtering, final-text deduplication, private-history failure isolation, full Markdown rendering and overflow with the right panel open/closed. Browser review must compare collapsed and expanded working sections against the supplied visual references on desktop and narrow layouts.

## Concrete backend composition

MySqlStore owns chat timeline entries, immutable change records and a per-workspace clock. Publication locks workspace, then agents, then the timeline clock; terminal runtime writes lock agent then clock. Readers use repeatable-read snapshots. The final committed record identity is supplied to the team policy by RuntimePolicy.shouldContinue. TeamRunner handles admission and notifications, including terminal updates. Existing publication APIs remain for shared-context delivery; the new timeline APIs own display synchronization.

## Code map

- GroupClient: frontend/src/client/group-client.ts; group timeline reconciliation, commands and reconnect.
- GroupChat and WorkingHistory: frontend/src/ui/GroupChat.tsx; rendering, composer, private disclosure.
- Private projection: frontend/src/ui/group-work.ts; run/range filtering, tool-result pairing and accepted-text deduplication.
- MemberRunSettings: frontend/src/ui/MemberRunSettings.tsx; revision-checked per-member model edits.
- Integration: frontend/src/ui/WorkspacePage.tsx, useTeam.ts and TeamTab.tsx.
- Tests: frontend/test/group.test.ts and backend/test/integration/backend.test.ts.

## Decisions and constraints

Group entries and change cursors come from storage; private work is inspected separately. Composer and model settings have distinct scope. Existing Markdown rendering and Pi history clients are reused where their contracts fit, without a new model/runtime dependency. Exact animations and styling are presentation details.
