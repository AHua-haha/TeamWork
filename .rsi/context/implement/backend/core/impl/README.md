# Core implementation context

## Result summary

All current agent-system behavior lives together in `backend/src/core`. Business persistence moved from database.ts to core-data.ts; the agent loop moved from runtime.ts to agent-runtime.ts. Internal decomposition is deliberately deferred.

Design: [Core](../../../../design/backend/core/design.md).

### Coordination and ownership

ConfigService resolves settings/providers. WorkspaceService and TeamSystem coordinate workspaces, members, design, harness, group chat and approvals. AgentRuntime runs models/tools; ConversationContext assembles member context. CoreData owns SQL, schemas, codecs, concurrency, record queries and runtime ownership. API consumes these Core operations; it never issues SQL.

### Implemented contract

**Input:** Core service method arguments: IDs, input values, expected revisions/cursors and decisions. CoreData takes one dedicated MySqlStorage instance. AgentRuntime takes Core persistence, config, policy and model stream dependencies.

**Output:** Service records, run identities, consistent history/progress, review data or AppError failures. CoreData methods return application records interpreted/validated inside Core.

**Effect and failure:** Core owns business memory and durable formats, migrations, admission, lease/recovery and transactions. CoreData.close releases its runtime lease and closes its dedicated Storage resource. Duplicate-key engine errors become business conflicts here, not in Storage.

**Usage example:** `const storage = new MySqlStorage(databaseUrl); const data = new CoreData(storage); await data.migrate();` Construct ConfigService/WorkspaceService/TeamSystem/AgentRuntime as shown in the backend README. Close runs and workspace resources before `await data.close()`. Do not create a second runtime owner for the same database.

## File lookup

- [backend/src/core](../../../../../../backend/src/core): owned implementation.
- [backend/prompts](../../../../../../backend/prompts): owned implementation.
- [reference/agent-runtime/design.md](reference/agent-runtime/design.md): migrated existing behavior/code reference, not a child design.
- [reference/agent-runtime/impl.md](reference/agent-runtime/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/config/design.md](reference/config/design.md): migrated existing behavior/code reference, not a child design.
- [reference/config/impl.md](reference/config/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/database/design.md](reference/database/design.md): migrated existing behavior/code reference, not a child design.
- [reference/database/impl.md](reference/database/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/web-tools/design.md](reference/web-tools/design.md): migrated existing behavior/code reference, not a child design.
- [reference/web-tools/impl.md](reference/web-tools/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/context-base/design-parts/design.md](reference/workspace-agent/context-base/design-parts/design.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/context-base/design-parts/impl.md](reference/workspace-agent/context-base/design-parts/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/context-base/design.md](reference/workspace-agent/context-base/design.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/context-base/impl.md](reference/workspace-agent/context-base/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/harness/design.md](reference/workspace-agent/harness/design.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/harness/impl.md](reference/workspace-agent/harness/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/harness/tools/bash/design.md](reference/workspace-agent/harness/tools/bash/design.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/harness/tools/bash/impl.md](reference/workspace-agent/harness/tools/bash/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/harness/tools/design.md](reference/workspace-agent/harness/tools/design.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/harness/tools/impl.md](reference/workspace-agent/harness/tools/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/team/conversation-context/design.md](reference/workspace-agent/team/conversation-context/design.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/team/conversation-context/impl.md](reference/workspace-agent/team/conversation-context/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/team/design.md](reference/workspace-agent/team/design.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/team/group-chat/design.md](reference/workspace-agent/team/group-chat/design.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/team/group-chat/impl.md](reference/workspace-agent/team/group-chat/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/team/impl.md](reference/workspace-agent/team/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/team/lead/design.md](reference/workspace-agent/team/lead/design.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/team/lead/impl.md](reference/workspace-agent/team/lead/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/workspace/design.md](reference/workspace-agent/workspace/design.md): migrated existing behavior/code reference, not a child design.
- [reference/workspace-agent/workspace/impl.md](reference/workspace-agent/workspace/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/modelflare-inventory.md](reference/modelflare-inventory.md): migrated existing behavior/code reference, not a child design.
- [Backend tests](../../../../../../backend/test): deterministic/unit/HTTP and disposable MySQL verification.

## Automatic retrieval

```json
{"commands": []}
```
