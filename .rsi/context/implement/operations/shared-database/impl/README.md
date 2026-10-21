# Shared local database lifecycle — implementation context

## Result summary

The database CLI delegates from `database.sh` to `database.mjs`; development provisioning is also called by the local-dev lifecycle. The scripts use the existing Compose file via shared helpers. No source edits and no tests were run. Compose configuration details were not directly inspected.

## File lookup

| Path | Description |
|---|---|
| `scripts/database.sh` | Directory-independent database CLI wrapper. |
| `scripts/database.mjs` | Compose start/stop/status and development SQL provisioning. |
| `scripts/host-common.mjs` | Compose project/file arguments, DB URL checks, child process helpers. |
| `backend/compose.yaml` | Compose infrastructure configuration referenced by code (not read in this pass). |

## Automatic retrieval

```json
{"commands": []}
```

## Implemented contract

**Inputs:** `scripts/database.sh start|stop|status`. `start` runs Docker Compose `up -d --wait mysql`; `stop` runs Compose `stop mysql`; `status` checks Compose running services. Development provisioning is an exported `provisionDevelopment(settings)` API used by `develop.mjs`, not a separate CLI option.

**Outputs/errors:** Status prints `MySQL: running` or `MySQL: stopped/unavailable`; Compose or provisioning failures report nonzero errors. Provisioning rejects settings unless the parsed MySQL database is exactly `rsi_agent_dev` and username exactly `rsi_dev`, and rejects passwords outside `[A-Za-z0-9_-]{1,128}`.

**Effects:** Start/stop operate on MySQL service under Compose project `backend` and `backend/compose.yaml`; stop does not remove volumes. Provisioning sends SQL to container `mysql` over stdin (not password command arguments): create database if absent with utf8mb4, create/alter `rsi_dev` user, and grant all privileges on `rsi_agent_dev.*`. Repeated provisioning does not drop/truncate database records. Runtime root credential is inherited from container environment via `MYSQL_PWD` inside `docker exec` shell.

**Usage:** `scripts/database.sh start`; `scripts/database.sh status`; dev lifecycle internally calls `startDatabase()` and `provisionDevelopment(settings)`.

## Implementation notes / continuation

`databaseStatus()` checks output of `docker compose ... ps --status running --services mysql` for exact `mysql`; command errors yield false. `database.mjs` direct CLI catches errors and exits nonzero. Dev provisioning validates identity and password before issuing SQL. Deployment does not provision its existing database/account.

Inspect `backend/compose.yaml` to verify the design's MySQL 8.4 image, loopback 3306 mapping and named volume. Verify safe credential behavior under the actual Compose environment and repeated start/stop without removing volume. No destructive database actions were performed; no tests run.

## File lookup extras

| Path | Description |
|---|---|
| `scripts/dev.sh`, `scripts/develop.mjs` | Application start path that ensures DB service and provisions the development DB. |
| `scripts/deploy.sh`, `scripts/deployment.mjs` | Deployment starts shared MySQL but retains existing deployment DB/account. |
| `scripts/test/deployment.test.mjs` | Existing ops-related test file; not run. |

## Automatic retrieval notes

The entry-point Automatic retrieval section above is the only retrieval configuration for this context; no commands are needed.
