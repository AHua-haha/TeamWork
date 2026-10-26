# Team implementation context

## Result summary

Team owns membership, provider/application/member configuration, shared chat and presentation data. Its data/ part aggregates models, validation, file serialization, schemas, SQL repositories and transient coordination state. Agent owns its own private context/history/run/compaction persistence; Workspace owns its own registry/context/models persistence.

Design: [Team](../../../../../design/backend/core/team/design.md).

### Implemented contract

**Input:** TeamData(storage,agentData,workspaceData,connection?), ConfigData(storage,agentData,membership,connection?), ConfigService(configData,models,tools?,key?), TeamSystem(teamData,workspaceService,configService,...). TeamExecutionData owns transient active member/run and finalizing job references used by TeamRunner.

**Output:** Existing member/configuration/chat/snapshot/timeline interfaces and original GroupContextReference. readGroupContext(workspaceId,after) returns detached sender-visible Pi messages from the resident Team model; transaction-bound reads use the caller's durable snapshot without populating that model. ConfigData returns application/provider/catalog/saved solo-agent model profiles; these are Team-managed user configuration, distinct from Agent execution state.

**Effect and failure:** schema.ts owns members, member_activation, config_records, chat_images/settings/exchanges/messages/context_entries/runs/clock/entries/changes. TeamData writes only these tables. Agent/Workspace data is read or changed through their public transaction-scoped operations. Team still owns final-text selection, mention parsing, publication refusal, reservations and shared-workspace sequential execution. Stable frontend history/reference formats and HTTP/SSE payloads do not change; model-facing group context has its own ordered rows. TeamExecutionData keeps an accepted sender’s finalizing job until Agent finishes maintenance; settling an old job cannot remove a successor activation.

**Usage example:** const data = new CoreData(storage); construct ConfigService(data.config,...), WorkspaceService(data.workspaces,config), TeamSystem(data.team,workspaces,config); attach new AgentRuntime(data.agents,team.runConfig,team.policy(...),stream). Publish via team.runner.postUser and await runtime.finished for private finalization.

### Incremental resident group-context contract

**Input:** GroupContextEntry is {messageId,message: Pi Message,metadata: JsonObject}. groupEntry constructs the public user-role input with [Group message N], authoritative Sender and recipient prefix plus text/native images. Metadata contains source, workspaceId, groupPosition, exchangeId, copied author/recipients, optional attachment metadata and finalRef. validateGroupContextEntry enforces matching sender content/metadata, public role, native images and valid origin. Private assistant thinking/tools are not copied into shared context.

**Output:** readGroupContext(id,after) returns detached original entries through GroupContextReference, with sender/origin derived from metadata for Agent's reconciliation. GroupContextState owns ordered messages; GroupContexts lazily loads one model per workspace and shares it across transaction views. A binary search selects the new suffix. Each Agent continues to own its own consumption position.

**Effect and failure:** chat_context_entries holds one versioned complete entry per (workspace_id,position), with unique (workspace_id,id). chat_settings.position/reset_position/context_length/context_format provide small bounds/count/migration bookkeeping. Normal publishChat inserts one new context row with shared history, exact final reference, presentation and recipient admission in one transaction. Existing context rows are untouched. Shared context is a materialized public projection; chat_messages member records still contain only the stable private final reference, and frontend history resolves it as before.

The first root read loads settings and ordered rows in one repeatable-read transaction; later root reads use memory, without rereading private finals or image blobs. Initial-load races reconcile commit notifications by position. Bound reads use the existing SQL transaction and do not install speculative resident state. afterCommit callbacks advance resident state only after the outer commit; rollback changes none of it. Uncertain commit acknowledgement or notification gaps invalidate the model so the next read restores actual durable state without replay. Loading checks row count, identity/order, metadata and sender/native-content agreement; missing rows fail explicitly.

Reset deletes context rows with shared history and Agent conversations, advances reset boundaries and zeros context_length, then empties the resident model after commit. CoreData.close calls TeamData.close to release group models before Storage shutdown. Administrative clearConversations releases them after its outer commit. Context memory remains resident for loaded workspaces; no eviction or group compaction policy is introduced.

