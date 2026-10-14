> Discussion record. The accepted contract is now integrated into drafts/workspace-agent/team/group-chat/design.md and drafts/frontend/group-chat/design.md; implementation is delivered in this task checkpoint.

# Reserved response positions: proposed backend contract extension

## User-visible behavior

When an accepted message activates B, B's response section appears immediately and holds its place. Its working section updates while B runs. Its accepted final response fills that same section. Concurrent completion order, later messages, refreshes and multiple clients preserve the reserved relative order.

## Current implementation gap

The committed backend creates recipient run records at admission, but exposes no persisted timeline position for those runs. Accepted shared responses acquire their group position when published. Run timestamps and the activity-array order do not establish a durable, unambiguous response reservation order. A local-only placeholder cannot provide the required consistency after refresh or across clients.

## Required extension

- Persist an ordered user-message entry and all selected member response reservations as part of accepted publication/admission. Default Lead routing also reserves a response section.
- A reservation identifies its member/run and stable timeline position. Preserve sender information needed to reconstruct unfinished or failed sections.
- Expose reservations through initial reads, follow state/events and acceptance acknowledgements. The frontend must be able to reconstruct them without observing their original creation live.
- On successful final publication, associate the accepted response with its existing reservation. Rejected final candidates continue private work in the same section.
- Later publications and activations add new timeline entries after existing reservations. Already-reserved entries retain their relative position.
- Busy/invalid/unready/budget refusals create neither the candidate shared message nor any response reservations.
- Failed/cancelled/interrupted runs retain their reserved section with terminal status and available working history, without fabricating a final response.

## Shared context and synchronization

Reservations represent activation/display state. Member contexts still receive only accepted shared messages under the existing delivery rules. A response becomes shared when final publication succeeds.

Keep a reliable publication cursor for delivering new accepted messages and a separate persisted ordering for timeline presentation. Completing an older reservation must still generate an observable update for a client whose publication cursor has advanced. Exact fields and storage decomposition are implementation decisions once the remaining frontend design is settled.

## Proposed stable history storage

The group history owns user input records and ordered member response entries. A completed member entry references the accepted assistant message in that member's immutable message history and records the range of private working messages for the same activation. Model context is not the reference target; compaction changes model context without changing the referenced history.

### Member entry lifecycle

1. Admission reserves an entry with stable identity/order, member identity, run identity and the working-history start boundary. The final reference is empty while working.
2. Private model/tool messages continue to be recorded in the member's stable history. User inspection can follow that activation separately while its group entry stays in place.
3. Successful final publication pins the exact final-message reference and working-range end, completes the entry and notifies clients of an update to that entry. A refused final candidate leaves it working and its final reference unset.
4. Failure/cancellation/interruption completes its activity state and available working range, preserving the reserved position with no fabricated final reference.

The entry's order and identity are stable from reservation. Its completed response reference and working range become immutable at finalization. Pending completion metadata has an explicit lifecycle and is not presented as completed shared content.

### Reference and range guarantees

- Identify the final message by stable member/agent identity and message identity, with run identity and history position available for validation and retrieval. The runtime supplies the exact committed message identity; never select by text matching or by a later lookup of the member's latest response.
- Validate that the referenced message belongs to the publishing member and activation, and that it is the candidate whose publication was accepted. Rejected candidates remain private historical records.
- Working-range boundaries use stable private-history positions for that activation. They do not refer to mutable model-context indices or timestamps. The range is empty when there is no intermediate work; its end is not fixed until the activation finishes.
- Range inspection excludes earlier/later activations and renders accepted final text only in the main response section. No work trace is copied into another member's shared context.
- Member retirement and context replacement preserve all referenced stable messages. Referenced history must remain available for as long as group history retains the reference.

### Frontend read contract

The backend resolves final references when reading/following shared group history, returning the shared final text needed for Markdown display. The frontend should not need one additional private-history request per final response. Only the accepted public text is projected into this read; private thinking, tool results, candidates and feedback remain in the separate inspection interface.

A collapsed work section uses entry/run status and duration. Expanding it reads the recorded private range, or follows the same activation while still working. The group response entry exposes its range references, not the contents of private work.

Entry order and change synchronization are distinct: an older reserved entry can complete after newer entries already exist. Its completion needs a new change notification/cursor even though its display order stays fixed. A consumer that only queries entries after the latest display position would miss that completion.
