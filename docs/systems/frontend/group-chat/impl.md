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

GroupChat wraps entries in a centered group-timeline. Each member/user entry uses three grid columns: left avatar gutter, padded run surface, right avatar gutter. The member identity stack occupies the left gutter. group-run-card encloses group-run-area and group-member-body with 14px radius, neutral #f6f7f6 fill, 8px top padding and 20px side/bottom padding (14px narrow), and no outer border or shadow.

The run area is a wrapping flex row aligned left with center alignment and a 6px gap. group-run-info is a passive div containing status, duration and start time. The adjacent group-work-toggle is the only disclosure button, containing Work followed by a Glyph chevron. Shared group-run-pill styles set 24px minimum height, 11px text, 16px line-height, 2px/9px padding and fully rounded ends. Both use #e9ede8 fill and #303733 text. Timing remains neutral; data-status on the info tag colors completed #3d7850 and failed/interrupted #b04b43. Sender identity and private work’s subdued accent retain member color. No header tint, divider pseudo-element or line-width variable remains.

The button retains aria-expanded and the controlled private-history ID; its accessible label identifies the member and show/hide action. CSS rotates its 12px standard chevron 90 degrees while expanded. Native click/keyboard activation controls the existing expansion state, keyed by run identity. Its focus outline remains visible; coarse pointers get a vertically enlarged transparent hit area. The following body mounts untitled, distinctly shaded WorkingHistory before the full Markdown final or terminal explanation. Stored status/timestamps, private inspection and final-reference projection are unchanged.

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
