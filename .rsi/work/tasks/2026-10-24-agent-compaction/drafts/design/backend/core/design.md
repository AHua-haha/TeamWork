> Proposed for task 2026-10-24-agent-compaction; delivered with its source.

# Core

## Purpose, responsibilities and boundaries

Compose Agent, Harness, Workspace and Team through their public contracts. Coordinate cross-system workflows without moving a child's business state or policy into the parent. In-memory ownership and persistence ownership are assigned separately.

For member conversations, Team owns authoritative shared group context; Agent owns its assembled message context and the state needed to consume group messages. Harness supplies capabilities and context-maintenance instructions. Team durably hosts Agent using its exposed values rather than deciding Agent context-retention rules.

## Interface contract

Team admits/schedules a member and provides a group-context read reference. Agent uses its own state to obtain and incorporate incoming shared messages, then runs the model/tool loop. No activation or compaction boundary is selected by Team and passed as an additional input. Agent context survives terminal success, failure, cancellation and restart restoration. Terminal status does not implicitly clear context or select history ranges for reconstruction.

Shared group inputs and private execution messages extend the Agent context chronologically. Every incorporated group message retains sender-visible content and source identity. Incoming shared messages are incorporated at safe boundaries after current work finishes, not between an in-flight tool call and its result. Team persists Agent-owned consumption state and context together through public acknowledgements.

Team continues to own mention routing, scheduling, publication, response reservations and stable history. Agent context changes do not rewrite shared or private stable message history. Workspace documents remain independently maintained project information. Harness authority and external tool effects retain their existing responsibilities.

## Constraints, specifications and requirements

Preserve public HTTP/SSE presentation, shared-workspace single-member execution, mention/publication refusal behavior, image semantics, idle reset and member configuration rules. No new public context-edit endpoint or frontend UI is required by this design.

Agent-owned compaction uses a single configured token threshold before ordinary model calls and after ordinary work ends. Preparation uses normal tools, retains every new message after its control instruction, and replaces the old private prefix only on acknowledged completion. Rebuild original Team group context plus the new private trace. Team durably journals preparation and atomically stores cutover; failed/interrupted preparation retains old state plus recorded effects without replay. Finishing preparation creates no extra ordinary run or publication. Shared group summarization, structured extraction and member-specific views remain deferred; original shared history alone may still exceed model limits.
