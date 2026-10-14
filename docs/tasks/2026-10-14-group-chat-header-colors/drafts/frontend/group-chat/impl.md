<!-- Task proposal; current contract is under docs/systems/ -->
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

GroupChat wraps entries in a centered group-timeline. Each member/user entry uses three grid columns: left avatar gutter, padded run surface, right avatar gutter. The member identity stack occupies the left gutter. A group-run-card in the middle column encloses group-run-area and group-member-body. Its 14px radius, neutral #f6f7f6 fill and 20px side/bottom padding (14px on narrow screens) realize the selected Light run box without an outer border or shadow. group-run-area owns the 8px top inset and side padding, extends to the card edges with negative side margins, and has rounded top corners. Its background mixes 7% member color with white. Its bottom pseudo-element supplies the fixed 2px member-colored separator with left/right zero at the card edges, excluding the avatar gutter. The following body mounts WorkingHistory before the full Markdown final or terminal explanation. Private work has no visible title and uses a slightly darker neutral fill, inset padding and subdued left accent. Expanding work does not affect header/divider geometry.

The header button groups status, elapsed duration, start time and chevron on the left, wrapping on very narrow panes. It has no status dot or auto spacer. The button exposes the persisted run status in data-status. CSS colors completed status #3d7850 (green), failed/interrupted #b04b43 (red), and working/cancelled plus other metadata #303733 (neutral dark). Sender color remains on the identity, tinted band and divider. Glyph's chevron path provides a standard line icon; CSS rotates it 90 degrees when aria-expanded is true. The button remains keyboard-accessible with its existing focus underline and controlled history ID. Expansion state is keyed by run identity. Stored status/timestamps, private inspection and final-reference projection remain unchanged.

User bubbles contain only message text and align right within the middle column, inset by the run padding so their right edge aligns with report text. A right-gutter identity stack places the avatar above the existing You label. Identity stacks share group-identity and group-identity-name styling; the prototype has no account/profile name source. styles.css keeps the 800px maximum text width by adding both card padding and avatar gutters to the timeline maximum. Composer side padding includes those same offsets and its maximum stays 800px. Responsive variables shrink padding and gutters. Markdown.tsx and markdown-parser.ts render reports fully; code and tables retain contained horizontal scrolling. Tool activity stays subdued.


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
