# Team

## Purpose, responsibilities and boundaries

Own members, active/file configuration, provider/application configuration, shared group context, final publication, mentions and admission/scheduling. Aggregate Team’s core in-memory models, durable schemas and related operations in its data-model part. Agent owns its private execution/context/history persistence; Team uses its public interfaces.

Agent owns its assembled model-facing context and its tracking of incorporated shared messages. Team supplies the group-context read reference rather than constructing the member's next context or deciding the processed/retained boundary.

## Interface contract

Manage member inspection, file validation and user-triggered atomic idle activation through existing interfaces. Member configuration bundles under `.rsi/members/` must be tracked by project Git, including the lead, existing workers and referenced prompt files. Commit directory relocations with their replacement bundles so the committed configuration retains the complete intended team. Activation reads committed configuration; removing a bundle represents member retirement, not an implicit directory migration. Own durable provider/application settings. Workspace owns its registry/context/models/baseline persistence; Team obtains workspace identity, locks and model revisions through Workspace public operations.

### Authoritative group context

Maintain ordered accepted user messages and accepted member final responses. Records expose stable message identity/order, sender kind/internal identity/unified name, mention recipients, text and any prepared image references/content. Preserve final-message origin references and existing shared response reservations. Pending, failed, cancelled or refused response slots do not become fabricated shared conversational messages.

Use one unified readable member name for the UI, mentions, sender attribution and `.rsi/members/<name>/`. Keep existing file-safe names (including supported spaces and case), unique ignoring case within a workspace; do not introduce a separate display name or slug. Internal UUIDs remain backend relationship keys, not model-visible labels. A manifest's name must match its directory name exactly. Existing active member directories migrate without changing member identities, prompt contents, pending edits or history. Preserve backend-only legacy path aliases for reviewing commits made before relocation; never interpret a directory migration as retirement/recreation. Do not automatically commit filesystem changes or overwrite a conflicting destination.

The backend prefixes each original group's model-visible text with a single plain-text metadata area:

```text
<metadata>
sender: backend
mentions: frontend, shared
</metadata>

Please implement the agreed backend interface.
```

For user messages use `sender: user`. Omit the mentions line when empty. Sender and mention names come from authoritative accepted authorship/routing, never from body text. This is not strict XML and has no nested elements. Preserve the original body and native images. Message indices, UUIDs, exchange identifiers and other bookkeeping stay in structured metadata, not in content. Agent preserves the same envelope when attributing its own published answer without duplicating the answer body or altering signed thinking. Summarization receives covered message positions in its separate maintenance instructions, not per-message content. Its shared summary envelope also contains no position range. Migrate existing persisted group envelopes once while preserving IDs/order/authorship/images/final references and stable history.

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

### Shared group summary maintenance

Team owns one model-facing shared group context: a shared summary of older messages followed by the latest 30 original group messages. This replaces the semantic range tree and member-involvement projection. Stable group chat history, final-message references and Agent stable history remain intact.

Keep the existing asynchronous 32,000-token trigger over newly accepted public messages since the last analyzed snapshot. Check eligible existing workspaces after runtime startup as well as after publication. One maintenance job per workspace uses the lead's resolved model through the full Agent model/tool loop. Failed submission returns private actionable tool feedback for correction; cancellation/model failure/model-call limits still apply. Startup remains nonblocking, and shutdown cancels/drains jobs.

Pin a source snapshot and retain its latest 30 actual group messages verbatim. Summarize only the older prefix. On subsequent maintenance, supply the previous shared summary plus messages newly entering the older prefix, not the already summarized original prefix. With 30 or fewer unsummarized messages there is no prefix to replace. The Agent submits only summary text; Team owns source positions, revision, digest, identity and retained-tail validation. Instructions are maintained in a release-owned Markdown prompt file.

