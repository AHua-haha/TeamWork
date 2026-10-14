# Team group chat

Status: complete (backend); frontend group-chat integration is deferred.

Task start commit: d499ad82d0f845b9950015d05e38ccb22aef44c2

## Review boundary

Workspace team cooperation, shared chat visibility, and member triggering. Preserve the agreed design ownership, lead management responsibilities, and harness authority.

## Agreed direction

- Replace private lead/member messaging and blocking member calls with group chat cooperation.
- All members in a chat share its message context.
- Triggered members work privately through their runtime and harness. Only their final response is published into the shared chat.
- A new group message triggers members according to a rule. The initial rule uses explicit `@` mentions.
- A user message without mentions triggers the lead. A member response without mentions does not trigger anyone.
- Multiple mentioned members run in parallel. Each member still has at most one active run.
- Mentioning a busy member is refused, with no queue or deferred activation. The sender must try again when the recipient is free.
- Member context is a continuing interleaved sequence: group messages, private working context, subsequent group messages, subsequent private working context. Every accepted group message is delivered to all active members independently of triggering. Idle members append it immediately. Working members buffer incoming group messages and append them in group order at the end of their private working context when their work finishes. Messages do not enter the middle of ongoing private work, and flushing received messages does not trigger another run.
- If any mentioned recipient is busy, refuse the whole message publication and activate none of its recipients. Return private feedback to the sending agent before ending its activation so it can revise or retry. Rejected attempts do not enter the shared transcript.
- Each member retains its own private execution history across activations. Other members do not receive that history.
- The prototype has one group chat per workspace, with the user and all active team members.
- Automatic cooperation continues until no further members are mentioned or its mention limit prevents another activation. The proposed initial limit from the discussion is 32 member activations per user-initiated exchange.

## Prototype decisions resolved

Mention syntax and validation, counting/exhaustion, cancellation and restart behavior are specified in the draft and implementation decisions below. Multiple chats, automatic context maintenance and frontend group-chat integration remain deferred.

## Progress

Read current team and lead contracts and the call scheduler/runtime policy. Drafted the proposed cooperation boundary in [group chat design](drafts/workspace-agent/team/group-chat/design.md). Existing canonical documents still describe the committed call mechanism. No code changes or test runs.

The user selected default routing to the lead, parallel activation of multiple mentioned members, fixed run snapshots, and refusal of busy mentions without queuing. These supersede the earlier serial-scheduling and coalesced-follow-up recommendations. The user also selected refusal of the whole publication with private feedback to the sender, retained member private execution history, and one workspace chat with all active members. The fresh-private-context recommendation is superseded. Mention conventions and stopping/failure behavior remain to be specified.

The user selected continued automatic exchange until mentions end or the mention limit is exceeded. Drafted counting and exhaustion semantics for review: one slot per accepted distinct recipient activation, including default lead routing; refused attempts consume none; reject publications whose recipients exceed the remaining budget; already-started runs may finish and publish responses without further mentions.

The user clarified that group messages and private working context interleave in each member's continuing context. This supersedes whole-transcript snapshot injection. The earlier fixed-snapshot choice governs message availability during a run: append newly available group messages at activation, then keep the shared-chat input fixed while that run works. Preserve previous context and append only subsequent group messages at the next activation.

The user's subsequent clarification supersedes waiting until activation for message delivery. Every published group message is shared with all active members. Idle members append it immediately; working members buffer it and append buffered messages after their private work finishes, without waiting for or causing another activation. The existing busy-mention refusal remains: buffering accepted shared messages does not queue triggers or accept a publication mentioning a busy member.

## Implementation decisions

Use `@Name` and `@{Name With Spaces}`, matching active names without case. Duplicate mentions trigger once; unknown, unready, retired, self, and busy recipients refuse the entire publication. Text is limited to 20,000 characters. The default limit is 32 activations per exchange and is editable on the chat API. A group stop cancels active runs and stops their exchanges; completed effects remain. Restart interrupts abandoned runs and flushes buffered messages, with no automatic replay. Keep private runtime follow APIs for inspection; group history/follow exposes only accepted shared messages and run status. Team input uses the new workspace chat API; direct member input and old blocking-call tools are removed. Frontend group-chat integration is a later task.

## Delivered checkpoint

- Persistent workspace group transcript, member delivery cursors, exchange budgets and activation records.
- Parallel mention-triggered work with retained private history, immediate idle delivery and buffered delivery at work completion. Compaction does not rewrite private or group history.
- Whole-publication refusal and private feedback for busy/invalid/unavailable recipients or exhausted budgets. No queue or private blocking-call tool remains.
- Backend history, continuous follow, settings and stop APIs, plus cancellation, membership cutoff and restart recovery.
- Canonical team/group-chat/lead/runtime/database docs promoted with the implementation. Frontend docs explicitly record that the existing workspace composer receives direct-member-input refusal; solo chat and design/team/file views retain their implementation.

Final verification: 64 unit/HTTP tests passed, one existing watcher test skipped because this environment delivers no file events; 33 disposable MySQL integration tests passed; backend type check and production build passed. SQL integration covers parallel work, atomic admission races/rollback, private feedback, retained history, compaction separation, deferred delivery, new-member history, retirement cutoff and restart without trigger replay. No paid model calls were made. Whitespace audit initially found an extra EOF blank line after old call tests were removed; corrected and the final audit passed. Every run is recorded in [tests.jsonl](tests.jsonl). [Document audit](verify-docs.py) checks canonical/draft parity, local links and removal of old call tools.

Task start remains d499ad82d0f845b9950015d05e38ccb22aef44c2. This checkpoint uses the agreed feature-branch review workflow; merge and push are separate actions. The backend README provides API review commands. Existing development processes must restart to load the new implementation and initialize its added tables.

Final review also fixed a shutdown regression introduced while extracting persisted-run launch: an already-accepted solo start must register during shutdown while the runtime lease is still held, so shutdown can cancel it durably. The added MySQL regression test passes with the final runtime.
