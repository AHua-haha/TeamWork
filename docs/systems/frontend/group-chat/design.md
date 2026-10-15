# Workspace group chat

## Purpose and boundary

Let the user converse with the workspace team, follow each active member's text and tools as an ordered stream, read accepted final responses as long-form documents, and expand earlier work when needed. The backend owns shared publication, triggering, execution, stored context and history. The frontend presents those records and user actions.

## Inputs and preconditions

- One workspace group transcript, author-attributed shared messages, member activation states and current team records.
- Backend-persisted response reservations, identifying the activation and its stable timeline position. The backend persists and exposes this state to every client.
- User entries store their input. Completed member entries reference immutable agent-history final messages and the corresponding working-history range. Backend reads resolve the accepted final text for display; active output and expanded completed work read that activation's private range. The backend identifies the exact accepted final content so it can be removed from the working projection without guessing from text.
- A member's accepted final response identifies its author and run. Run states provide start/end timestamps for elapsed duration.
- Private member history and incremental activity can be read for the corresponding run through backend APIs backed by persisted storage. Readable output has ordered thinking, text and tool-use blocks, with tool results matched to their calls. Thinking is hidden in this UI. Active output remains observed across disclosure changes; completed history is read on demand.
- Current design, team and file views remain available in the existing right panel. Design-version UI stays deferred.

## Outputs and observable effects

### User messages

- Position user messages on the right-hand side of the chat.
- Preserve their backend-assigned timeline positions relative to reserved member response sections.
- Use a subtle bubble background with left-aligned multiline text. A user avatar sits outside the bubble on its right, anchored near its start, with the user identity name beneath it like member names. In this prototype the user identity is You. The bubble contains only the submitted message text. Its right edge aligns with the member response area’s right edge. User and member avatars use smaller visible circles around the same centers established by the single-line message reference. Shrinking the circles does not move the message areas, identity names or their centers. A one-line bubble and its avatar retain the same vertical center; longer messages retain the avatar anchor near their start. Both sender types have equal visible avatar gaps to their message areas.

### Member response sections

- As soon as a mention is accepted and its member activation is created, show that member's response section and reserve its timeline position. Default Lead activation uses the same rule. Refused publications create no response sections.
- The reserved section immediately identifies the member. As it works, display ordinary text and compact tool sets in an initially visible activity area, preserving their order and streaming updates. Thinking remains hidden. No advance working/final classification is required to display text.
- When its final response is accepted, display the complete response in the same reserved section. Keep its identity and relative timeline position; do not append a second section for the final response. On this transition, fold preceding work once and keep the accepted final fully visible. The user can reopen Work afterward.
- Multiple accepted activations reserve separate sections in a deterministic backend order. Each section progresses independently; completion order does not change their positions. Later user messages and new activation sections are appended after existing reservations.
- Refreshing the page or opening another client reconstructs the same reserved order from persistent backend records.
- Completion updates an existing entry and is observed even when its reserved position precedes newer entries. Display ordering and incremental change synchronization have distinct positions.
- Display every accepted final response completely as rendered Markdown. There is no default excerpt, maximum-height crop, or Read more control around the final response.
- Center a constrained reading column matching the proportions of the supplied Codex reference. Long Markdown fills that column. The column shrinks when the pane is narrower, including when the right panel is open; it never widens the page. The composer aligns with the same column.
- Each member run shows its status/timing and Work pills above an open response area containing the active activity flow, or folded earlier work and the complete accepted final response, or a terminal explanation. The response has gentle padding, no background, no enclosing border, no shadow and no full-height sender stripe. A thin light divider below the pills lies exactly on the response area’s top edge and spans its width without crossing the avatar gutter. The member avatar keeps the same top-edge reference and fixed center rule as the user avatar beside its bubble. With work folded, the first paragraph or heading line is vertically centered on the member avatar, including when that line wraps into a longer message. The avatar and name remain outside the response area.
- Place the member avatar in a left gutter outside the response area, with its name beneath the avatar using member color. Long names wrap inside the gutter. The response body has no separate agent-name row above it. Identity is also readable as text; color alone is insufficient. Member color is stable for the same member identity, and historical author names remain as published.
- Expanded work and Markdown body share the padded reading-column left edge within the response area. The outside pill row’s left edge aligns with the response area’s left edge. Response padding is additional to the maximum text width, so long reports retain the accepted reading width. The compact pill header sits above the response area, with a small gap. Its two capsules occupy only their content width, leaving the right side open: the borderless status/timing tag uses muted semantic status colors, while Work uses a transparent neutral background and faint gray border. Work gains a subtle neutral fill on hover or when expanded and retains a clear keyboard focus ring. There is no tinted header band. The light divider stays on the response area’s top edge, below the pills and above expanded work, remaining fixed when work expands. The avatar occupies its own outside gutter; it does not sit inside the response body. Code blocks and tables can scroll horizontally within their own bounds; they do not widen the page.
- Separate member responses with spacing and the light header divider. Expanding work leaves the compact header controls in place. A final response stays visible when working history is collapsed or expanded.

