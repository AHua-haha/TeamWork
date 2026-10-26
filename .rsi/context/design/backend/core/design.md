# Core

## Purpose, responsibilities and boundaries

Compose Agent, Harness, Workspace and Team through their public contracts. Coordinate cross-system workflows without moving a child's business state or policy into the parent. Each business aggregates and owns its core in-memory schema, persistence schema/mapping/migrations and related data operations in its data-model part. No central business-data store duplicates those models.

For member conversations, Team owns authoritative shared group context; Agent owns its assembled message context and the state needed to consume group messages. Harness supplies capabilities and context-maintenance instructions. Agent owns its durable context, private history, execution and compaction state. Team uses Agent’s public interfaces and does not implement Agent persistence.

## Interface contract

Team admits/schedules a member and provides a group-context read reference. Agent uses its own state to obtain and incorporate incoming shared messages, then runs the model/tool loop. No activation or compaction boundary is selected by Team and passed as an additional input. Agent context survives terminal success, failure, cancellation and restart restoration. Terminal status does not implicitly clear context or select history ranges for reconstruction.

Shared group inputs and private execution messages extend the Agent context chronologically. Every incorporated group message retains sender-visible content and source identity. Incoming shared messages are incorporated at safe boundaries after current work finishes, not between an in-flight tool call and its result. Agent persists its consumption state and context together through its own acknowledged data-model operations. It reuses a resident context model across runs, appends new durable message rows during normal work and replaces active rows for compaction or explicit replacement/reset.

Team owns its resident shared context as Pi messages plus metadata, persists one new context row per accepted publication and includes authoritative sender attribution in content. Existing shared frontend history/final references remain separate. Team continues to own mention routing, scheduling, publication, response reservations and shared stable history/presentation. Agent context changes do not rewrite shared or private stable message history. Workspace documents remain independently maintained project information. Harness authority and external tool effects retain their existing responsibilities.

### Cross-system atomicity

Core composes owner data-model operations on one technical transaction. Workspace plus lead/bootstrap, accepted final publication plus sender completion/recipient admission, member activation and explicit reset remain atomic. Owners expose narrow operations and domain values, never foreign SQL rows or queries. Keep existing lock order and acknowledged failure/recovery behavior. Immutable message envelopes and public contracts are preserved. Agent migrates active context from a JSON snapshot into ordered rows without a user-data reset; committed memory acknowledgements follow the outer transaction.

### Workspace initialization coordination

Workspace inspects and prepares filesystem state while preserving existing context. Core creates a fresh root-design Team lead and registers its initial configuration, activation, context history and accepted baseline atomically through owner operations. Nonempty metadata cleanup requires explicit revision-bound user confirmation. Registration failure rolls back prepared filesystem additions and restores staged metadata; original context and project source are preserved.

### Read-only context inspection coordination

API can compose Team's workspace/member scope checks with Agent's retained-context inspection, or call Team's original-group inspection directly. Each owner serves complete native messages plus metadata through bounded, revision-checked read-only pages. Shared pagination mechanics contain no business message schema. No execution, synchronization, compaction, history rewrite or frontend integration is introduced by inspection.

## Constraints, specifications and requirements

Preserve public HTTP/SSE presentation, shared-workspace single-member execution, mention/publication refusal behavior, image semantics, idle reset and member configuration rules. Context ownership and compaction introduce no public context-edit endpoint; workspace creation uses its initialization review.

Agent-owned compaction uses a single configured token threshold before ordinary model calls and after ordinary work ends. Preparation uses normal tools, retains every new message after its control instruction, and replaces the old private prefix only on acknowledged completion. Rebuild original Team group context plus the new private trace. Agent durably journals preparation and atomically stores cutover; failed/interrupted preparation retains old state plus recorded effects without replay. Finishing preparation creates no extra ordinary run or publication. Shared group summarization, structured extraction and member-specific views remain deferred; original shared history alone may still exceed model limits.
