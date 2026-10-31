# Team

## Purpose, responsibilities and boundaries

Own members, active/file configuration, provider/application configuration, shared group context, final publication, mentions and admission/scheduling. Aggregate Team’s core in-memory models, durable schemas and related operations in its data-model part. Agent owns its private execution/context/history persistence; Team uses its public interfaces.

Agent owns its assembled model-facing context and its tracking of incorporated shared messages. Team supplies the group-context read reference rather than constructing the member's next context or deciding the processed/retained boundary.

## Interface contract

Manage active-member inspection, current-file validation and user-triggered atomic idle activation. Member files are activation inputs; the active configuration is a durable workspace-team snapshot. Activation reads the complete current `.rsi/members/` directory and referenced prompt files, validates them, and stores create/update/delete changes together only while the entire workspace is idle. No Git commit is required. Later file edits do not affect active members until activation. Remove configuration-file inspection, diffs, commit history, pending/committed status and accepted-file baselines. The project Git repository belongs entirely to agents and users; the backend maintains no Git state or Git-dependent lifecycle. Active-member inspection and model preferences remain available.

### Authoritative group context

Maintain ordered accepted user messages with the native `user` role and accepted member final responses with the native `assistant` role. Keep the author identity in the existing metadata area so member responses remain attributed when incorporated into another member’s context. Records expose stable message identity/order, sender kind/internal identity/unified name, mention recipients, text and any prepared image references/content. Preserve final-message origin references and existing shared response reservations. Pending, failed, cancelled or refused response slots do not become fabricated shared conversational messages.

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

Represent shared context with complete Pi Message values plus Team-owned metadata and stable message IDs. Each message content includes the sender, while metadata carries authoritative sender identity/kind/name, recipients, workspace/order/exchange and optional private final origin. Shared member assistant messages contain only accepted public response text in text blocks; native images belong to user messages. Never expose private thinking, signatures or tool traces. The public assistant projection uses Team-owned provenance and zero usage rather than pretending to be another billed model generation; the final origin reference still identifies the original signed private response. Group summaries remain separate system-generated user-role context.

Persist one ordered context row per accepted group publication, and insert only the new row during normal work. Keep stable frontend history and response references independently intact. Load a resident Team group-context model once per workspace on first use; reuse it across member activations and reads. Return detached ranges from that model, never its mutable storage. Incorporation positions remain Agent-owned.

Publish resident changes only after the outer SQL transaction commits. Rollback changes no visible state; uncertain commit acknowledgement invalidates resident data until durable restoration without replay. Explicit idle reset clears durable and resident group context with the existing history/member reset. Shutdown releases resident state. Migrate old member user-role context entries and their copied member-context entries to assistant roles once at startup. Preserve IDs/order/authorship/images/final references, consumption bookkeeping and stable history. Keep the sender’s existing signed assistant response intact. Role conversion and its format marker commit atomically; failed migration can be retried without resetting user data. Group compaction remains deferred.

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

### Bounded presentation history and incremental updates

Stable history uses a logical archive only: retain original Agent messages, Team publications, response references, working ranges and update records in SQL. Presentation loading does not change model context, compaction, scheduling or reset semantics.

Provide a bounded current-entry read separate from change-log replay. The initial read returns the latest 50 timeline entries in display order, resolved public final text, an older-history cursor and the current live-update cursor. Obtain entries, reset generation and update cursor in one consistent database view. Older history is explicitly loaded before a display position, with a reset-generation guard so pages from a reset conversation cannot mix with current history. Read private working messages separately, only on expansion or while a response runs.

History position and change sequence are distinct cursors. After the initial snapshot, live delivery, manual refresh and reconnect resume after the last update the frontend successfully applied. Never replay from zero or reload loaded pages on ordinary refresh/errors. An update to an older unloaded entry advances the live cursor without loading that entry; loaded entries reconcile by stable identity and revision. Older-page reads racing with live updates must retain the newer version. POST acknowledgements never advance the live cursor.

An explicit reset or a backend-declared invalid/expired update cursor permits a new latest-50 snapshot, not a full-history replay. Preserve already loaded content during ordinary reconnect/error recovery. Completed, failed, cancelled and interrupted working sections start folded; status and failure information remain visible without private-history reads. Running responses retain their existing streaming behavior. Changes to presentation loading must not rewrite or archive original database rows.

### Read-only group and member context inspection

Expose the current effective shared group context: the accepted shared summary, when present, followed by original messages after its covered prefix in publication order. Preserve native message content and sender/mention/origin metadata for that original tail. The summary identifies its coverage and Team ownership explicitly. Private working messages and pending response reservations do not enter shared context. Inspection does not alter group consumption state, warm runtime context, schedule work or perform maintenance.

Member context is owned and read by Agent. Team validates that the requested active member belongs to the named workspace before Agent inspection. API transport composes these owner operations without querying another owner's tables. Group inspection checks workspace existence and returns bounded, revision-checked detached pages. Publication, reset or summary replacement invalidates a previously selected group inspection revision. Inspection introduces no additional lifecycle effects.

## Constraints, specifications and requirements

- Preserve existing HTTP/SSE message presentation, durable final references, reservation ordering and delta-stream recovery.
- Preserve user-default Lead routing, mention header parsing/limits, whole-publication refusal and shared-workspace execution scheduling.
- Preserve active-member inspection and direct file activation and explicit reset behavior. Tool capabilities and the unrestricted development permission policy belong to React Harnesses, not the superseded Harness system.
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