### Folded working history

- Above each response area, show two compact capsules grouped on the left: a read-only status/timing tag and a Work disclosure button. The tag contains textual status, elapsed duration and start time. The Work button contains its label followed by a standard chevron, right-facing folded and downward expanded. There is no status dot or tinted band; a thin light divider spans the response width at the response area’s top edge below the capsules. The capsules have matching compact heights and vertically centered content, sit directly beside one another when space permits, and wrap on narrower panes.
- Completed status has a pale green background with muted green status text; failed/interrupted status has a pale red background with muted red status text. Working/cancelled status uses a light neutral background and muted gray text. Duration, start time and the folded Work button stay muted gray. The status pill has no border. Sender identity color remains on the outside avatar/name. Color supplements the textual status.
- Only the Work button toggles inspection, by click or keyboard; the status/timing tag is passive. Work is initially visible while a run is active, so text streams visibly and tool sets update in the same flow. The user may collapse it during execution without stopping updates. When an accepted final is confirmed, preceding work folds automatically once. Expanding a completed run reveals only its earlier visible text and tool sets in an untitled compact neutral list below the header divider and above the complete final report. Thinking remains hidden in every disclosure state. Completed collapsed sections do not keep a private follow connection.

- Accepted final-response text is displayed once in the main response body. Its private-history copy is not repeated as a second final answer inside the fold. Relevant working content associated with that response may remain inspectable; thinking is excluded from this presentation even if retained in stored history.
- Working messages retain their private inspection identity. They are not appended to the shared transcript, converted into new shared messages, or included in another member's model context.
- The same member's earlier or later activations are not mixed into this fold.
- Stored working-range boundaries use stable private message history and remain valid after model-context compaction. Pending activations use their start boundary and live run history until the end boundary is finalized.
- Loading or failure of the expanded history affects that section only; the accepted final response remains readable and the history section offers retry.

## Failure behavior

Private inspection failure does not remove or replace shared messages. Failed, cancelled or interrupted activations may have no accepted final response; their activity must not be presented as a fabricated shared answer. Keep their visible activity inspectable, without the successful-final automatic fold, and show the terminal status and error where available. Truncated text or a closed connection alone cannot establish final acceptance.

## Guarantees and limits

- Display order is the backend's persisted timeline reservation order. The frontend replays entry changes with their independent change cursor. Group-publication positions govern shared message delivery; they do not move reserved sections.
- A reservation describes a response section and activation state. The backend still shares only accepted messages with member contexts; private work remains private.
- User inspection of working history preserves the backend's distinction between shared communication and member execution context.
- The timeline feed resolves complete accepted final responses. Live private working activity uses the separate per-run interface.
- Member identity appears at the beginning of the section; long report bodies remain neutral and fully available for reading.
- Solo-agent presentation remains outside this workspace group-chat change.

## Acceptance examples

1. Backend publishes a report with headings, lists, code and a table. It fills the centered reading column in an open response area with no background or enclosing border, below a thin light header divider; Backend’s avatar is outside that column on the left and its name identifies it.
2. The agent name appears under its avatar. A compact Completed/duration/start-time tag and adjacent Work button sit above the open response area, aligned with its left edge. Click Work to inspect Backend's commentary/tool activity below the pills; its chevron turns downward and the final report remains fully displayed below it.
3. A paragraph or heading begins a folded response. Its first line is horizontally level with the avatar center; longer content continues below that line without recentering the avatar. This remains true on narrow panes. Backend has completed several earlier runs. Expanding this report exposes only its own activation's working history.
4. The user mentions Backend and Frontend. Both response sections appear immediately in their reserved order. Frontend finishes first and fills its own section; Backend later fills its earlier section. Neither changes position.
5. Private history cannot be loaded. Keep the report readable and show a retry action inside the expanded working section.
6. Backend is working when the user sends a later message. Backend's response section already precedes that message. Its eventual final response fills that section in place.

7. On a wide pane the response and composer stop growing together; avatars stay outside their edges. Open the workspace panel or use a narrow screen: the reading column shrinks without overlap or horizontal page scrolling, and user avatars remain on the right.

## Composer and controls

- Enter submits; Shift+Enter inserts a newline. User drafts remain editable during member work. Show @ suggestions with current names and working/unavailable status; unavailable suggestions cannot be selected. Manually typed mentions are validated by the backend.
- A refused send preserves draft and discussion reference and displays the reason beside the composer. An accepted send clears the submitted draft/reference without erasing edits made during submission.
- Team shows accepted model settings per member read-only. Workspace models configures available choices/default for initialization; the lead manages member selections through file submission. There is no group model selector. Active runs retain their starting settings.
- Chat-level Stop requests cancellation of current group work. Existing entries, completed effects and inspectable history remain.
- Lost group connections reconnect from the last contiguous change cursor. Submission acknowledgements can show entries immediately but cannot advance that cursor or overwrite newer versions.
- Follow active member runs regardless of expansion and load completed private work on demand. Final responses remain visible if private inspection fails, with section-local retry.
- Existing prototype messages import in their original publication order; newly admitted activations use persisted reservation order.

