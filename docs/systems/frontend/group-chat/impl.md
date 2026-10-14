# Workspace group chat implementation

## Contract

[Workspace group chat design](design.md). The agreed UI defaults are included.

## Responsibilities and decomposition

`GroupClient` in group-client.ts owns accepted group records, persisted response reservations, contiguous change-cursor tracking, synchronization, activity snapshots and submission/stop commands. Workspace chat presentation renders full-width Markdown response sections and author headers, ordered by the backend's timeline positions. Existing design/team/file panel capabilities remain composed beside it. Solo AgentClient behavior stays separate.

A per-run inspection view owns private history loading and expansion state. It uses the existing private follow protocol and projects working messages/tool outcomes for the selected activation. Collapsed sections can derive duration/status from group activity without loading every private trace.

## Coordination and data flow

Create member sections from accepted backend reservations keyed by run/slot identity. Group entries directly identify the member/run; finalized references identify the accepted assistant record. Render the accepted final in that existing section. Keep backend timeline order independent from the change cursor used for synchronization. Do not infer reservations from local send time, timestamps, response text, state-array order or member display name.

The backend admission transaction reserves recipient response sections and exposes them in history/follow and POST acknowledgement. Group history stores user input and member reply entries; final publication pins a reference to the exact immutable private assistant message in its existing entry and records working-range boundaries. Accepted final text is resolved for shared delivery and frontend reads. Rejecting admission creates no reservation. Persist order so reconnecting clients reconstruct the same layout, and notify completion with a change cursor independent of display order.

Private follow synchronization includes the agent's history prefix through the selected run. Filter completed records by `record.runId`, not the event envelope's selected run ID, and include live records only for that activation. Private and group cursors remain independent. Keep earlier private records out of the expanded section.

Use the pinned final-message reference supplied by the backend to identify the accepted candidate. Render its resolved final text in the main section and project working history using the entry's stable range; hide accepted final text in the working projection while retaining any separate inspectable working content. Do not infer the reference from the member's latest message, mutate source records or delete private history. Record the start boundary at activation and fix the end at successful completion or terminal failure.

Render with a compact header followed by a block-width body, using Markdown.tsx and markdown-parser.ts. The outer section has no bubble/card treatment or permanent avatar rail. Disclosure rows and tool activity remain subdued. Expansion state is keyed by run identity so later presentation changes can preserve it.

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
