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

### Incremental message data model

Represent shared context with complete Pi Message values plus Team-owned metadata and stable message IDs. Each message content includes the sender, while metadata carries authoritative sender identity/kind/name, recipients, workspace/order/exchange and optional private final origin. Shared messages contain public text and native images only; never expose private thinking or tool traces.

Persist one ordered context row per accepted group publication, and insert only the new row during normal work. Keep stable frontend history and response references independently intact. Load a resident Team group-context model once per workspace on first use; reuse it across member activations and reads. Return detached ranges from that model, never its mutable storage. Incorporation positions remain Agent-owned.

Publish resident changes only after the outer SQL transaction commits. Rollback changes no visible state; uncertain commit acknowledgement invalidates resident data until durable restoration without replay. Explicit idle reset clears durable and resident group context with the existing history/member reset. Shutdown releases resident state. Migrate old records without changing their IDs/order/authorship/images/final references or resetting user data. Group compaction remains deferred.

### Read reference supplied to Agent

Provide a read capability for the shared context. Agent can use stable identities/order and its own state to extract incoming messages and obtain a consistent view. The capability must not expose mutable Team collections or permit Agent to edit shared history.

Team passes only this reference as the shared-context input, with no additional activation-through, processed-prefix or compaction-retention position. Message ordering identifiers and normal read results remain part of the reference contract; their presence does not transfer ownership of consumption tracking to Team. Consistency of each read belongs to the provider of the reference, while selecting the read boundary belongs to Agent.

All active members use the same authoritative content and ordering for the same history range. They can be temporarily at different incorporated positions while running. Shared synchronization does not trigger an unmentioned member. Notify/synchronize idle agents through their public interface; a busy Agent incorporates new shared inputs after current work finishes. Do not push messages into a live model/tool exchange.

### Execution coordination and Team persistence

Retain existing member activation, sequential shared-workspace execution and publication rules. Scheduling decides who runs and when, not what private context is retained. Ask Agent’s runtime to restore/run its own context through the Agent public contract.

Own durable mappings/schema/queries for shared history, member/configuration and presentation state only. Agent persists its own context/consumption/execution values; Team does not query or write Agent tables. Team treats Agent boundaries as Agent-owned values; it does not recalculate them from terminal status or private-history ranges.

On terminal success/failure/cancellation, let Agent persist its continuous state and acknowledge the Team presentation update through the coordinated transaction. Do not clear model context, rebuild from implementation README files or maintain separate success-only private-history cleanup. Agent marks abandoned activations interrupted and restores recorded context through its own recovery; Team records the resulting presentation without replaying external effects. Immutable private history, final references and presentation working ranges remain available independently of mutable model context.

An accepted final retains its stable private origin reference alongside its materialized public context entry. Make that provenance available so the sender's Agent can reconcile its existing private answer with the shared publication without duplicate model-visible content. A publication refusal remains private feedback and allows revision under existing rules.

Explicit idle chat reset clears shared history and Agent contexts/consumption state consistently, while preserving project files and context documents. Reset is the explicit destructive operation; a normal stop is not a reset.

### Group semantic analysis and Agent views

Team may generate a derived semantic index for the authoritative group context. The index is not a replacement for shared messages and does not change sender attribution, mentions, ordering, images or private/public boundaries. Team owns analysis generation, validation, source references and persistence of this derived information; Agent owns the view it constructs from the information.

A dedicated maintenance semantic-analysis Agent performs generation through the ordinary Agent model/tool mechanism, but it is not a member activation, does not receive a member mention, does not publish a final response and does not modify any member’s private context. Team starts it through the Agent public runtime contract and owns the semantic-analysis job/watermark state. Its private execution records, if any, remain Agent-owned; Team never reads Agent tables directly.

Team tracks the highest source position included in the last acknowledged semantic analysis and the estimated public group-token count since that watermark. After accepted group context reaches another 32,000-token increment, Team schedules one analysis job for the current stable source boundary. This trigger is asynchronous and does not block publication or ordinary member execution. A running job suppresses duplicate jobs; messages arriving during it remain for a later watermark increment. If a job fails or its submission is rejected, the watermark does not advance and the range is retried. A job may process a message that crosses the threshold whole rather than splitting a message.

The maintenance Agent reads a pinned full original group-context snapshot through the Team reference, together with the previous validated semantic index. It does not receive only the uncovered suffix. It submits a complete semantic tree for that pinned source prefix with a dedicated `submit_group_semantic_information` capability. Team validates source positions/IDs and digests, member IDs, range containment/order, summaries and the optimistic base revision before atomically replacing the prior derived revision and advancing the watermark to the pinned boundary. The submission is not a group message and never enters member publication or mention admission. Messages accepted after the pinned boundary remain outside that revision and are counted toward a later trigger. Original messages remain the fallback for every range not covered by the latest complete semantic tree.

A semantic index is a versioned tree of topic ranges. Each node identifies an inclusive ordered source position range, a topic, a summary and the stable member IDs involved in that range. Team's source digest binds each range revision to the complete original messages and their stable IDs; the derived node need not duplicate those IDs. For the initial rule, involvement is derived from the authoritative sender and explicit mention recipients on messages in the node’s source range: a member sender and every mentioned member are involved. For a range, the involved set is the union of those member identities across its covered messages. The analysis model may organize the topic and summary, but it must not invent involvement that is absent from Team’s sender/mention metadata. Child ranges are contained by their parent and are ordered and non-overlapping for the initial contract, so a source message is represented once. Analysis revisions identify the source range and content revision they cover; incomplete, stale or invalid results are not complete coverage. Team-generated involvement metadata must use existing member identities and cannot redefine authoritative authorship or mentions.

Team exposes the validated semantic index through the group-context read capability. It may generate or revise derived nodes asynchronously; publication and ordinary Agent execution do not wait for analysis. Original messages remain available and are used for every range not covered by a valid complete semantic tree. Team does not construct a member-specific view, select an Agent's compaction boundary or persist an Agent's private projection.

Agent compaction may use this index to construct a deterministic member view. For each covered node, if the current member is not involved, the node's summary replaces the messages in its source range and its children are not opened. If the member is involved, the Agent opens the node and applies the same rule recursively to its children. An involved leaf retains its original group messages. A range not covered by a valid semantic tree retains its original messages. Native image blocks and their ordering must remain available; a summary cannot convert an image into a textual description.

Normal Agent runs continue to append original group messages in timeline order. Only the successful Agent compaction cutover may replace the incorporated group prefix with that Agent's deterministic view. The view is private model context, is not a new Team message, and does not advance or replace Agent-owned group consumption state. Team retains the original group messages and semantic index for later reads and recovery.

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
