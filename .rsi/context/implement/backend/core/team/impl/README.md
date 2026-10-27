# Team implementation context

## Result summary

Project Git tracks `.rsi/members/` alongside `.rsi/context/`; other runtime-managed `.rsi` directories remain ignored. Named member bundles and their referenced Markdown prompts are committed together. A directory rename must retain the bundle in the committed tree, because activation treats missing committed bundles as deletions.

Team owns membership, provider/application/member configuration, shared chat and presentation data. Its data/ part aggregates models, validation, file serialization, schemas, SQL repositories and transient coordination state. Agent owns its own private context/history/run/compaction persistence; Workspace owns its own registry/context/models persistence.

Design: [Team](../../../../../design/backend/core/team/design.md).

### Implemented contract

**Input:** TeamData(storage,agentData,workspaceData,connection?), ConfigData(storage,agentData,membership,connection?), ConfigService(configData,models,tools?,key?), TeamSystem(teamData,workspaceService,configService,...). TeamExecutionData owns transient active member/run and finalizing job references used by TeamRunner.

**Output:** Existing member/configuration/chat/snapshot/timeline interfaces and original GroupContextReference. readGroupContext(workspaceId,after) returns detached sender-visible Pi messages from the resident Team model; transaction-bound reads use the caller's durable snapshot without populating that model. ConfigData returns application/provider/catalog/saved solo-agent model profiles; these are Team-managed user configuration, distinct from Agent execution state.

**Effect and failure:** schema.ts owns members, member_activation, config_records, chat_images/settings/exchanges/messages/context_entries/runs/clock/entries/changes. TeamData writes only these tables. Agent/Workspace data is read or changed through their public transaction-scoped operations. Team still owns final-text selection, mention parsing, publication refusal, reservations and shared-workspace sequential execution. Stable frontend history/reference formats and HTTP/SSE payloads do not change; model-facing group context has its own ordered rows. TeamExecutionData keeps an accepted sender’s finalizing job until Agent finishes maintenance; settling an old job cannot remove a successor activation.

**Usage example:** const data = new CoreData(storage); construct ConfigService(data.config,...), WorkspaceService(data.workspaces,config), TeamSystem(data.team,workspaces,config); attach new AgentRuntime(data.agents,team.runConfig,team.policy(...),stream). Publish via team.runner.postUser and await runtime.finished for private finalization.

### Incremental resident group-context contract

**Input:** GroupContextEntry is {messageId,message: Pi Message,metadata: JsonObject}. groupEntry constructs the public user-role input with one plain-text `<metadata>` area (`sender: <name>` and optional `mentions: <name>, ...`) followed by the exact original body/native images. User attribution is `sender: user`. No message index, UUID, nested XML or routing header is injected into the body. Metadata contains source, workspaceId, groupPosition, exchangeId, copied author/recipient IDs and recipientNames snapshots, optional attachment metadata and finalRef. validateGroupContextEntry enforces matching sender content/metadata, public role, native images and valid origin. Private assistant thinking/tools are not copied into shared context.

**Output:** readGroupContext(id,after) returns detached original entries through GroupContextReference, with sender/origin derived from metadata for Agent's reconciliation. GroupContextState owns ordered messages; GroupContexts lazily loads one model per workspace and shares it across transaction views. A binary search selects the new suffix. Each Agent continues to own its own consumption position.

**Effect and failure:** chat_context_entries holds one versioned complete entry per (workspace_id,position), with unique (workspace_id,id). chat_settings.position/reset_position/context_length/context_format provide small bounds/count/migration bookkeeping. Normal publishChat inserts one new context row with shared history, exact final reference, presentation and recipient admission in one transaction. Existing context rows are untouched. Shared context is a materialized public projection; chat_messages member records still contain only the stable private final reference, and frontend history resolves it as before.

The first root read loads settings and ordered rows in one repeatable-read transaction; later root reads use memory, without rereading private finals or image blobs. Initial-load races reconcile commit notifications by position. Bound reads use the existing SQL transaction and do not install speculative resident state. afterCommit callbacks advance resident state only after the outer commit; rollback changes none of it. Uncertain commit acknowledgement or notification gaps invalidate the model so the next read restores actual durable state without replay. Loading checks row count, identity/order, metadata and sender/native-content agreement; missing rows fail explicitly.

Reset deletes context rows with shared history and Agent conversations, advances reset boundaries and zeros context_length, then empties the resident model after commit. CoreData.close calls TeamData.close to release group models before Storage shutdown. Administrative clearConversations releases them after its outer commit. Context memory remains resident for loaded workspaces; no eviction or group compaction policy is introduced.

