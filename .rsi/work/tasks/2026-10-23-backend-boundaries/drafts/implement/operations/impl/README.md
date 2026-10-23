<!-- Task implementation; promoted with verified code. -->
# Operations implementation context

## Result summary

Project scripts retain the existing shared database service and separate dev/deployment settings. Source/compiled backend entries now follow Runtime. Previously selected flat-entry compiled releases can still restart during rollback.

Design: [Operations](../../../design/operations/design.md).

### Coordination and ownership

host-config reads the project private config and constructs isolated child settings. develop launches source/Vite; deployment exports committed Git source, installs/builds, then switches application processes. database manages the supporting service/accounts, never interprets application models.

### Implemented contract

**Input:** Project commands (`dev.sh`, `deploy.sh`, `database.sh`), a private mode-0600 rsi.config.json, optional explicit Git ref.

**Output:** Build/release selection, process status/logs and application/service lifecycle. update defaults to local committed HEAD; no fetch, checkout switch or uncommitted source deployment.

**Effect and failure:** Settings remain child-process-only. Build failure preserves the running release; launch failure attempts recovery. Stop app leaves MySQL/data intact. No live config, database or deployment is modified by this source migration.

**Usage example:** `./scripts/dev.sh start`; `./scripts/deploy.sh update [git-ref]`; `./scripts/deploy.sh status`. Install backend/frontend dependencies before development. Review root README for required local tools and isolated lifecycle tests.

## File lookup

- [scripts](../../../../../scripts): owned implementation.
- [backend/scripts](../../../../../backend/scripts): owned implementation.
- [backend/compose.yaml](../../../../../backend/compose.yaml): owned implementation.
- [rsi.config.example.json](../../../../../rsi.config.example.json): owned implementation.
- [reference/host-deployment/design.md](reference/host-deployment/design.md): migrated existing behavior/code reference, not a child design.
- [reference/host-deployment/impl.md](reference/host-deployment/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/local-dev/design.md](reference/local-dev/design.md): migrated existing behavior/code reference, not a child design.
- [reference/local-dev/impl.md](reference/local-dev/impl.md): migrated existing behavior/code reference, not a child design.
- [reference/shared-database/design.md](reference/shared-database/design.md): migrated existing behavior/code reference, not a child design.
- [reference/shared-database/impl.md](reference/shared-database/impl.md): migrated existing behavior/code reference, not a child design.
- [Host tests](../../../../../scripts/test): isolated Git/state/process fixtures; no live service mutation.

## Automatic retrieval

```json
{"commands": []}
```
