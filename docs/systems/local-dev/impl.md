# Local development lifecycle implementation

## Contract

[Development lifecycle](design.md). Preserve existing deployment data/key before switching development; application stops must leave shared MySQL available.

## Responsibilities and decomposition

The development entry point owns the source backend/Vite pair. [Shared database](../shared-database/design.md) owns server lifecycle and development SQL provisioning. [Host deployment](../host-deployment/design.md) owns the compiled release pair. Common process/configuration helpers are shared implementation, not a new application runtime.

## Coordination and data flow

The shell entry point resolves its own project path and invokes develop.mjs. init saves the legacy backend environment to durable deployment settings before creating the development file. start stops any positively identified legacy two-line PID processes, initializes settings, verifies installed dependencies, ensures shared database/provisions development, and launches Node/tsx then Vite with readiness checks. Vite receives explicit host/port/strictPort arguments and a same-origin backend proxy target. Child environment-file settings override accidentally inherited database/key values.

## Decisions and constraints

Common process records use PID, ps start time, entry marker and a configuration fingerprint; legacy records supply their known source entry marker. A restart is required for changed settings. start rollback stops only a newly started backend if frontend fails. Shared MySQL is never stopped by an app command. Log tail/status are read-only. Durable lifecycle locking serializes environment mutation commands.

## Code map

- [Development wrapper](../../../scripts/dev.sh) and [orchestrator](../../../scripts/develop.mjs).
- [Common configuration/process ownership](../../../scripts/host-common.mjs).
- [Database coordination](../../../scripts/database.mjs).
- [Environment example](../../../backend/.env.example) and [root usage](../../../README.md).

## Verification

[Lifecycle tests](../../../scripts/test/deployment.test.mjs) cover preserved credentials, independent configuration, development-stop isolation and ownership. Real development/deployment smoke checks verify empty development data and current deployed data on one MySQL service. Evidence is recorded under the host-deployment task.