Migration creates chat_context_entries and adds chat_settings.context_format/context_length. Old settings are marked format 0; CoreData.migrate imports older timeline history, then invokes migrateGroupContext before Agent legacy-context adoption. Backfill resolves exact published final bodies and prepared images once through owner operations, preserves IDs/order/time/authorship/recipients/origins, writes all rows/count/format atomically per workspace and retries safely after failure. Existing frontend history/private records are unchanged; no user-data reset is needed. Stop the old backend before startup migration.

**Usage example:** two members consume the same shared range from one resident model; accepted publication inserts a row and later reads see the same committed Pi message with sender content. Integration tests prevent UPDATE/DELETE of existing context rows during two normal runs, count one load and verify reopen/image/origin preservation.

### Transaction and lifecycle coordination

TeamData.inTransaction(connection) and ConfigData.inTransaction(connection) join the existing transaction. Publication locks Workspace through its public port, gets narrow Agent execution states, validates an immutable completed final through AgentData, then commits its shared record/reference together with Agent sender completion and recipient admission. Team never reads agents/runs/messages/context_compactions SQL directly. Snapshot/stop run lookups use Agent-owned batch reads rather than a query per linked run. Presentation completion callbacks remain atomic with Agent terminal state. Member activation obtains Workspace model revision and Agent idle checks through owner interfaces. Chat reset deletes Team references then asks Agent to clear member conversations on the same transaction. Core’s administrative reset uses owner deletion operations in dependency order.

TeamData owns the resident shared source transcript and accepted group summary. TeamRunner supplies group references and idle synchronization notifications; Agent owns its consumption boundary and private context persistence. Original source rows remain append-only for durable history and pinned in-flight reads. Stable group history and final references are unaffected by summary replacement.

### Unified member names and envelope migration

**Input/output:** `name` is the sole user/model-facing member label. `generatedSource(fields)` initializes `.rsi/members/<name>/member.json` and its prompts. The supported 1–40-character file-safe name rules (letters/digits, internal spaces/dots/underscores/hyphens) and case-insensitive workspace uniqueness remain. Validation requires the directory spelling to equal the manifest name, and existing member names remain fixed during updates. Backend UUIDs remain opaque keys for SQL relationships, APIs, runs and historical references.

**Startup effects:** `relocateMemberSource` moves an entire active bundle to its name, including pending and untracked files, without rewriting content or creating a Git commit. A conflicting destination or symlink refuses migration; intentional deletion remains absent. Backend-only `legacyPaths` preserve pre-migration committed-path interpretation in validation/review/status, so relocation does not delete/recreate a member or lose its accepted prompt snapshot. Repeated startup makes no further writes. Filesystem-first relocation is recoverable if SQL acknowledgement fails: the next startup finds the destination and completes the stored path change. The ordinary Git changes view still shows physical renames for user review/commit.

**Group effects:** Team context_format=2 identifies the new envelope. Startup converts old format-1 context rows from their authoritative author/recipient metadata, retaining IDs/order/images/finalRef and the exact body; recipient names come from retained member records. Format-0 history import builds the same envelope. Stable `chat_messages`, private `messages` and provider signatures remain untouched. Team asks Agent's public `refreshSharedAttribution` to patch only generated attribution in mutable private context in the same transaction; no Team SQL accesses Agent tables. Advance the inspection revision and invalidate resident context only after acknowledgement. Normal publication still inserts one row; migration adds no ongoing full-context rewrite.

**Usage:** a member named `Backend` has `.rsi/members/Backend/member.json`, is mentioned as `@Backend`, and appears as `sender: Backend`. A space-containing name uses the same literal directory and the existing braced user mention form. The response-routing `<mentions>` header remains separate from the backend-generated attribution envelope.

**Verification:** member-config, member-activation, team-group-context and conversation-context tests cover exact name/path validation, pending-byte preservation, legacy commit review, collision refusal, attribution and signed-block preservation. MySQL integration covers format migration, immutable history, idempotence and reload.

### Shared group summary implemented contract

**Input:** `summaryInput(workspaceId)` returns a pinned `GroupSummaryInput`: the previous accepted summary, original messages newly entering the older prefix, backend-owned revision/from/through/analyzedThrough/digest, and estimated uncovered public-message tokens. The 30 most recent original messages at that snapshot are absent from maintenance input. Subsequent inputs omit the already summarized original prefix.

**Generation:** `TeamSystem.startMaintenance()` starts an idempotent nonblocking startup scan; accepted publications use the same per-workspace scheduler. At 32,000 newly uncovered public tokens and with an older prefix available, a full maintenance Agent loop uses the lead's resolved model and `prompts/team/group-summary.md`. Its sole tool is `submit_group_summary({summary:string})`, with a 24,000-character limit. Team closes over all source metadata; the model supplies no IDs, member involvement, digest or revision. Invalid text returns private error feedback and the same Agent loop can correct/resubmit. Reset/competing-revision conflicts abort the stale run because text changes cannot repair its pinned snapshot. Logs distinguish start, accepted submission, rejected tool and terminal failure. Shutdown cancels/drains active work.

