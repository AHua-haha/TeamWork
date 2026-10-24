> Proposed for 2026-10-24-business-data-models; delivered with source.

# Team

## Purpose, responsibilities and boundaries

Own members, active/file configuration, provider/application configuration, shared group context, final publication, mentions and admission/scheduling. Aggregate Team’s core in-memory models, durable schemas and related operations in its data-model part. Agent owns its private execution/context/history persistence; Team uses its public interfaces.

Agent owns its assembled model-facing context and its tracking of incorporated shared messages. Team supplies the group-context read reference rather than constructing the member's next context or deciding the processed/retained boundary.

## Interface contract

Manage member inspection, file validation and user-triggered atomic idle activation through existing interfaces. Own durable provider/application settings. Workspace owns its registry/context/models/baseline persistence; Team obtains workspace identity, locks and model revisions through Workspace public operations.

### Authoritative group context

Maintain ordered accepted user messages and accepted member final responses. Records expose stable message identity/order, sender kind/identity/display name, mention recipients, text and any prepared image references/content. Preserve final-message origin references and existing shared response reservations. Pending, failed, cancelled or refused response slots do not become fabricated shared conversational messages.

Sender attribution is also part of the group message's model-visible content. Use one consistent representation for the shared context and its incorporation into member context. For example:

```text
Sender: Lead [member: <stable-member-id>]

Please implement the agreed backend interface.
```

The precise delimiter is an implementation detail; sender visibility and consistent attribution are required. Preserve structured sender/mention metadata for programmatic use. Render attribution from authoritative message authorship, not text written by another member. Native image blocks remain images. No semantic image description is generated.

### Read reference supplied to Agent

Provide a read capability for the shared context. Agent can use stable identities/order and its own state to extract incoming messages and obtain a consistent view. The capability must not expose mutable Team collections or permit Agent to edit shared history.

Team passes only this reference as the shared-context input, with no additional activation-through, processed-prefix or compaction-retention position. Message ordering identifiers and normal read results remain part of the reference contract; their presence does not transfer ownership of consumption tracking to Team. Consistency of each read belongs to the provider of the reference, while selecting the read boundary belongs to Agent.

All active members use the same authoritative content and ordering for the same history range. They can be temporarily at different incorporated positions while running. Shared synchronization does not trigger an unmentioned member. Notify/synchronize idle agents through their public interface; a busy Agent incorporates new shared inputs after current work finishes. Do not push messages into a live model/tool exchange.

### Execution coordination and Team persistence

Retain existing member activation, sequential shared-workspace execution and publication rules. Scheduling decides who runs and when, not what private context is retained. Ask Agent’s runtime to restore/run its own context through the Agent public contract.

Own durable mappings/schema/queries for shared history, member/configuration and presentation state only. Agent persists its own context/consumption/execution values; Team does not query or write Agent tables. Team treats Agent boundaries as Agent-owned values; it does not recalculate them from terminal status or private-history ranges.

On terminal success/failure/cancellation, let Agent persist its continuous state and acknowledge the Team presentation update through the coordinated transaction. Do not clear model context, rebuild from implementation README files or maintain separate success-only private-history cleanup. Agent marks abandoned activations interrupted and restores recorded context through its own recovery; Team records the resulting presentation without replaying external effects. Immutable private history, final references and presentation working ranges remain available independently of mutable model context.

An accepted final remains shared through its stable private origin reference. Make that provenance available so the sender's Agent can reconcile its existing private answer with the shared publication without duplicate model-visible content. A publication refusal remains private feedback and allows revision under existing rules.

Explicit idle chat reset clears shared history and Agent contexts/consumption state consistently, while preserving project files and context documents. Reset is the explicit destructive operation; a normal stop is not a reset.

### Future group-context management

For now, expose original shared messages without summarization or structured extraction. A future Team-owned model may derive structured information and member-specific views. Agent must not independently summarize the shared transcript as its authoritative replacement.

Agent compaction obtains original group context through the same read reference and combines it with all new private preparation messages. Team does not pass the retained range as an additional input or define the trigger policy. Agent durably acknowledges preparation start/messages and atomic context/journal cutover, and recovers interrupted preparation without replay. Team neither implements that persistence nor changes an already accepted ordinary response. Public final references and presentation ranges remain pinned to ordinary work. Hold execution/idle authority through maintenance; stop/shutdown must cancel it. Reset removes preparation records with context/history. No new HTTP endpoint or agent tool is required.

## Constraints, specifications and requirements

- Preserve existing HTTP/SSE message presentation, durable final references, reservation ordering and delta-stream recovery.
- Preserve user-default Lead routing, mention header parsing/limits, whole-publication refusal and shared-workspace execution scheduling.
- Preserve member config review/activation, Harness authority and explicit reset behavior.
- Agent retains no dependency on Team's SQL format or concrete implementation.
- Replace old per-activation reconstruction/terminal clearing at their ownership boundary; do not retain them underneath a new append layer.
- Do not reset real user data implicitly to implement this transition. Decide any durable schema/data migration during implementation planning.

### Acceptance examples

1. Two members read the same group range and receive identical message content, authorship and ordering despite different private work.
2. Team starts a member with a group-context reference; the member's own state determines which messages are incoming. No separately supplied admission-through position controls that selection.
3. A member stops successfully or fails; Agent persists its continuous state without erasing the private trace from future context.
4. A member is unmentioned and stays idle while its group context can synchronize. A busy member defers incorporation until its current work finishes.
5. SQL restoration preserves Agent-owned incorporation state alongside its context. Already incorporated group inputs do not reappear after backend restart.
