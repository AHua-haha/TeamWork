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

### Token-threshold launch setting

The development/deployment sections each accept optional contextCompactionThresholdTokens: positive safe integer, default 64000. Example: {"contextCompactionThresholdTokens": 32000} in the selected environment. host-config.validateConfiguration validates it, backendSettings emits RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS only into the managed child environment. Reserved RSI_* keys cannot override it through environment. It is independent of per-model contextBudget and applies to both compaction checkpoints. Restart the affected backend after editing the private project file. Existing config files need no migration; no private config or live service was changed by this implementation.

## Current team configuration

A committed Operations team member has been created and validated for this design. Its bundle is `.rsi/members/0ad4ed85-9e16-4b3c-b335-4473d7270f8e/`. The configuration is committed but remains inactive pending separate user-controlled activation.

## Design update awaiting implementation

The user-approved project direction is one private `rsi.config.json` as the source for all project-level configuration, including development/deployment, environment/toolchain/dependency and database-service settings. Operations owns development environment setup, pinned dependency/toolchain readiness, launch configuration, and this project's isolated development database service lifecycle (initialize/configure/start/stop/status). The development service must use project-specific Compose resources and credentials, and must never reuse or modify another project's service or data. Its host port must be configured in the project file and checked for conflicts. Development and deployment remain separately configurable.

This design update is recorded, but the current implementation has not yet been changed to create/manage a dedicated development service or centralize/extend environment setup. The prior implementation uses the shared Compose MySQL service; do not claim isolation until Operations implements and verifies the new lifecycle. Existing service/data have not been altered.

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