**Persistence:** `chat_context_summaries` stores one accepted `GroupSummary` per workspace: `revision`, `from`, `through`, `analyzedThrough`, `sourceDigest`, `text`, `messageId`, `time`. Acceptance compares prior revision and pinned prefix digest inside one transaction and increments `chat_settings.context_revision`. Appends also increment that inspection revision. Concurrent messages beyond `analyzedThrough` remain intact after the pinned 30-message tail. Failure does not change summary or context revision. Resident summary acknowledgement runs only after commit; uncertain acknowledgement invalidates the resident state.

**Reads:** `readGroupContext(workspaceId,0,through?)` supplies summary plus originals after its prefix, provided the summary does not cover future positions relative to the Agent's requested upper boundary. Otherwise it returns original source through that boundary. Incremental `readGroupContext(workspaceId,after)` preserves original chronological arrivals for existing working contexts; compaction/full reads adopt the shared summary. `inspectGroupContext` pages the effective summary/tail under `context_revision`. `readGroupSummary` returns the accepted summary independently, without model work. Existing agents are not rewritten mid-run. Original source remains internal for pinned reads; stable public history remains unchanged.

**Migration:** create the summary table and `context_revision`, initialize legacy inspection revision from publication position, retire `chat_semantic_indexes` and its watermark/revision columns, and preserve all source/history/private context rows. Old semantic trees are not accepted as summaries. An eligible workspace creates a fresh summary on startup/publication. Reset removes accepted summaries together with group/Agent conversations; administrative reset includes the summary table.

**Usage:** inspect the saved summary with `team.inspectGroupSummary(workspaceId)`. Open Context → Group summary to read it; Refresh fetches again explicitly. Group chat context inspection shows one summary entry followed by the retained originals and any arrivals since the pinned snapshot.

**Verification:** `group-summary.test.ts` covers prefix/tail separation, repeated summaries, concurrent arrivals, original source retention, older Agent checkpoints and reset. `team-summary.test.ts` exercises startup/publication scheduling, deduplication, failures/cancellation and a real AgentRuntime loop correcting schema/tool errors. MySQL integration tests cover atomic acceptance, append-only stable history, revision paging conflicts, reload, invalid text, stale snapshots/reset and legacy migration.

### Context inspection

**Input:** `TeamSystem.inspectGroupContext(workspaceId, {offset?,limit?,revision?})` delegates to TeamData's same operation through ChatStore. `TeamSystem.requireContextMember(workspaceId,memberId)` checks workspace existence, member ownership and non-retirement before the API calls Agent's inspection port. It does not resolve harnesses/model configuration or run synchronization.

**Output:** Group inspection returns `{revision,offset,total,nextOffset,entries}` using effective `GroupContextEntry` records (shared summary plus original tail). The revision is `chat_settings.context_revision`, incremented by append, reset and accepted summary replacement. Group entry Pi role can be user even for a member sender; metadata.author and explicit sender text carry authorship. Private thinking/tools are not copied into shared context.

**Effect/failure:** A repeatable-read transaction reads workspace presence, chat settings and the bounded ordered rows after reset_position. No full resident load, private-history joins, repair, maintenance or mutation occurs during inspection. Defaults and errors match Agent pagination: offset 0, limit 50/max100, later-page revision required, changed revision context_changed/409. Unknown workspaces and out-of-workspace/retired/missing members return not_found/404. Existing tables and lifecycle bookkeeping supply pagination; the one-time envelope migration is a startup operation, never an inspection side effect.

**Usage example:** `await team.inspectGroupContext(id,{limit:50})` returns current shared summary/tail entries for debugging; use its revision and nextOffset to continue. To inspect private context, first validate the member scope, then call AgentRuntime.inspectContext rather than querying Agent SQL from Team.

## File lookup

- [backend/src/core/team/data/group-context.ts](../../../../../../../backend/src/core/team/data/group-context.ts): resident ordered group context and commit reconciliation.
- [backend/test/team-group-context.test.ts](../../../../../../../backend/test/team-group-context.test.ts): native content, detached ranges, load races and reset/invalidation.
- [backend/src/core/team/data](../../../../../../../backend/src/core/team/data): member/config/chat models and owned repositories.