Accept the summary atomically against the previous summary revision and pinned source digest. New messages arriving during generation remain preserved after the pinned 30-message tail and must not invalidate an otherwise unchanged prefix. Reset or competing summary changes invalidate stale work. Failed submissions leave prior summary/context unchanged. Publish a monotonically changing context inspection revision on append, reset or summary replacement.

All members use the same shared summary; there is no member-specific topic selection. Existing private working contexts are not rewritten mid-run. Normal incremental incorporation preserves chronology, and Agent compaction reads Team's shared summary plus original tail through its already consumed group position. Team retains original source records internally for durable history, pinned in-flight reads and validation, so a summary covering later positions cannot inject future information into an older Agent checkpoint. Current full-context inspection returns the effective summary-plus-tail view, not the archived prefix.

Expose a read-only summary inspection resource with summary text, revision, covered prefix and analyzed snapshot positions, plus the fixed retained count. Reads do not generate summaries. The old semantic tree API, schema, runtime projection and tree inspector are retired. Existing semantic-index rows are not converted into accepted summaries; an eligible workspace generates a fresh summary from original source on the next startup/publication check.

### Read-only group and member context inspection

Expose the current effective shared group context: the accepted shared summary, when present, followed by original messages after its covered prefix in publication order. Preserve native message content and sender/mention/origin metadata for that original tail. The summary identifies its coverage and Team ownership explicitly. Private working messages and pending response reservations do not enter shared context. Inspection does not alter group consumption state, warm runtime context, schedule work or perform maintenance.

Member context is owned and read by Agent. Team validates that the requested active member belongs to the named workspace before Agent inspection. API transport composes these owner operations without querying another owner's tables. Group inspection checks workspace existence and returns bounded, revision-checked detached pages. Publication, reset or summary replacement invalidates a previously selected group inspection revision. Inspection introduces no additional lifecycle effects.

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


### REST resource metadata and retained public inspection

The public HTTP surface uses workspace resources rather than exposing Team's internal inspection hierarchy. `GET /workspaces/:workspaceId` returns only the registered workspace metadata (`workspaceId`, `name`, `directory`, `createdAt`) and never loads the managed context overview. Active member metadata is exposed by `GET /workspaces/:workspaceId/members`; one active member is exposed by `GET /workspaces/:workspaceId/members/:memberId`. These responses contain identity, role, responsibility, lead, revision and running state only. They do not resolve designs, Harnesses, provider availability, private context or group messages.

The old public roster and detailed member-inspection routes are retired. The Team-owned member metadata operation remains internal and is the source for the REST resources. Configuration review/activation and model-settings operations remain separate Team capabilities because they are user-controlled configuration workflows, not metadata reads.

Agent context is a member subresource at `GET /workspaces/:workspaceId/members/:memberId/context`, preserving bounded Pi-message pagination, revision checks, `context_changed`, no-store behavior and read-only execution semantics. Group chat is a workspace resource at `/workspaces/:workspaceId/chat`; its snapshot, timeline, follow, message, stop, reset and settings operations retain their existing payloads and effects. Group summary and effective group context are read-only chat subresources at `/chat/summary` and `/chat/context`.

Legacy public design, project-file, managed-context browsing and detailed Team inspection endpoints are not part of this surface. Their internal Workspace/Design/ContextBase and Harness mechanisms remain available to initialization, persistence, permissions and Agent tools. API composition may call Workspace and Team owner operations, but neither owner reads the other's persistence directly.

### Member file response handler integration

Install Agent's independent file response handler for each member using its workspace root for relative-path resolution only. Agent owns read/write/edit declarations, direct filesystem effects and file-view context maintenance; Team does not route these calls through Harness file permissions. Member instructions explain the effective file capability and preserve assigned design responsibilities as guidance. Initialize resident handlers only after the member acquires its serial execution slot, so asynchronous configuration/state loading cannot reorder admitted runs.

Ordered shared-context reads follow their position-key range without sorting native message payloads. Large message content must not require a larger database sort buffer for inspection or restoration.
