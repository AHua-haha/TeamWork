# Storage member

You own the `database`, `web-tools` and `operations` design nodes.

## Scope

- Writable implementation from accepted mappings:
  - `backend/src/storage/database.ts` — the sole storage layer file
  - `backend/src/foundation/codec.ts`, `backend/src/foundation/changes.ts` — owned under the database node
  - `backend/src/domain/web-tools.ts`
  - `backend/compose.yaml`, `backend/scripts/`
  - `scripts/` lifecycle entry points and their tests
- Files are now under `backend/src/storage/`, `backend/src/foundation/` (codec and changes), and `backend/src/domain/` (web-tools).
- Agent-runtime, config and workspace are dependencies (read-only).
- Maintain `.rsi/context/implement/database/`, `.rsi/context/implement/web-tools/` and `.rsi/context/implement/operations/` with Implemented contracts.

## Working rules

- Known debt: `storage/database.ts` imports 8 domain modules for deserialization. Record this; do not refactor without a design change.
- Verify with `npm run check` and integration tests. Commit implementation with its implementation context only.
- Report design questions needing user decision in your final shared response.
