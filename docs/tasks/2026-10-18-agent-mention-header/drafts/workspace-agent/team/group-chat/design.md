<!-- Task proposal; current contract is under docs/systems/ -->
# Team group chat

## Purpose and boundary

Provide shared communication for the user and participating team members, and trigger member work from new messages. Team management determines members and responsibilities. The lead retains design maintenance and team management capabilities. Each member's runtime and harness determine its private execution and authority.

This is the agreed group-chat behavior with the prototype conventions recorded during implementation preparation.

## Inputs and preconditions

- The user posts messages into the chat.
- The prototype has one group chat per workspace, containing the user and all active team members. Creating or retiring a member changes participation; previous shared messages retain their historical authors.
- A member submits a candidate final response for publication before ending its activation. Successful publication completes its response; a busy-recipient refusal returns private feedback and allows the member to continue its activation.
- User messages select members through existing @ mention syntax; agent responses select recipients only through their optional leading structured mention header.
- A user message without mentions triggers the lead. With explicit mentions, it triggers the mentioned members; the lead is not additionally triggered by default.
- A member response without mentions triggers no member.
- Multiple mentioned members may execute in parallel. Each member has at most one active run. A busy recipient's mention is refused, with no queue or deferred activation; the sender must try again when it is free.
- Eligible recipients belong to the chat and have runnable configuration and harness scope.
- User mentions use `@Name` or `@{Name With Spaces}`. Agent header names are exact active member names, compared ignoring case; duplicates select one recipient. Unknown, retired, unready, self or busy recipients refuse the whole publication with private feedback. Agent body text is never scanned for mentions.
- Automatic exchange continues while messages activate members, ending when there are no remaining active members or when the mention limit prevents further activation. Counting and exhaustion semantics are defined below.

## Outputs and observable effects

- A shared transcript contains user messages and published member final responses, attributed to their authors.
- Each member has continuing context ordered as group messages, its private working context, subsequent group messages, subsequent private working context. Group messages retain their individual identities, authors, content, and group order.
- Every accepted group message is delivered to all active members, including its sender, independently of who is mentioned. An idle member appends the message to its continuing context immediately, preserving its existing group messages and private work. Do not aggregate or reinject the complete transcript as an activation snapshot.
- During an activation, append the member's private working messages as it runs. Buffer incoming accepted group messages separately while it is working; they do not enter the middle of its ongoing working context or its model requests for that activation.
- When the member's work finishes, append buffered group messages individually, in group order, at the end of its private working context. This happens without waiting for another activation. Receiving or flushing these messages does not itself start another run; only the triggering rule does.
- Each member retains its own private execution history across activations. Its model context consists of this interleaved history with the context and instructions supplied by its harness. Only that member receives its private working history.
- Reasoning, model/tool steps, tool results, and intermediate assistant messages belong to private execution context and are not copied into the group transcript.
- A final response is a new group message. Its mentions can trigger subsequent member activations under the same rule.
- The lead can assign work by addressing members in a shared message. A member can address a colleague or ask the lead for a design decision through a shared response.

## Failure behavior

If any mentioned recipient is busy, refuse the whole publication: the candidate does not enter the shared transcript, and none of its recipients is activated. Return private feedback naming busy recipients to the sending agent, which can revise or retry before ending its activation. Do not queue, wait automatically for a recipient, or retry automatically. A user submission with the same condition is refused to the user.

Failed, cancelled, or interrupted runs are exposed as status, without a fabricated shared response. Stop cancels active members and marks their exchanges stopped, preventing further publications from those runs. Completed files and messages remain. Backend restart marks abandoned runs interrupted, appends buffered group messages after their private work, and does not replay triggers. Refused candidates and feedback remain private. Storage failures are explicit; no automatic application retry occurs.

### Mention-limit semantics

