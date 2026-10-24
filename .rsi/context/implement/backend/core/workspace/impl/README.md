# Workspace implementation context

## Result summary

Workspace owns and aggregates registry, model settings, accepted baseline, context/file/history schemas, validation and related memory/durable operations under data/. It no longer receives a Team persistence adapter.

Design: [Workspace](../../../../../design/backend/core/workspace/design.md).

### Implemented contract

**Input:** WorkspaceData(storage,hooks,connection?) implements ContextStore; WorkspaceService(workspaceData,modelValidator) and reusable ContextBase accept that owner port. data/context-base.ts defines registry/context/file/history values and in-memory indexing; data/models.ts, paths.ts, documents.ts and validation.ts define model choices and context formats.

**Output:** Existing workspace/context/models/baseline/file/history views and explicit conflicts. WorkspaceData exposes requireWorkspace(id,lock?) and getWorkspaceModels for cross-owner validation without exposing SQL rows.

**Effect and failure:** WorkspaceData owns workspaces, workspace_models, workspace_git_baselines, context_blobs/versions/files/records SQL and schema. Sequence/revision checks and file rollback semantics remain. inTransaction(connection) joins the caller’s transaction without committing it. Core supplies required lead/bootstrap and optional default-model initialization callbacks; only Team writes Team member/configuration/activation records. initialMemberFiles returns a narrow accepted-file map for legacy baseline import, replacing a hidden cast to TeamStore. No private member/chat/run records are interpreted by Workspace.

**Usage example:** const data = new CoreData(storage); const workspaces = new WorkspaceService(data.workspaces,config); await workspaces.create(input); const context = await workspaces.context(workspaceId). Core’s created callback atomically registers the Team lead alongside Workspace’s registry/models/context/bootstrap. Close workspace watchers before the storage graph.

DesignService keeps accepted recursive working roots, dependencies, pending-design authority and native file access unchanged. Source ownership changes preserve all existing rows/versions and require no metadata reset.

## File lookup

- [backend/src/core/workspace/data](../../../../../../../backend/src/core/workspace/data): registry/context models and owned SQL.

- [backend/src/core/workspace](../../../../../../../backend/src/core/workspace): owned source.
- [reference/workspace-agent/context-base/design-parts/design.md](reference/workspace-agent/context-base/design-parts/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/context-base/design-parts/impl.md](reference/workspace-agent/context-base/design-parts/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/context-base/design.md](reference/workspace-agent/context-base/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/context-base/impl.md](reference/workspace-agent/context-base/impl.md): detailed existing behavior and code map.
- [reference/workspace-agent/workspace/design.md](reference/workspace-agent/workspace/design.md): detailed existing behavior and code map.
- [reference/workspace-agent/workspace/impl.md](reference/workspace-agent/workspace/impl.md): detailed existing behavior and code map.
- [Backend tests](../../../../../../../backend/test): unit/HTTP, in-memory execution, boundary and disposable SQL integration checks.

## Automatic retrieval

```json
{"commands": []}
```
