<!-- Task proposal; current contract is under docs/systems/ -->
# Workspace group chat implementation

## Contract

[Group-chat design](design.md). Preserve ordered visible text/tool streaming, hidden thinking, exact accepted final selection, stable reservations and independent disclosures.

## Responsibilities and decomposition

- GroupClient continues owning stored group entries, response reservations, accepted final references, terminal state and the independent change cursor.
- AgentClient continues reading persisted per-run history and incremental output through backend APIs, with existing reconnect and completed/live reconciliation.
- The run projection produces one ordered presentation of text blocks and tool sets, excluding thinking. It applies an exact backend final selection when available and partitions earlier work from the accepted report.
- MemberResponse owns whole-Work disclosure and the one-time final-acceptance transition. Tool-set and individual-tool disclosures own their independent visibility state.
- Keep the existing reading column, avatar gutters, first-line alignment, run pills, user bubbles, composer, team/design panels and solo-agent presentation.

## Coordination and data flow

### Stored output and visible block projection

1. Observe an active activation regardless of disclosure state. Filter its persisted records and retained partials by run identity and the reserved working-history boundaries. Reconcile partial/completed versions by stable message identity rather than append duplicate copies.
2. Flatten its ordered assistant blocks into presentation items. Exclude thinking blocks entirely from rendered content, including any reasoning summaries/disclosures. Preserve these source records for storage and context replay.
3. Render text progressively using the established Markdown renderer. Associate tool uses and results by call identity. Treat ordinary text as visible activity while its purpose is unknown; do not condition rendering on an early final designation.
4. Derive tool sets from adjacency in the visible projection. Hidden thinking, tool results and empty text do not create boundaries. Every nonempty displayed text block does. Tool-only subsequent assistant messages may extend the prior set within this same activation. Preserve tool-call order while results arrive independently.
5. Keep grouping as a projection of immutable records. Do not concatenate, delete or rewrite history to implement a display group. Use stable call/block identities so updates retain disclosure state; resolve a newly streamed text boundary according to its original position.

### Final identification and publication

The backend owns completion policy, final-source selection and atomic group publication. The frontend consumes accepted final text and an exact source selection sufficient to exclude only that final content from the private projection. A provider can produce several text blocks or message items in one response, so selecting the whole latest assistant record must not hide distinct preceding commentary by accident.

When successful final acceptance appears in the group entry, partition this same member section into earlier work and the final report. Reconcile the streamed text with authoritative accepted text without replay animation or duplicate rendering. Collapse earlier work once for this transition. Further group updates do not reset a user's subsequent expansion choice. Reloaded completed entries initialize collapsed and read final text directly from stored group history; completed work loads on demand.

Active output remains one flow until acceptance. Early provider phase can help backend classification, but it does not itself publish text, send mentions to peers, or trigger the successful-final fold. A refused candidate and feedback remain private activity and the member can continue. Failed/cancelled/interrupted output retains its own status and inspectable activity; connection closure or token truncation is not treated as final acceptance.

TeamSystem continues after tool calls or metadata-marked commentary. Natural model completion selects final text, excluding commentary; token truncation fails. publishChat validates the latest immutable assistant record and stores ordered contentIndices with its reference. GroupClient validates and consumes that selection. No separate response-action annotation or agent completion tool is used.

### Tool-set presentation

Each set renders one compact summary row, collapsed initially, with a standard chevron, a concise action summary and relevant pending/failure information. Expansion reveals compact unboxed tool rows. A tool row can independently disclose full arguments/results. Update calls and results in place without reopening or recollapsing a set on every chunk. Whole-Work collapse does not rewrite source data or stop an active observer.

Reuse the existing neutral glyph and Markdown style vocabulary. Remove reasoning disclosures from this UI. Preserve keyboard controls, accessible expanded state, focus rings and contained overflow. No new visual box or tinted work background is introduced.

### Scroll and reconstruction

