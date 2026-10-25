# Operations implementation context

## Result summary

Operations owns setup/readiness, dependency installation from lockfiles, development and deployment processes, and the isolated development MySQL service lifecycle. Project settings are centralized in private `rsi.config.json`; it is generated on `dev.sh init` (mode 0600), not committed. The development MySQL Compose project is `team-work`, with container `team-work-dev-mysql`, network `team-work-dev-network`, volume `team-work-dev-mysql-data`, loopback host port 13306, and dedicated development credentials. It is distinct from the pre-existing `backend-mysql-1` service on 3306. Development and deployment application settings remain separate; only the dedicated dev service is managed by `database.sh`.

**Current local setup:** private root `rsi.config.json` has been initialized and dependencies installed with `npm ci` under backend and frontend. Dedicated MySQL was created, health-checked, provisioned, and exercised by successful dev backend/frontend startup. Both applications and the dedicated service were then stopped cleanly. The pre-existing service remains running and untouched. Private config contains secrets and is not tracked.

Design: [Operations](../../../design/operations/design.md).

## Implemented interfaces

### Environment and development

**Input:** `scripts/dev.sh init|start|stop|restart|status|logs [backend|frontend]`, project private config; locked `backend/package-lock.json` and `frontend/package-lock.json`.

**Output:** Validated config, dependency readiness errors, process status/logs, and local backend/frontend on configured loopback ports.

**Effect:** Child processes receive only managed per-environment settings. `dev.sh start` starts/ensures the dedicated DB, provisions the configured development schema/user (no application schema interpretation), and starts backend/frontend; stop stops only those application processes and preserves the database service/data. Dependency setup is `npm ci --prefix backend && npm ci --prefix frontend`.

**Usage:** `./scripts/dev.sh init`; `npm ci --prefix backend && npm ci --prefix frontend`; `./scripts/dev.sh start`; `./scripts/dev.sh status`; `./scripts/dev.sh stop`.

### Dedicated supporting database

**Input:** `scripts/database.sh start|stop|status`; `mysql` configuration and development database credentials from `rsi.config.json`.

**Output:** Explicit service lifecycle/status; Compose health waits on start.

**Effect:** Docker Compose arguments select the configured context/project and repository Compose file; unique project identity and explicit named volume/network/container isolate service resources. Start uses no-recreate; stop only targets this Compose project's MySQL. Configured host port is checked by Compose bind, so another listener causes start refusal without stopping it. No deployment DB settings are used for provisioning.

**Usage:** `./scripts/database.sh start`, `./scripts/database.sh status`, `./scripts/database.sh stop`.

### Deployment

**Input:** `scripts/deploy.sh` lifecycle/update commands and optional local Git ref.

**Output/effect:** Exported committed local source is built before switching; failures preserve active release or attempt recovery after launch failure. Deployment application database settings stay separately configured and database is never stopped by app stop.

**Usage:** `./scripts/deploy.sh update [git-ref]`; `./scripts/deploy.sh status`.

### Configuration contract

`rsi.config.json` is the sole private project config. `mysql.host` must be loopback, project identity is validated, and host port is explicit (initialized to 13306). Initialization generates a root credential and separate development encryption key while retaining imported deployment credentials; it does not modify legacy env files. `backendSettings(config, environment)` creates child-only backend settings. Context compaction threshold defaults to 64,000 and validates positive safe integers independently for development/deployment. Example template: [rsi.config.example.json](../../../../../rsi.config.example.json).

## Verification

- `docker ps` initially showed existing `backend-mysql-1` on 127.0.0.1:3306.
- `./scripts/dev.sh init` generated private config with port 13306 and project `team-work`.
- `./scripts/database.sh start` created and health-checked the dedicated container; `./scripts/dev.sh start` successfully started both app processes.
- Confirmed separate containers/ports and distinct `backend_mysql-data` vs `team-work-dev-mysql-data` volumes.
- `./scripts/dev.sh stop`, `./scripts/database.sh stop` left `backend-mysql-1` running on 3306.
- `node --test scripts/test/*.test.mjs`: 15 passed.
- `npm --prefix backend test`: 228 passed; `npm --prefix frontend test`: 88 passed.
- Backend/frontend `npm run check`: passed.
- npm reported dependency audit issues (backend: 6 total, including 5 high; frontend: 3 high); no audit fix was applied.

## File lookup

- [scripts](../../../../../scripts): lifecycle/configuration implementation and isolated host tests.
- [backend/compose.yaml](../../../../../backend/compose.yaml): MySQL service definition.
- [rsi.config.example.json](../../../../../rsi.config.example.json): private-config template.
- [backend/package.json](../../../../../backend/package.json), [frontend/package.json](../../../../../frontend/package.json): dependency manifests and lifecycle scripts.
- [frontend](../../../../../frontend): front-end source.

## Remaining work and risks

- Local private config is machine-specific and must be retained securely; template values are placeholders. Do not commit the private config.
- Deployment database service provisioning/lifecycle is intentionally not coupled to this dev-only service.
- npm audit findings require separate dependency/security triage; automatic upgrades were not attempted.
- Source/service setup is not a deployed release; deployment remains an explicit operator action.

## Automatic retrieval

```json
{"commands": []}
```
