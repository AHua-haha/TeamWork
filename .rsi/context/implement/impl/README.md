## Result summary

The backend five-layer restructure is **complete through Phase 3** on branch `feat/rsi-design-tree`.

**Completed phases:**
- **Phase 0 (Design)** — Root `design.md` "Backend layering" section with five layers + import rules + labeled violations; two new nodes `backend-foundation` and `backend-api`; all `metadata.json` paths updated to layer subdirectories; four member prompt files updated. Commits `0024ff7`, `5034bcf`.
- **Phase 1 (Physical restructure)** — All 51 `.ts` files moved to `foundation/`, `storage/`, `domain/`, `api/`, `runtime/`; all relative imports rewritten in src/, test/, scripts/; `tsc --noEmit` passes clean. Commit `b164779`.
- **Phase 2 (Foundation cycle fix)** — `ProgressEvent` type moved into `foundation/types.ts`; `progress.ts` now imports only from Foundation; cycle broken. Commit `51bdb80`.
- **Phase 3 (Storage interface)** — `Store` interface extracted to `storage/store.ts`; Domain and Runtime depend on interface instead of concrete `MySqlStore`; `main.ts` wires the implementation. Commits `5034bcf`, `5b21682`.

**Remaining labeled debt (not blocking):**
- `storage/database.ts` imports 8 domain modules for parsing/validation — Phase 4, deferred as complex refactor
- `foundation/codec.ts` imports `domain/context-base.ts` types — low cost, deferred
- `foundation/tool-result.ts` imports `domain/runtime.ts` — low cost, deferred
- `domain/workspace-reset.ts` accesses `store.pool` directly — retained as acceptable
- `domain/harness.ts` is a 17-module hub — deferred

**Next steps:** Further domain sub-splitting (domain/config/, domain/workspace/, domain/team/, domain/harness/, domain/agent/) as the user requested, followed by implementation context repair per member.

## File lookup

| Path | Description |
| --- | --- |
| `backend/src/foundation/` | Five foundation files: types, codec, changes, text, tool-result |
| `backend/src/storage/database.ts` | Single storage layer file |
| `backend/src/domain/` | 38 domain files + providers/ |
| `backend/src/api/` | HTTP, routes, helpers, index |
| `backend/src/runtime/main.ts` | Composition root |
| `.rsi/context/design/design.md` | Root design + Backend layering section |
| `.rsi/context/design/backend-foundation/` | New foundation design node |
| `.rsi/context/design/backend-api/` | New API design node |
| `.rsi/context/design/<node>/metadata.json` | Implementation mappings updated to layer paths |

## Automatic retrieval

```json
{"commands": []}
```
