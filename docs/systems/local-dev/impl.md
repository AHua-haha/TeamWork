# Local development lifecycle implementation

## Contract

[Development lifecycle](design.md). Preserve existing deployment data/key before switching development; application stops must leave shared MySQL available.

## Responsibilities and decomposition

The development entry point owns the source backend/Vite pair. [Shared database](../shared-database/design.md) owns server lifecycle and development SQL provisioning. [Host deployment](../host-deployment/design.md) owns the compiled release pair. Common process/configuration helpers are shared implementation, not a new application runtime.

## Coordination and data flow

The shell entry point resolves its own project path and invokes develop.mjs. host-config imports legacy settings into project rsi.config.json once without editing the old files; future commands use only this JSON file. start stops any positively identified legacy two-line PID processes, initializes settings, verifies installed dependencies, ensures shared database/provisions development, and launches Node/tsx then Vite with readiness checks. Vite receives explicit host/port/strictPort arguments and a same-origin backend proxy target. A clean allowlisted host environment plus explicit config-derived application values replaces broad process.env inheritance. Shell wrappers remove Node startup injection only from their own child environment, never from the caller. Direct backend npm commands use backend-command.mjs and the same development config.

## Decisions and constraints

Common process records use PID, ps start time, entry marker and a configuration fingerprint; legacy records supply their known source entry marker. A restart is required for changed settings. start rollback stops only a newly started backend if frontend fails. Shared MySQL is never stopped by an app command. Log tail/status are read-only. The checkout-owned .run/manage.lock serializes environment mutation commands.

## Code map

- [Development wrapper](../../../scripts/dev.sh) and [orchestrator](../../../scripts/develop.mjs).
- [Common configuration/process ownership](../../../scripts/host-common.mjs).
- [Database coordination](../../../scripts/database.mjs).
- [Configuration example](../../../rsi.config.example.json) and [root usage](../../../README.md).

## Verification

[Lifecycle tests](../../../scripts/test/deployment.test.mjs) cover preserved credentials, independent configuration, development-stop isolation and ownership. Real development/deployment smoke checks verify empty development data and current deployed data on one MySQL service. Evidence is recorded under the host-deployment task.

## Project configuration authority

[scripts/host-config.mjs](../../../scripts/host-config.mjs) owns JSON schema validation, one-time import, private atomic creation, shared-address derivation and clean child environments. [Project example](../../../rsi.config.example.json) contains no credentials. Legacy env files are migration inputs only and remain untouched. HOST/PORT/database/key/proxy/output directories are generated from the chosen config section for each child. No process.env mutation or shell-profile write is used. Application readiness bypasses ambient proxies. Service fingerprints cover all passed settings so changed credentials/options require restart; deployment/development and Docker remain separately owned.
