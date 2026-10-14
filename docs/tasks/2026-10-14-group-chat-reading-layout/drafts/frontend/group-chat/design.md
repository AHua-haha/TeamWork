<!-- Task proposal; current contract is under docs/systems/ -->
# Workspace group chat

## Purpose and boundary

Let the user converse with the workspace team, read accepted final responses as long-form documents, and inspect each member's folded working history. The backend owns shared publication, triggering, execution, stored context and history. The frontend presents those records and user actions.

This contract includes the approved UI defaults.

## Inputs and preconditions

- One workspace group transcript, author-attributed shared messages, member activation states and current team records.
- Backend-persisted response reservations, identifying the activation and its stable timeline position. The backend persists and exposes this state to every client.
- User entries store their input. Completed member entries reference immutable agent-history final messages and the corresponding working-history range. Backend reads resolve the accepted final text for display; expanded work reads that activation's private range.
- A member's accepted final response identifies its author and run. Run states provide start/end timestamps for elapsed duration.
- Private member history and live activity can be read for the corresponding run when the user expands its working section.
- Current design, team and file views remain available in the existing right panel. Design-version UI stays deferred.

## Outputs and observable effects

### User messages

- Position user messages on the right-hand side of the chat.
- Preserve their backend-assigned timeline positions relative to reserved member response sections.
- Use a subtle bubble background with left-aligned multiline text. A user avatar sits outside the bubble on its right, aligned with its top.

### Member response sections

- As soon as a mention is accepted and its member activation is created, show that member's response section and reserve its timeline position. Default Lead activation uses the same rule. Refused publications create no response sections.
- The reserved section immediately identifies the member and shows its folded working section. Working content updates in that section while the member runs.
- When its final response is accepted, display the complete response in the same reserved section. Keep its identity, relative timeline position and expansion state; do not append a second section for the final response.
- Multiple accepted activations reserve separate sections in a deterministic backend order. Each section progresses independently; completion order does not change their positions. Later user messages and new activation sections are appended after existing reservations.
- Refreshing the page or opening another client reconstructs the same reserved order from persistent backend records.
- Completion updates an existing entry and is observed even when its reserved position precedes newer entries. Display ordering and incremental change synchronization have distinct positions.
- Display every accepted final response completely as rendered Markdown. There is no default excerpt, maximum-height crop, or Read more control around the final response.
- Center a constrained reading column matching the proportions of the supplied Codex reference. Long Markdown fills that column. The column shrinks when the pane is narrower, including when the right panel is open; it never widens the page. The composer aligns with the same column.
- Each member response is an unboxed section. Its outer area has no bubble/card border, colored background or full-height sender stripe.
- Place the member avatar in a left gutter outside the response area, aligned with the sender name at the top. The name stays at the beginning of the response area, using member color. Identity is also readable as text; color alone is insufficient. Member color is stable for the same member identity, and historical author names remain as published.
- The sender name, work disclosure and Markdown body share the reading-column left edge. The avatar occupies its own outside gutter; it does not sit inside the response body. Code blocks and tables can scroll horizontally within their own bounds; they do not widen the page.
- Separate responses with ordinary spacing. A final response stays visible when working history is collapsed or expanded.

### Folded working history

- Above the final response, show a subdued disclosure row with elapsed work duration, following the supplied reference screenshots. This section is collapsed by default.
- Expanding it reveals only that member activation's stored working messages and tool activity. It can be collapsed again; expansion does not start or cancel a member run.
- Accepted final-response text is displayed once in the main response body. Its private-history copy is not repeated as a second final answer inside the fold. Relevant working content associated with that response may remain inspectable.
- Working messages retain their private inspection identity. They are not appended to the shared transcript, converted into new shared messages, or included in another member's model context.
- The same member's earlier or later activations are not mixed into this fold.
- Stored working-range boundaries use stable private message history and remain valid after model-context compaction. Pending activations use their start boundary and live run history until the end boundary is finalized.
- Loading or failure of the expanded history affects that section only; the accepted final response remains readable and the history section offers retry.

## Failure behavior

Private inspection failure does not remove or replace shared messages. Failed, cancelled or interrupted activations may have no accepted final response; their activity must not be presented as a fabricated shared answer. Show the terminal status and error, where available, in the retained member section.

## Guarantees and limits

- Display order is the backend's persisted timeline reservation order. The frontend replays entry changes with their independent change cursor. Group-publication positions govern shared message delivery; they do not move reserved sections.
- A reservation describes a response section and activation state. The backend still shares only accepted messages with member contexts; private work remains private.
- User inspection of working history preserves the backend's distinction between shared communication and member execution context.
- The timeline feed resolves complete accepted final responses. Live private working activity uses the separate per-run interface.
- Member identity appears at the beginning of the section; long report bodies remain neutral and fully available for reading.
- Solo-agent presentation remains outside this workspace group-chat change.

## Acceptance examples

1. Backend publishes a report with headings, lists, code and a table. It fills the centered reading column without an outer box; Backend’s avatar is outside that column on the left and its name identifies it.
2. The report shows a collapsed duration row above it. Expand to inspect Backend's commentary/tool activity; the final report remains fully displayed below.
3. Backend has completed several earlier runs. Expanding this report exposes only its own activation's working history.
4. The user mentions Backend and Frontend. Both response sections appear immediately in their reserved order. Frontend finishes first and fills its own section; Backend later fills its earlier section. Neither changes position.
5. Private history cannot be loaded. Keep the report readable and show a retry action inside the expanded working section.
6. Backend is working when the user sends a later message. Backend's response section already precedes that message. Its eventual final response fills that section in place.

7. On a wide pane the response and composer stop growing together; avatars stay outside their edges. Open the workspace panel or use a narrow screen: the reading column shrinks without overlap or horizontal page scrolling, and user avatars remain on the right.

## Composer and controls

- Enter submits; Shift+Enter inserts a newline. User drafts remain editable during member work. Show @ suggestions with current names and working/unavailable status; unavailable suggestions cannot be selected. Manually typed mentions are validated by the backend.
- A refused send preserves draft and discussion reference and displays the reason beside the composer. An accepted send clears the submitted draft/reference without erasing edits made during submission.
- Model settings are per member in Team, with no model selector implying one model for the entire group. Settings changes apply to subsequent runs.
- Chat-level Stop requests cancellation of current group work. Existing entries, completed effects and inspectable history remain.
- Lost group connections reconnect from the last contiguous change cursor. Submission acknowledgements can show entries immediately but cannot advance that cursor or overwrite newer versions.
- Follow only expanded private sections. Final responses remain visible if private inspection fails, with section-local retry.
- Existing prototype messages import in their original publication order; newly admitted activations use persisted reservation order.