- [backend/src/core/team](../../../../../../../backend/src/core/team): owned source.
- [reference/config/design.md](reference/config/design.md): detailed existing behavior and code map.
- [reference/config/impl.md](reference/config/impl.md): detailed existing behavior and code map.
- [reference/database/design.md](reference/database/design.md): detailed existing behavior and code map.
- [reference/database/impl.md](reference/database/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/conversation-context/design.md](reference/workspace-agent/team/conversation-context/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/conversation-context/impl.md](reference/workspace-agent/team/conversation-context/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/design.md](reference/workspace-agent/team/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/group-chat/design.md](reference/workspace-agent/team/group-chat/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/group-chat/impl.md](reference/workspace-agent/team/group-chat/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/impl.md](reference/workspace-agent/team/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/lead/design.md](reference/workspace-agent/team/lead/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/team/lead/impl.md](reference/workspace-agent/team/lead/impl.md): detailed existing behavior and code map.
- [Backend tests](../../../../../../../backend/test): unit/HTTP, in-memory execution, boundary and disposable SQL integration checks.

## Automatic retrieval

```json
{"commands": []}
```

## Lightweight roster

**Input:** `TeamService.roster(workspaceId)`; `TeamSystem.roster(workspaceId)` adds TeamRunner.isRunning flags.

**Output:** `{workspaceId,members:[{memberId,workspaceId,revision,name,role,responsibility,lead,running}]}`. Members are active only, lead first. No settings, harness, ready or issues fields are synthesized.

**Effect/failure:** workspace record lookup plus one member-list read; no design/context filesystem reads, Git processes, model availability checks or harness resolution. Missing workspace returns not_found/404. Stored-member decoding and ordinary owner validation still apply. Detailed team reads and required run/activation checks are unchanged.

**Usage:** chat uses this operation for avatars, mentions and identity refresh. Tests force design and readiness resolution to fail and verify the roster still succeeds.

## REST metadata and legacy inspection cleanup (2025-03-02)

**Result:** Workspace detail GET returns the lightweight workspace record only; it does not load the managed context overview. Active member metadata is exposed through `GET /workspaces/:workspaceId/members`, and one active member through `/workspaces/:workspaceId/members/:memberId`. Agent context is `/members/:memberId/context`. Chat snapshot/timeline/follow/messages/attachments/stop/reset/configuration, group summary and group context use `/chat/...`. Old public `/team` root, `/team/roster`, `/team/members/...` and `/team/chat/...` routes are rejected. Public project-file, design and managed-context browsing routes are removed from workspace route handling, while underlying internal services remain for initialization, persistence, Harness permissions and Agent tools. Member configuration review/activation, workspace/member model settings and provider configuration are retained.

**Input/Output/Effect:** Workspace GET accepts an ID with no query and returns `WorkspaceRecord` (`workspaceId`, `name`, `directory`, `createdAt`). Members GET returns `{workspaceId,members}` with active `memberId`, `workspaceId`, `revision`, `name`, `role`, `responsibility`, `lead`, and `running` fields; single-member GET returns one metadata projection or 404 if not active/in scope. These reads are read-only and do not resolve designs, Harness, readiness, provider availability or private Agent state. Context pages preserve the Pi-message `ContextPage` envelope, pagination/revision and `context_changed`; chat payloads/SSE, publication, image and reset behavior are unchanged. Only their resource URLs changed.

**Usage:** `GET /workspaces` lists workspace records; `GET /workspaces/:id` reads workspace metadata; `/members` populates Chat/Context source labels; `/members/:memberId/context?offset=0&limit=50` pages Agent context; `/chat`, `/chat/summary`, and `/chat/context` provide group chat, summary and group-context inspection.

**Files changed:** Backend: `backend/src/api/http.ts`, `team-routes.ts`, `workspace-routes.ts`; `backend/src/core/team/team-system.ts`, `backend/src/core/workspace/workspace.ts`; `backend/test/team-routes.test.ts`, `workspace-routes.test.ts`. Frontend: `frontend/src/features/workspace/WorkspacePanel.tsx`, `chat-roster.ts`; `frontend/src/shared/backend-client/context-client.ts`, `group-client.ts`, `workspace-client.ts`; tests `chat-images.test.ts`, `context-client.test.ts`, `team.test.ts`, `temporary-workspace.test.ts`. Team design and this README updated.

**Verification:** Backend `npm run check` and `npm test` passed (248 tests). Frontend `npm run check` and `npm test` passed (103 tests). `git diff --check` passed.

**Remaining:** Detailed Workspace/Team feature components and client methods still exist in frontend but target now-retired inspection routes. Temporary workspace mode hides most of these tabs; remove or migrate those consumers before re-enabling them. `WorkspaceService.get()` and workspace creation can still include context overview for internal/creation callers; public GET calls `record()` and avoids the overview. Pre-existing `.rsi/members` deletions were not modified.
