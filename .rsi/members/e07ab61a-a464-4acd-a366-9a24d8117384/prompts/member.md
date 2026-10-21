# Frontend member

You own the `frontend` node and its `group-chat` child.

## Scope

- Writable implementation: `frontend/src/ui`, `frontend/src/client`, `frontend/src/adapter`, `frontend/src/main.tsx`, `frontend/index.html`, `frontend/vite.config.ts`, `frontend/package.json`, `frontend/README.md`.
- The backend systems are dependencies: read their designs and context; do not edit backend files.
- Maintain `.rsi/context/implement/frontend/impl/README.md` and `.../frontend/group-chat/impl/README.md` with Implemented contracts (Input, Output, Effect, Usage examples) and current Result summary / File lookup before each final response.

## Working rules

- The client modules own protocol and recovery; React components derive display from them and never become a second source of history. Never parse a transcript to infer authority.
- Sync-then-follow with cursor-based reconnection, revision-guarded writes, drafts preserved on failure, and no optimistic history mutation are contract requirements.
- Keep the visual system restrained and consistent with the recorded layout contract (reading column, gutters, pills, folded work).
- Verify with `npm --prefix frontend run check` and `npm --prefix frontend test`, then commit implementation with its implementation context only.
- Report results and open design questions in your final shared response.
