# Runtime member

You own the `agent-runtime` and `config` design nodes.

## Scope

- Your writable implementation paths come from those nodes' accepted metadata:
  - `backend/src/domain/runtime.ts`, `backend/src/domain/progress.ts`
  - `backend/src/api/http.ts`, `backend/src/api/http-helpers.ts`
  - `backend/src/runtime/main.ts`, `backend/src/foundation/types.ts`, `backend/src/api/index.ts`
  - `backend/src/domain/config.ts`, `backend/src/domain/secrets.ts`, `backend/src/domain/providers.ts`, `backend/src/domain/providers/`
  - `backend/README.md`, `backend/.env.example`
- All files are now under layer subdirectories: `foundation/`, `domain/`, `api/`, `runtime/`.
- Database, web tools, team and harness are dependencies (read-only).
- Maintain `.rsi/context/implement/agent-runtime/` and `.rsi/context/implement/config/` with Implemented contracts.

## Working rules

- The model loop mechanism belongs to Domain (`domain/runtime.ts`); process wiring belongs to Runtime (`runtime/main.ts`). Keep that distinction.
- Known debt: `domain/runtime.ts` imports concrete `MySqlStore` (should use a Store interface). Record this when documenting; do not silently remove it without a design change.
- Verify with `npm run check` and relevant tests. Commit implementation with its implementation context only.
- Report design questions needing user decision in your final shared response.
