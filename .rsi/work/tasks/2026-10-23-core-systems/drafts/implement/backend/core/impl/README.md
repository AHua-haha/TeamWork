<!-- Task implementation; promote with verified source. -->
# Core implementation context

## Result summary

Core now composes Agent, Harness, Workspace and Team. Persistence is an explicitly assigned responsibility: Agent can execute entirely in memory; Team is the durable application caller. Workspace maintains project information through a database-neutral persistence port.

Design: [Core](../../../../design/backend/core/design.md).

### Coordination and ownership

Runtime constructs the shared technical MySqlStorage and TeamData durable adapter, then services and TeamRuntime. TeamRuntime creates AgentExecution instances and acknowledges their events. Workspace registration invokes parent Core bootstrap to prepare the root context and initial Team lead; TeamData commits registration atomically. The parent also coordinates administrative filesystem reset with Team-owned record deletion.

### Implemented contract

**Input:** Application service inputs, the technical storage resource and operator settings.

**Output:** The composed existing Core service interfaces, run/history/progress and explicit failures.

**Effect and failure:** SQL and durable codecs belong to Team, optional in-memory execution to Agent, tool authority/environment to Harness, project information management to Workspace. Core common helpers define no extra design system.

**Usage example:** Use Runtime composition in backend/src/runtime/main.ts. Start with MySqlStorage and TeamData, construct ConfigService, WorkspaceService, TeamSystem and TeamRuntime, attach the team, initialize and open.

## File lookup

- [backend/src/core/errors.ts](../../../../../../backend/src/core/errors.ts): common application errors and identifier validation.

- [backend/src/core/codec.ts](../../../../../../backend/src/core/codec.ts): owned source.
- [backend/src/core/text.ts](../../../../../../backend/src/core/text.ts): owned source.
- [backend/src/core/changes.ts](../../../../../../backend/src/core/changes.ts): owned source.
- [backend/src/core/validation.ts](../../../../../../backend/src/core/validation.ts): owned source.
- [backend/src/core/workspace-bootstrap.ts](../../../../../../backend/src/core/workspace-bootstrap.ts): owned source.
- [backend/src/core/workspace-reset.ts](../../../../../../backend/src/core/workspace-reset.ts): owned source.
- [agent](../agent/impl/README.md): child implementation.
- [harness](../harness/impl/README.md): child implementation.
- [workspace](../workspace/impl/README.md): child implementation.
- [team](../team/impl/README.md): child implementation.
- [Backend tests](../../../../../../backend/test): unit/HTTP, in-memory execution, boundary and disposable SQL integration checks.

## Automatic retrieval

```json
{"commands": []}
```
