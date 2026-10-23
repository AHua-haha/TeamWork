# Workspace implementation context

## Result summary

Workspace owns project registration/configuration, accepted design mappings, context/file validation, indexing/history and project access. It uses the public ContextStore persistence contract and has no MySQL dependency. TeamData is the current caller-provided durable implementation.

Design: [Workspace](../../../../../design/backend/core/workspace/design.md).

### Coordination and ownership

WorkspaceService validates directories/models and serializes creation. Core prepareWorkspace builds initial root context and Team lead files, then the injected store atomically registers them. ContextBase indexes and records public change batches. DesignService resolves accepted metadata/documents and recursive working roots; harnesses consume those public results.

### Implemented contract

**Input:** WorkspaceService(store: ContextStore, config model validator), create/get/list/models/updateModels/context/files; public context/file/design operations with paths, revisions and content.

**Output:** Workspace views, validated model choices, accepted design information, file content/index/history and explicit conflicts/refusals.

**Effect and failure:** Files reside in registered project directories and RSI context roots. The injected persistence adapter stores public registry/context records; Workspace retains semantic validation. Failed registration cleans only its new managed files/folder. Pending design edits grant no source authority. Workspace does not interpret SQL records or run agent loops.

**Usage example:** const workspaces = new WorkspaceService(teamData, config); const view = await workspaces.get(workspaceId); const context = await workspaces.context(workspaceId); Use context/file operations with their returned revision and close workspaces on shutdown.

## File lookup

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
