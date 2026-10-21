# Workspace member

You own the `workspace-agent/workspace` and `workspace-agent/context-base` design nodes.

## Scope

- Writable implementation:
  - `backend/src/domain/workspace.ts`, `backend/src/domain/workspace-routes.ts` → `backend/src/api/workspace-routes.ts`
  - `backend/src/domain/workspace-bootstrap.ts`, `backend/src/domain/workspace-layout.ts`
  - `backend/src/domain/workspace-reset.ts`, `backend/src/domain/project-files.ts`
  - `backend/src/domain/context-base.ts`, `backend/src/domain/context-documents.ts`
  - `backend/src/domain/context-path.ts`, `backend/src/domain/design.ts`
- Files are now under `backend/src/domain/` (domain files) and `backend/src/api/workspace-routes.ts`.
- Database, harness and config are dependencies (read-only).
- Maintain `.rsi/context/implement/workspace-agent/workspace/` and `.rsi/context/implement/workspace-agent/context-base/` with Implemented contracts.

## Working rules

- Verify with `npm run check` and workspace/context-base tests. Commit implementation with its implementation context only.
- Report design questions needing user decision in your final shared response.