Migration creates chat_context_entries and adds chat_settings.context_format/context_length. Old settings are marked format 0; CoreData.migrate imports older timeline history, then invokes migrateGroupContext before Agent legacy-context adoption. Backfill resolves exact published final bodies and prepared images once through owner operations, preserves IDs/order/time/authorship/recipients/origins, writes all rows/count/format atomically per workspace and retries safely after failure. Existing frontend history/private records are unchanged; no user-data reset is needed. Stop the old backend before startup migration.

**Usage example:** two members consume the same shared range from one resident model; accepted publication inserts a row and later reads see the same committed Pi message with sender content. Integration tests prevent UPDATE/DELETE of existing context rows during two normal runs, count one load and verify reopen/image/origin preservation.

### Transaction and lifecycle coordination

TeamData.inTransaction(connection) and ConfigData.inTransaction(connection) join the existing transaction. Publication locks Workspace through its public port, gets narrow Agent execution states, validates an immutable completed final through AgentData, then commits its shared record/reference together with Agent sender completion and recipient admission. Team never reads agents/runs/messages/context_compactions SQL directly. Snapshot/stop run lookups use Agent-owned batch reads rather than a query per linked run. Presentation completion callbacks remain atomic with Agent terminal state. Member activation obtains Workspace model revision and Agent idle checks through owner interfaces. Chat reset deletes Team references then asks Agent to clear member conversations on the same transaction. Core’s administrative reset uses owner deletion operations in dependency order.

TeamData owns the resident shared Pi context. TeamRunner supplies original shared references and idle synchronization notifications to AgentRuntime; it neither restores nor persists Agent context. Busy members buffer shared updates until Agent work boundaries. Restart recovery of private context/compaction belongs to Agent. Team’s importChatHistory migration reads old linked runs/history through Agent operations and owns the resulting shared presentation changes. The semantic-range design is implemented. `TeamData` owns `chat_semantic_indexes` plus semantic watermark/revision columns, validates complete hierarchical submissions against source digests, range coverage, existing member IDs and authoritative sender/mention involvement, and exposes detached indexes through the Agent group reference. `TeamSystem` schedules one asynchronous maintenance run after 32,000 newly uncovered public-message token estimates, supplies the full pinned context plus the previous result, and installs the `submit_group_semantic_information` capability. Publication remains non-blocking; stale or failed submissions leave the prior revision/watermark unchanged. `TeamRunner` triggers scheduling after accepted publication. The Agent deterministic projection replaces uninvolved ranges with summaries, recursively opens involved ranges, preserves involved leaves/uncovered messages and native images, and runs only at compaction. Focused semantic projection tests are in `backend/test/semantic-context.test.ts`.

### Semantic mechanism verification

`npm run check` passes. The full backend suite passes: 231 tests, 231 passed. `backend/test/semantic-context.test.ts` covers summary replacement, recursive opening of involved ranges, involved-leaf preservation and uncovered-message fallback. `git diff --check` passes. Direct live-provider semantic generation remains dependent on the configured model provider; rejected or failed maintenance submissions intentionally leave the previous index unchanged.

### Context inspection

**Input:** `TeamSystem.inspectGroupContext(workspaceId, {offset?,limit?,revision?})` delegates to TeamData's same operation through ChatStore. `TeamSystem.requireContextMember(workspaceId,memberId)` checks workspace existence, member ownership and non-retirement before the API calls Agent's inspection port. It does not resolve harnesses/model configuration or run synchronization.

**Output:** Group inspection returns `{revision,offset,total,nextOffset,entries}` using original `GroupContextEntry` records. The revision is `chat_settings.position`; reset advances that position, while semantic-index updates alone do not change original shared context. Group entry Pi role can be user even for a member sender; metadata.author and explicit sender text carry authorship. Private thinking/tools are not copied into shared context.

**Effect/failure:** A repeatable-read transaction reads workspace presence, chat settings and the bounded ordered rows after reset_position. No full resident load, private-history joins, repair, maintenance or mutation occurs. Defaults and errors match Agent pagination: offset 0, limit 50/max100, later-page revision required, changed revision context_changed/409. Unknown workspaces and out-of-workspace/retired/missing members return not_found/404. Existing tables and lifecycle bookkeeping suffice; no migration is added.

**Usage example:** `await team.inspectGroupContext(id,{limit:50})` returns original shared entries for debugging; use its revision and nextOffset to continue. To inspect private context, first validate the member scope, then call AgentRuntime.inspectContext rather than querying Agent SQL from Team.

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