The public HTTP surface uses workspace resources rather than exposing Team's internal inspection hierarchy. `GET /workspaces/:workspaceId` returns only the registered workspace metadata (`workspaceId`, `name`, `directory`, `createdAt`) and never loads the managed context overview. Active member metadata is exposed by `GET /workspaces/:workspaceId/members`; one active member is exposed by `GET /workspaces/:workspaceId/members/:memberId`. These responses contain identity, role, responsibility, lead, revision and running state only. They do not resolve designs, React Harnesses, provider availability, private context or group messages.

The old public roster and detailed member-inspection routes are retired. The Team-owned member metadata operation remains internal and is the source for the REST resources. Current-file activation and model-settings operations remain separate Team capabilities because they are user-controlled configuration workflows, not metadata reads.

Agent context is a member subresource at `GET /workspaces/:workspaceId/members/:memberId/context`, preserving bounded Pi-message pagination, revision checks, `context_changed`, no-store behavior and read-only execution semantics. Group chat is a workspace resource at `/workspaces/:workspaceId/chat`; its snapshot, timeline, follow, message, stop, reset and settings operations retain their existing payloads and effects. Group summary and effective group context are read-only chat subresources at `/chat/summary` and `/chat/context`.

Legacy public design, project-file, managed-context browsing and detailed Team inspection endpoints are not part of this surface. Workspace/Design/ContextBase remain available through owner interfaces. React Harnesses provide tool capabilities; the separate legacy Harness and its permission mechanisms are superseded by the accepted Agent design. API composition may call Workspace and Team owner operations, but neither owner reads the other's persistence directly.

### Member React Harness integration

Assemble React Harnesses for each member. The File React Harness uses its workspace root for relative-path resolution only. File React Harness owns read/write/edit declarations, direct filesystem effects and file-view context maintenance; Team does not route these calls through legacy Harness file permissions. Default React Harness supplies other tools under the same unrestricted development policy. Team supplies member-management tools and assignment data without controlling tool access or embedding assigned documents in system prompts. File React Harness owns fixed file/context instructions and future assigned-context injection. Initialize resident React Harness state only after the member acquires its serial execution slot, so asynchronous configuration/state loading cannot reorder admitted runs.

Ordered shared-context reads follow their position-key range without sorting native message payloads. Large message content must not require a larger database sort buffer for inspection or restoration.

### Member design assignments, independent of React Harness configuration

Member configuration assigns working-design roots only; descendant design parts are included recursively. Configured dependency design scope is removed. Dependencies are discovered through viewed context by File React Harness. This is Team-owned responsibility guidance, not a React Harness configuration or permission boundary.

Remove member `harness`/`harnesses`, execution allowlists, effective permission/resource projections and the old detailed Harness inspection methods/route fallback. Available capabilities are assembled by Agent's File and Default React Harnesses and are not configured through member files. Preserve lightweight member metadata, model settings, context inspection, configuration file review and separate idle user activation.

Backend-owned startup migration converts existing durable records and valid member manifests while preserving active assignments, prompts, model preferences, member identity and message history. Filesystem edits remain inactive until activation. Discard old Git acceptance revisions, directory-history aliases and chained previous snapshots from member source metadata. Do not inspect, change or reconstruct project Git history. Replace an old Git/hash activation marker with an opaque application UUID once; repeated startup leaves it unchanged.

React Harness assembly imports the public Core React Harness module. Team supplies factories, tools and assignment data; React Harness residency/state loading operates directly on public Agent data models. No direct Agent execution dependency is required by React Harness.

### Fixed member instructions and prompt ownership

A member bundle contains `member.json` and exactly one conventional instruction document, `agent.md`. The manifest has no `promptFiles`, `settings.prompt` or `settings.promptOptionIds` selection. Explicit idle-team activation validates and stores the current agent.md content with the active configuration; later file edits stay inactive until another activation. Team owns fixed cooperation, routing and member-management rules. The system prompt includes those rules and the member's activated agent.md instructions. Team owns member identity, responsibility and roster data but does not embed these changing values in the system prompt. Their future dynamic injection is deferred.

Remove the Team-owned design/dependency prompt assembly, its per-run guidance cache and member-context catalog selection. Legacy member snapshots and file bundles are converted to agent.md while preserving active and unactivated instruction text separately. Existing selected catalog text is flattened into the migrated member instructions, rather than retaining a live selection. Current member inputs reject both selection mechanisms. Solo-agent catalog configuration is separate.

### Working-only assignments and input refresh

The settled extension removes dependency-design selection from member configuration. Keep recursive working assignments and allow free exploration of other systems. Team owns shared input, member assignments and identity information, while File React Harness accumulates viewed outside-scope design systems. After prior work stops, user-input reaction is the only dependency-refresh checkpoint. Its threshold is 64 completed new messages since the last successful refresh. The refresh's own context entry is excluded and never recursively starts another refresh.

File React Harness privately inserts one user-role `<system_instruction>` message containing the full design tree, optional summary text and `[working]` markers, followed by accumulated dependencies' usage READMEs or `No README available.`. Do not publish this generated entry into Team chat/history. Team does not assemble duplicate document guidance or put changing member identity/responsibility into the system prompt. See React Harness design for hiding, accumulation and durability rules. Startup converts historical active and draft dependency fields to working-only scopes separately, without activating draft changes.