- Each accepted user message starts an exchange with a configurable budget, initially 32 member activations. Responses and their triggered descendants belong to that exchange even when they run in parallel.
- Each distinct recipient activated by an accepted message consumes one slot. Default lead activation consumes one slot. Duplicate mentions of the same recipient in one message consume one slot; activating that member again later consumes another.
- Refused publication attempts consume no slots. A new user message starts a separate exchange and budget; it remains subject to busy-recipient refusal.
- If accepting all recipients would exceed the remaining budget, refuse the whole publication and return explicit private feedback to the sending agent. Publish no candidate message and activate none of its recipients.
- Already-started members may finish. They can publish responses without mentions after the budget is exhausted. The exchange becomes idle when all its runs finish; one response without mentions does not stop other parallel participants.
- This budget bounds automatic cooperation across members. The runtime's separate per-run limit still bounds private execution, including revisions after refused publication.

## Guarantees and limits

- A member can see shared messages without being triggered by every message.
- Buffering message delivery for a working member is separate from trigger scheduling. Busy mentions are still refused without queuing; accepted messages that do not mention that member are still shared with it.
- Sharing a transcript does not expand a member's harness permissions or give it lead management/design-editing capabilities.
- Shared chat publication and private execution are distinct. This distinction does not prevent members from reporting relevant results in their final responses.
- Retained private history belongs to the member's execution continuity. Durable project design and knowledge remain organized independently of member identity; automated harness-context maintenance is deferred.
- History retention and private-history maintenance remain open.
- The new design replaces the private blocking-call mechanism; implementation must derive cooperation from shared messages and triggering rules.

## Acceptance examples

1. The lead posts an assignment mentioning Backend. Backend receives the shared chat context, works through its harness, and publishes its final report to everyone.
2. Backend's final report mentions Lead with a design question. Lead can be activated after Backend finishes; the former prohibition on calling an ancestor does not describe this interaction.
3. Frontend can read Backend's published report when activated but does not receive Backend's tool trace.
4. A member posts a report without mentions. Under mention-only routing, that report causes no automatic member activation.
5. The user posts a message without mentions. The lead is activated.
6. A message mentions Backend and Frontend. Both can work in parallel, and each publishes its own final response into the shared transcript.
7. Backend is working when another sender mentions it. The publication is refused and no later activation is queued. The sending agent receives private feedback and must make a new attempt when Backend is free.
8. Frontend publishes a response without mentioning busy Backend. The response enters idle members' contexts immediately and is buffered for Backend. When Backend finishes, append that response after Backend's private working context without triggering another Backend activation.
9. A candidate mentions busy Backend and free Frontend. Refuse the whole publication; neither is activated by that attempt. The sender can revise its recipients or try again later.
10. Backend is activated again. Its previous group messages and private execution history, including messages appended when its last work finished and while it was idle, remain in place. Append its new private working messages as it runs. Frontend receives Backend's shared final reports, never Backend's private execution history.
11. Under the budget rules, one slot remains when a response mentions two distinct members. Refuse the whole publication without consuming the remaining slot. The sender can revise to one recipient or publish a response without mentions.
12. A message mentions only Backend. Idle Frontend receives the same message in its context immediately but remains idle. Backend is activated by the mention.

## Backend operations

- `GET /workspaces/:id/team/chat?after=0&limit=100` reads database-backed shared messages and activation status. `limit` is 1–500; use the last message position to continue.
- `POST /workspaces/:id/team/chat/messages` with `{text}` publishes user text and returns 202 with the accepted message and started runs.
- `GET /workspaces/:id/team/chat/follow?after=0` synchronizes shared history then follows later messages and activation status across runs. Version 1 SSE events are `message`, `sync`, and `state`, scoped to the workspace. Disconnect does not cancel work.
- `PUT /workspaces/:id/team/chat` with `{mentionLimit}` configures the budget for subsequent exchanges (1–1,000); existing exchanges keep their budget.
- `POST /workspaces/:id/team/chat/stop` cancels active chat work and stops its exchanges.
- Direct `POST /agents/:memberId/runs` refuses team members; solo agents retain their API. Private agent history/follow remains available for inspection.
- Shared text is 1–20,000 characters. Rejected publication changes neither shared history, member delivery, nor activation budget. Accepted publication and creation of its recipient run records are atomic. Model execution begins after persistence; execution failures remain visible statuses.

