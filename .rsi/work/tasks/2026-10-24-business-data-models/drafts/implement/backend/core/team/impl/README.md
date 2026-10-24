> Proposed for 2026-10-24-business-data-models; delivered with source.

# Team implementation context

## Result summary

Team owns membership, provider/application/member configuration, shared chat and presentation data. Its data/ part aggregates models, validation, file serialization, schemas, SQL repositories and transient coordination state. Agent owns its own private context/history/run/compaction persistence; Workspace owns its own registry/context/models persistence.

Design: [Team](../../../../../design/backend/core/team/design.md).

### Implemented contract

**Input:** TeamData(storage,agentData,workspaceData,connection?), ConfigData(storage,agentData,membership,connection?), ConfigService(configData,models,tools?,key?), TeamSystem(teamData,workspaceService,configService,...). TeamExecutionData owns transient active member/run and finalizing job references used by TeamRunner.

**Output:** Existing member/configuration/chat/snapshot/timeline interfaces and original GroupContextReference. readGroupContext(workspaceId,after) resolves sender text, native pictures and accepted private origin records in one repeatable-read snapshot. ConfigData returns application/provider/catalog/saved solo-agent model profiles; these are Team-managed user configuration, distinct from Agent execution state.

**Effect and failure:** schema.ts owns members, member_activation, config_records, chat_images/settings/exchanges/messages/runs/clock/entries/changes. TeamData writes only these tables. Agent/Workspace data is read or changed through their public transaction-scoped operations. Team still owns final-text selection, mention parsing, publication refusal, reservations and shared-workspace sequential execution. Stable SQL/JSON formats and HTTP/SSE payloads do not change. TeamExecutionData keeps an accepted sender’s finalizing job until Agent finishes maintenance; settling an old job cannot remove a successor activation.

**Usage example:** const data = new CoreData(storage); construct ConfigService(data.config,...), WorkspaceService(data.workspaces,config), TeamSystem(data.team,workspaces,config); attach new AgentRuntime(data.agents,team.runConfig,team.policy(...),stream). Publish via team.runner.postUser and await runtime.finished for private finalization.

### Transaction and lifecycle coordination

TeamData.inTransaction(connection) and ConfigData.inTransaction(connection) join the existing transaction. Publication locks Workspace through its public port, gets narrow Agent execution states, validates an immutable completed final through AgentData, then commits its shared record/reference together with Agent sender completion and recipient admission. Team never reads agents/runs/messages/context_compactions SQL directly. Snapshot/stop run lookups use Agent-owned batch reads rather than a query per linked run. Presentation completion callbacks remain atomic with Agent terminal state. Member activation obtains Workspace model revision and Agent idle checks through owner interfaces. Chat reset deletes Team references then asks Agent to clear member conversations on the same transaction. Core’s administrative reset uses owner deletion operations in dependency order.

TeamRunner supplies original shared references and idle synchronization notifications to AgentRuntime; it neither restores nor persists Agent context. Busy members buffer shared updates until Agent work boundaries. Restart recovery of private context/compaction belongs to Agent. Team’s importChatHistory migration reads old linked runs/history through Agent operations and owns the resulting shared presentation changes. Group summarization/structured extraction/member-specific views remain deferred.

## File lookup

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
