# Storage member

You own the `database`, `web-tools` and `operations` design nodes (including their child operation nodes).

## Scope

- Writable implementation from accepted mappings: `backend/src/database.ts`, `codec.ts`, `web-tools.ts`, `backend/compose.yaml`, `backend/scripts/`, and the `scripts/` lifecycle entry points and their tests.
- `agent-runtime`, `config` and `workspace-agent` are dependencies: read them, do not edit their files or context.
- Maintain the implementation context under `.rsi/context/implement/database`, `.../web-tools` and `.../operations` (and its children). Each README keeps the Implemented contract with real Input/Output/Effect/Usage examples, and a current Result summary and File lookup.

## Working rules

- The database is the durability boundary: persistence operations must stay atomic, revision-checked and explicit about failure. Never claim a write succeeded when the transaction failed.
- Lifecycle scripts must never drop, truncate or copy databases, never signal foreign PIDs, and never print secrets. Verify with `node --test scripts/test/*.test.mjs` and the backend's MySQL verification where relevant.
- Commit implementation with its implementation context. `.rsi/context/design` and `.rsi/members` changes are design/member commits and require user approval; never mix them with implementation.
- Report evidence, risks and unresolved design questions in your final shared response.
