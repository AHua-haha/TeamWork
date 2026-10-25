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

### Context-preserving workspace initialization

**Input:** WorkspaceService.inspectInitialization({directory,adopt}); create({name,directory,adopt,models,workspaceId?,cleanupRevision?}). Inspection returns canonical directory, cleanupPaths and cleanupRevision|null. A valid reviewed SHA-256 revision is required to remove nonempty non-context state; missing/stale consent raises cleanup_required/409 before mutation. Existing registered/overlapping paths remain workspace_exists/409.

**Output:** The initialized Workspace and context overview. Existing valid UTF-8 context files and missing root templates are imported at context sequence 1, with preserved design bytes as the accepted bootstrap baseline. The fresh lead's working root is metadata.json.

**Effect and failure:** workspace-initialization.ts owns reserved-path inspection, recursive non-context stat fingerprint, exclusive file additions and reversible staging under .rsi/.initialization-*. Existing context files are never rewritten/deleted; hidden/binary/unsupported context entries remain physically intact and normal inspection reports supported problems. Honor root design.md versus design/README.md and impl.md versus impl/README.md. Missing files are added only. Non-context metadata symlinks are removed as links without accessing targets. Protected root/required-document symlinks and case collisions fail. Failed preparation/SQL registration removes additions and restores staged metadata; source and Git are untouched. Staging is not a crash journal and assumes no concurrent external filesystem writer. Registration success precedes removal of staged state.

**Usage example:** review = await workspaces.inspectInitialization({directory,adopt:true}); after the user confirms its cleanupPaths, call workspaces.create({...input,cleanupRevision:review.cleanupRevision ?? undefined}). Context-only projects need no consent. ContextBase and bootstrap use the same data/context-scan.ts to discover indexable files. No SQL schema migration is needed.

### Workspace deletion

**Input:** WorkspaceService.delete(workspaceId), coordinated by TeamSystem.deleteWorkspace; ContextStore.deleteWorkspace is the durable owner port. WorkspaceDataHooks.deleting(db,id) lets Core compose Team/Agent/profile removal on the same transaction.

**Output:** Promise<void>; not_found/404 for missing identity. Host-facing deletion does not require the project directory to exist or be readable.

**Effect and failure:** WorkspaceData locks the registry row, invokes Core's owner lifecycle callback, removes only this workspace's baseline/models/context files/versions/blobs/records and registry, then commits atomically. WorkspaceService serializes deletion with create, marks the workspace unavailable during removal, closes any open ContextBase and drains its queue before SQL removal. Registry/cache entries are invalidated on both success and failure; on failure the next access reloads the durable outcome. A per-ID lifecycle generation prevents an earlier delayed read from repopulating a deleted registry cache. SQL rollback preserves all durable rows; a closed context handle can reopen from the surviving registry. No filesystem remove/write operation is used. Existing .rsi remains for normal reviewed initialization if later re-adopted.

**Usage example:** await team.deleteWorkspace(id) through the hosted service; DELETE /workspaces/:id returns {workspaceId:id}. Unit/disposable SQL tests verify preserved files, missing directories, rollback, stale cache reads, re-adoption and exclusion of unrelated data.

## File lookup

- [backend/test/workspace-deletion.test.ts](../../../../../../../backend/test/workspace-deletion.test.ts): file preservation, busy refusal, shell/job cleanup, failure reopening and delayed-cache-read prevention.

- [backend/src/core/workspace/workspace-initialization.ts](../../../../../../../backend/src/core/workspace/workspace-initialization.ts): read-only metadata inspection, cleanup revision, reversible staging and exclusive missing-file creation.
- [backend/src/core/workspace/data/context-scan.ts](../../../../../../../backend/src/core/workspace/data/context-scan.ts): shared discovery/limits for bootstrap imports and live context indexing.
- [backend/src/core/workspace-bootstrap.ts](../../../../../../../backend/src/core/workspace-bootstrap.ts): Core coordination of preserved context and fresh lead/baseline.

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