## Unified active stream and final transition

- Model each activation's readable output as ordered thinking, text and tool-use blocks, with results associated with their calls. This is a presentation model across provider API formats.
- Do not render thinking blocks, summaries, signatures or reasoning disclosure controls in the message UI. Hiding thinking does not remove it from stored history or the agent's context.
- Render every ordinary text block progressively as Markdown in the same activity flow. Text does not disappear or wait for completion merely because its final role is unknown. Show tool activity at its position in that flow.
- A single model response or one text block finishing does not necessarily finish the activation. Later tools or responses continue in the same reserved member section. The frontend does not require a special agent completion tool or guess intent from prose, currently absent tool calls, the last visible block, or connection closure.
- The backend identifies the accepted final text and its exact source within persisted private history. This may be known only after the model response finishes. The final layout is established when that candidate is accepted for group publication; an early provider phase or preview alone is not shared acceptance.
- On acceptance, keep the complete final report in this same reserved section and collapse preceding visible work into Work. Do not restart text animation, append another member response, duplicate the final inside Work, or move the section relative to other entries. Reuse already streamed content where it matches the authoritative accepted report.
- The automatic final fold happens once. Later updates or reconnections do not repeatedly close Work after the user reopens it. A page opened on an already completed run starts with Work collapsed and the accepted final fully visible.
- A response with only final text settles into the final report with empty work. An empty expanded work area has no placeholder, loading sentence or colored block. A refused publication retains its candidate as private activity and the same activation can continue; it does not create an accepted final or trigger the successful-final fold.
- Folding hides visible working output; it does not change the source, stop streaming, publish private output, or merge different activations. Expanding after completion restores preceding text and tool sets in their original order.
- Private follow reconnects and chunk gaps use completed-history reconciliation. Missing partials may be reconstructed from stored records. An inspection failure remains local and does not hide the accepted final.
- Streaming growth follows the bottom while the user remains near it. Scrolling up preserves the reading position. Final folding preserves a useful viewport anchor in the same member section rather than jumping to a different message.

## Collapsible tool sets

- Combine consecutive tool calls into a compact collapsible tool set. Calls in a single tool-only model response can share a set. Subsequent model responses with no nonempty displayed text can extend that same set.
- A nonempty displayed text block separates the preceding and following tool sets. Hidden thinking, empty text blocks and tool-result records do not separate sets. A text message containing no tools still separates sets.
- Grouping follows visible block order. If additional streamed text introduces a boundary, the presentation reflects that boundary; the original records are never permanently merged or rewritten.
- Match each result, running state and failure to its own call. Preserve call order even when parallel tools finish in a different order. Group only within the same member activation; never aggregate across another member, run or user message.
- Tool sets start collapsed, including during an active run. Their compact muted summary identifies the work (for example commands, reads or searches) and exposes running/failure state where needed. Expanding reveals compact individual tool rows with action icons, concise argument summaries and chevrons. Full arguments and results remain available through row disclosure.
- Sets can be expanded or collapsed while streaming; later calls and results update the existing set without resetting the user's choice. Tool-set disclosure is independent of whole-Work disclosure.
- Match the supplied Codex reference: text in an open flow; muted, closely spaced tool rows; a compact aggregate summary; standard chevrons; no enclosing cards, stale colored background or per-tool outer boxes. Retain clear keyboard focus, accessible disclosure labels and readable failure information.

## Additional acceptance examples

8. A member streams a thinking block, then text, then a command. Thinking is absent. Text appears progressively and a collapsed command set follows it. More text appears below that set in the same reserved response section.
9. One response contains two tool calls and no text; the next contains another tool call and no text. They appear in one tool set with three calls, even if hidden thinking or matched tool results occur between them.
10. A response streams text between tool calls. The text remains visible between two separate tool sets. The UI preserves this order after reload or when Work is reopened.
11. Text streams while the backend cannot yet classify it. A later tool call establishes that work continues; no final answer has been published and text stays in the activity flow. A later accepted final folds all preceding work and remains fully visible.
12. The final answer was already streamed before the completion signal arrived. Acceptance folds earlier work and leaves this answer visible once, without replaying it. Reopening Work exposes the earlier commentary and tools, while thinking and the accepted final are absent from that fold.
13. A member produces only final text. It streams visibly, becomes the accepted report and leaves no work placeholder. Another run fails after some tools: its failure status and activity remain available without a fabricated report or automatic successful-final fold.
14. Expand a tool set and let another tool finish. Its row updates in place, its siblings retain their order, and the set remains expanded. Finish the run, reopen Work, and the tool set can still be toggled independently.
15. Two members run concurrently. Each has its own streaming flow, tool sets and final transition; tool groups and activity never cross their reserved sections.