## Persisted presentation timeline

Accepted admission reserves recipient response entries immediately in mention order, including the default lead. User input is stored directly. A member final completes its existing entry by referencing the exact accepted immutable agent-history message; its corresponding private history range is pinned when terminal. No private work is shared. Reservations and failed/cancelled/interrupted entries survive reload and restart. Refusal creates no timeline changes. Display order never depends on completion order.

`GET /workspaces/:id/team/chat/timeline?after=0&limit=100` replays persisted entry changes (limit 1–500), returning `{workspaceId,cursor,changes:[{cursor,entry}],more,mentionLimit}`. Continue at the last returned change cursor, not the display position or latest watermark. `GET /workspaces/:id/team/chat/timeline-follow?after=0` emits version-1 `entry` events with `change`, `sync` with `cursor`, and `settings` with `mentionLimit`. This stream remains open between runs. POST acknowledgement also returns affected `entries`. Entry revisions identify updates; an older reserved entry finishing produces a new change cursor. Read results resolve public final text without exposing private work.

Member entries identify member/name/run, stable display position, run status/times, final reference, and private working range `(after,through]`. While running, through is null; terminal ranges are immutable. Current prototype history is imported in original publication order, preserving its content; reservation order applies to new activations.

For harness-equipped members, final publication first persists scoped run-end checkpoints. Checkpoint failure prevents successful publication; expected mention/publication refusal may continue the run and later checkpoint additional edits. Scoped semantic commits and user design approval remain independent of shared-message publication.

## Unified streaming and model completion

Ordinary assistant text and tools stream to the user as one private activity flow. Backend selects a final candidate after model completion, using native phase where available and normal terminal reasons where absent. Successful publication establishes acceptance. Accepted references pin exact text block indices; frontend disclosure cannot publish or trigger work. Busy/mention-budget refusal remains atomic. Historical accepted references remain immutable.

## Scoped package identifiers

A bare @name immediately followed by / is part of a scoped package/path identifier, such as @joplin/lib or @types/node, and is not a routing mention. This applies in both user and member publications and even when an active member has that scope's name. Explicit @Name and @{Name With Spaces} mentions retain their behavior. Real unknown member mentions still refuse the whole publication; technical package identifiers do not consume mention budget or trigger a member. This does not introduce general Markdown parsing or change how otherwise explicit routing tokens are written.

## Agent response format

An agent may start its selected final response text with this optional routing header:

```text
<mentions>
["Backend", "Frontend Worker"]
</mentions>

# Report

Message body, including ordinary @ references.
```

The entire block may be omitted when nobody should be triggered. Empty or whitespace-only block contents and [] also mean no recipients. Allow leading whitespace before the opening tag. The first opening/tag spelling is case-sensitive and has no attributes; malformed leading reserved <mentions syntax, missing closing tag, invalid JSON, non-array data or empty/non-string/whitespace-padded member names refuse publication. Only this initial block is interpreted; all later content, including @Name, @{...}, package identifiers and later mention-like blocks, is ordinary body text. Explicit recipient names are deduplicated ignoring case in first-mentioned order. Existing eligibility, parallel launch, busy/self/unknown refusal and exchange-budget rules remain atomic.

Remove the routing block and following blank-line separator from the published body. A nonempty body is required. No-header responses retain their text exactly. Member contexts and chat APIs receive the body and resolved recipient IDs; the immutable private assistant message retains its original blocks including the header. Backend-owned final references add bodyOffset (a UTF-16 string offset) into the joined selected text; source contentIndices still identify every selected final block. Older references without bodyOffset retain their original accepted content unchanged.

Malformed-header refusals produce private feedback and allow the same activation to revise. They create no shared message, recipient reservation or budget consumption. No absent-header fallback scans the report body. Native phase selection and natural completion still identify when a candidate can be submitted; a streamed header never triggers publication by itself.
