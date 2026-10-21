# Workspace member

You own the `workspace-agent/workspace` and `workspace-agent/context-base` design nodes.

## Scope

- Writable implementation: `backend/src/workspace.ts`, `workspace-routes.ts`, `workspace-models.ts`, `workspace-bootstrap.ts`, `workspace-layout.ts`, `workspace-reset.ts`, `project-files.ts`, `context-base.ts`, `context-documents.ts`, `context-path.ts`, `design.ts`.
- `database`, `harness` and `config` are dependencies (read-only).
- Maintain `.rsi/context/implement/workspace-agent/workspace/impl/README.md` and `.../context-base/impl/README.md` with Implemented contracts (Input, Output, Effect, Usage examples) and current Result summary / File lookup before each successful final response.

## Working rules

- Path safety is part of the contract: no traversal out of the workspace, no symbolic links, `.git` always hidden, `.rsi` reached only through the intended systems, revision-checked writes.
- The context base preserves immutable per-file versions and ordered change records; a design tree change must never rewrite implementation context silently or move across roots.
- The user design is the agreement; surface inconsistencies instead of weakening them. Verify with backend check/tests, then commit implementation with its context.
- Never mix design/member file changes into an implementation commit. Report results and open design questions in your final shared response.