Keep reservation order independent of completion order. Auto-follow streamed growth only while near the bottom; retain the user's reading position when scrolled up. The final fold anchors to the existing member section. Reconnecting clients rebuild visible grouping from stored blocks/results and reconstruct the accepted final from its authoritative reference. Local disclosure preferences need not be shared across clients.

## Decisions and constraints

- No early-finality guarantee is required from every model provider. Unknown-purpose text is visible while it streams.
- Stable database-backed history/API reads remain the communication contract. Runtime memory and frontend text heuristics are not a source of final acceptance.
- The group transcript still shares only user messages and accepted member finals. Showing private activity to the user never places that activity in other members' model contexts.
- Grouping never crosses member or activation boundaries. Source message boundaries alone do not separate consecutive tool-only output.
- Thinking remains hidden even when Work or tools are expanded. Preserving signatures/reasoning for provider replay is a backend concern.
- Final acceptance, disclosure and tool-result completion are separate state changes; each updates its own presentation responsibility.

## Code map

The single group-chat flow is implemented by:

- [GroupChat](../../../../frontend/src/ui/GroupChat.tsx): active flow, accepted-final partition and disclosure components.
- [Group work projection](../../../../frontend/src/ui/group-work.ts): block order, hidden thinking, tool/result matching, tool sets and final deduplication.
- [Agent client](../../../../frontend/src/client/agent-client.ts) and [group client](../../../../frontend/src/client/group-client.ts): stored history, partial reconciliation and authoritative entry changes.
- [Group styles](../../../../frontend/src/ui/styles.css): compact tool sets and active/completed spacing within the accepted layout.
- [Team group-chat implementation](../../workspace-agent/team/group-chat/impl.md): completion, publication and exact final selection.

## Verification

Projection/client tests and browser checks cover:

- Thinking-only output renders no thinking UI; text and tool deltas stream while their final role is unknown.
- The same text prefix can be followed by tools or a successful turn end without premature final publication.
- Consecutive tools across tool-only responses merge; visible text separates sets; hidden thinking, empty text and results do not.
- Parallel result arrival keeps call ordering and disclosure choices. Identical names/call summaries do not merge unrelated runs.
- Late accepted final selection folds earlier work once, does not duplicate the answer and does not hide surrounding commentary from the reopened trace.
- Final-only, rejected, truncated, cancelled, failed and interrupted runs preserve their distinct behavior.
- Reconnect/reload reconstructs ordering and grouping from stored records; compaction of agent context does not rewrite these records.
- Desktop/narrow browser review matches the supplied compact Codex-like flow, keyboard access, overflow, avatar alignment and scroll behavior.

[Projection/client tests](../../../../frontend/test/group.test.ts) cover block ordering, tools, phases, accepted-final exclusion and historical references. The controlled SSE [fixture](../../../tasks/2026-10-15-unified-chat-stream/browser-server.mjs) and [browser check](../../../tasks/2026-10-15-unified-chat-stream/browser-check.js) exercise real streaming, disclosures, reconnect/reload, failures, reservation ordering, scroll and desktop/mobile layout. Backend final selection and publication are covered by unit and disposable MySQL integration tests; all commands/results are recorded in the task tests.jsonl.

## Avatar model configuration

GroupChat owns one member/anchor target and hover/leave timers for the whole transcript. Active avatars are buttons with unchanged geometry; historical retired avatars are disabled. MemberModelPopover portals one fixed, viewport-clamped interactive panel outside the scroll container. Resize/scroll and content-size changes reposition it. Pointer travel uses a close delay; focus in the panel cancels closing, Tab from the trigger enters the panel, and Escape/outside click dismiss it. Click and focus provide alternatives to hover.

ComposerSettings and ModelSettingsPanel share ModelSettingsPicker, model discovery, per-model options, reasoning clamping and validation. The member hook adapts the model-only member record to the picker, sends only connectionId/modelId/modelOptions, guards concurrent saves, rejects stale responses after unmount, reloads on revision conflicts and refreshes the team after save. It never calls solo-agent config endpoints or edits member files. WorkspaceClient owns GET/PUT member model requests. API/client tests and browser interaction checks cover persistence, identity, option selection, reload, and dismissal.
