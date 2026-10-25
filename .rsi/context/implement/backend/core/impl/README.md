# Core implementation context

## Result summary

Core composes Agent, Harness, Workspace and Team. Each owns its in-memory schema, persistence model and related operations under data/. CoreData is a composition/lifecycle coordinator with no business SQL, table list or inherited monolithic repository.

Design: [Core](../../../../design/backend/core/design.md).

### Implemented contract

**Input:** CoreData(MySqlStorage). Public properties agents: AgentData, workspaces: WorkspaceData, team: TeamData and config: ConfigData (Team-owned settings).

**Output:** Owner data-model interfaces plus migrate(), resetRuntimeRecords(connection) and close(). There are no forwarded Agent/Workspace CRUD methods on CoreData.

**Effect and failure:** Owner inTransaction(connection) operations share one caller-controlled Storage transaction; nested owner work never starts or commits another transaction. Core wires Agent-created application-profile and run-finished presentation callbacks, Workspace-created lead/activation and default-model callbacks, and a narrow accepted-member-files read. Owners interpret their own rows and return domain values. Bootstrap, publication/admission, member activation and reset retain original atomicity and lock order. Immutable message envelopes and HTTP/SSE formats remain unchanged. Agent active context migrates to ordered rows and a resident cross-run model; owner memory changes acknowledge the outer transaction through Storage.afterCommit. Migration initializes Agent, Workspace and Team schemas, imports old shared presentation through Team, then asks Agent to adopt its legacy contexts through Team read references. No migration rewrites ordinary stable history or resets user data.

**Usage example:** const data = new CoreData(storage); await data.migrate(); inject data.agents into AgentRuntime, data.workspaces into WorkspaceService, data.team into TeamSystem and data.config into ConfigService. Shutdown the runtime/services before data.close(). Administrative reset quarantines files then calls resetRuntimeRecords on one Storage-managed transaction; Core calls owner deletion operations in dependency order, preserving provider/application settings.

### Ownership map

- Agent: execution state/context/progress, private completed history, compaction and runtime ownership/recovery.
- Team: member/configuration/shared-chat/presentation models and transient admission/finalization references.
- Workspace: registry/models, context/files/history and accepted baseline.
- Harness: configuration/resource/scope/tool-input/approval models and session-bound approval operations; execution resources remain process-local.
- data-transaction.ts and codec.ts provide schema-neutral shared mechanics. Domain validators live under their owner, rather than being re-exported from the common codec.

## File lookup

- [backend/src/core/data.ts](../../../../../../backend/src/core/data.ts): owner composition, cross-owner hooks and lifecycle.
- [backend/src/core/data-transaction.ts](../../../../../../backend/src/core/data-transaction.ts): schema-neutral SQL/transaction helpers.

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
