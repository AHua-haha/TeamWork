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

TeamData owns the resident shared Pi context. TeamRunner supplies original shared references and idle synchronization notifications to AgentRuntime; it neither restores nor persists Agent context. Busy members buffer shared updates until Agent work boundaries. Restart recovery of private context/compaction belongs to Agent. Team’s importChatHistory migration reads old linked runs/history through Agent operations and owns the resulting shared presentation changes. Group summarization/structured extraction/member-specific views remain deferred.

### Workspace deletion lifecycle

**Input:** TeamSystem.deleteWorkspace(workspaceId); TeamData.deleteWorkspace(workspaceId) is a transaction-scoped owner operation returning the deleted member IDs.

**Output:** Hosted Promise<void>; workspace_busy/409 for admitted/running/finalizing member work or unfinished durable compaction, not_found/404 for missing workspace.

**Effect and failure:** TeamRunner.idleWorkspace holds the existing admission/configuration gate. TeamData locks workspace/member identities, calls AgentData.assertIdle, deletes only Team-owned group/timeline/context/image/exchange/settings/activation/member rows, and invalidates shared residents on commit/uncertainty. Core owns deletion of foreign Agent/profile rows. A group-context durable load validates registry existence, so invalidated references cannot silently read a deleted workspace as an empty group. After successful database removal, stop member shells/jobs and clear progress; refusals do not stop shells. idleWorkspace publishes a change to wake history followers; missing records become explicit unavailable/not_found errors. No project file is removed.

**Usage example:** await team.deleteWorkspace(id); busy callers stop team work and retry after it finishes. Retired members are included; global app/provider/model-cache records remain intact.

### Member design-maintenance responsibility

**Input:** MemberInstructions.build(memberId,ownPrompt) with active member role and Harness-provided working/dependency context; TeamSystem.policy composes it with HarnessService.prepare.

**Output:** Worker role instructions allow maintenance of assigned working designs/accepted descendants and require reporting design changes to the user. Only outside-scope changes and unsettled user decisions require handoff to the lead/responsible member using the existing mention header. Lead instructions retain whole-project design coordination, member management and user clarification responsibilities.

**Effect and failure:** Update role guidance without rewriting active member bundles or private message history. Harness supplies the shared required Markdown in both permission modes. Existing routing, scheduling, mention limits, tool authorization and commit/activation behavior remain unchanged.

**Usage example:** an in-scope design correction is described in the worker's shared final response; an interface change in a read-only dependency is brought to its owner/lead. team-context.test.ts assembles actual model requests with explicit dependencies and recursive accepted child designs for both roles/modes and checks that obsolete lead-only design instructions are absent.

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
