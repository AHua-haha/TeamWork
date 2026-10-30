# Operations implementation context

## Result summary

Operations owns setup/readiness, dependency installation from lockfiles, host application lifecycle, and this project's supporting MySQL service. The supported project runtime is Node.js 22.19.x LTS across backend, frontend and Electron tooling; Node 26 is rejected for package installs and Electron/Forge packaging. Private version-2 `rsi.config.json` is the single configuration source. It explicitly supplies environment settings, ports, state/release paths, MySQL image/context/Compose identity/container/network/volume, schema accounts, encryption keys and backend options. Initialization uses the checked-in example and generates fresh secrets; it never implicitly reads legacy env files or another checkout's configuration.

**Current local isolation:** team-work uses `team-work-dev-mysql` on 127.0.0.1:13306 with its existing network and volume preserved. Development uses `rsi_agent_dev` and ports 3100/5373. Deployment uses `team_work` and ports 3101/5374; state is `~/.local/state/team-work`, release source `/tmp/team-work-deploy`. The independent RSI service `backend-mysql-1` remains healthy on 3306. Configuration and SQL backups are private files outside Git.

Design: [Operations](../../DESIGN.md).

## Implemented interfaces

### Environment and development

**Input:** `scripts/dev.sh init|start|stop|restart|status|logs [backend|frontend]`, project private config; locked `backend/package-lock.json` and `frontend/package-lock.json`.

**Output:** Validated config, dependency readiness errors, process status/logs, and local backend/frontend on configured loopback ports.

**Effect:** Child processes receive only managed per-environment settings. `dev.sh start` starts/ensures the dedicated DB, provisions the configured development schema/user (no application schema interpretation), and starts backend/frontend; stop stops only those application processes and preserves the database service/data. Dependency setup is `npm ci --prefix backend && npm ci --prefix frontend`.

**Usage:** `nvm install && nvm use`; `npm ci --prefix backend && npm ci --prefix frontend`; `./scripts/dev.sh init`; `./scripts/dev.sh start`; `./scripts/dev.sh status`; `./scripts/dev.sh stop`. Desktop packaging also requires `nvm use` in `desktop/`, then `npm ci` and `npm run make:mac`.

### Desktop backend launcher

**Input:** `scripts/desktop.sh start|stop|status [development|deployment]`.

**Output:** A foreground Electron session connected to the selected backend origin; status/stop records for the selected desktop backend.

**Effect:** Development mode starts the source backend with the development schema/account. Deployment mode starts the selected committed release with deployment settings and schema/account; it refuses when no release is selected. The launcher writes the selected origin to the Electron per-user `desktop.json` only while the session runs, restores the previous file afterward, and does not start the Vite server. It stops a backend it started when Electron exits, while preserving the supporting MySQL service. The command requires Node 22.19.x before starting Electron.

**Usage:** `./scripts/desktop.sh start development`; `./scripts/desktop.sh start deployment`; `./scripts/desktop.sh status development`; `./scripts/desktop.sh stop development`.

### Dedicated supporting database

**Input:** `scripts/database.sh start|stop|status`; `mysql` configuration and separate development/deployment database credentials from `rsi.config.json`.

**Output:** Explicit service lifecycle/status; Compose health waits on start.

**Effect:** Docker Compose arguments select the configured context/project and a generated Compose artifact under the configured state directory; unique project identity and explicit named volume/network/container isolate service resources. Start uses no-recreate; stop only targets this Compose project's MySQL. Configured host port is checked by Compose bind, so another listener causes start refusal without stopping it. Database start provisions and verifies both configured schemas/accounts; app start provisions/verifies its selected environment. Container, network, volume and address ownership mismatches are refused before Compose mutations. Existing containers are not recreated.

**Usage:** `./scripts/database.sh start`, `./scripts/database.sh status`, `./scripts/database.sh stop`.

### Deployment

**Input:** `scripts/deploy.sh` lifecycle/update commands and optional local Git ref.

**Output/effect:** Exported committed local source is built before switching; failures preserve active release or attempt recovery after launch failure. Deployment application database settings stay separately configured and database is never stopped by app stop.

**Usage:** `./scripts/deploy.sh update [git-ref]`; `./scripts/deploy.sh status`.

### Configuration contract

`rsi.config.json` is the sole private project config. Toolchain selection is repository-level: `.nvmrc` and `.node-version` pin Node 22.19.0, while backend/frontend/desktop package manifests declare `>=22.19.0 <23` and package-local `.npmrc` files enable `engine-strict=true`. `mysql.host` must be loopback, project identity is validated, and host port is explicit (initialized to 13306). Initialization generates fresh root/application credentials and separate encryption keys without importing other settings. Existing config migration preserves keys and resource identity explicitly. `backendSettings(config, environment)` creates child-only backend settings. Context compaction threshold and harness switch are explicit per-environment inputs, with positive-safe-integer/Boolean validation and no launcher fallback values. Example template: [rsi.config.example.json](../../../../../../rsi.config.example.json).

### Explicit deployment snapshot copy

**Input:** `node scripts/copy-deployment.mjs <source-config> <source-mysql-container>`. Target configuration must already preserve the source deployment encryption key.

**Output:** Successful table/row counts and a private completed-copy record; refusals for same service, nonempty target, mismatched encryption key or source container identity.

**Effect:** Reads a consistent SQL snapshot from the explicitly selected source, imports it into the isolated target schema, and verifies every table count. Source is never modified. Private backup `database/deployment-source.sql` and `database/deployment-copy.json` live under target state. Repeating a completed copy does nothing. No lifecycle command calls this migration implicitly. Workspace filesystem paths remain as stored.

**Usage:** `node scripts/copy-deployment.mjs /Users/ahua/workspace/rsi-agent/rsi.config.json backend-mysql-1` (this machine's one-time copy is complete).

## Isolation verification (2026-10-27)

- One-time copy: 25 tables / 5,599 rows, all source/target table counts matched before deployment startup.
- Original RSI MySQL on 3306 and isolated team-work MySQL on 13306 both remain healthy; existing team-work development schema and volume retained.
- `deploy.sh deploy HEAD` built backend/frontend from committed `62241967cbebef390584ea69266c219e1faed655` under the new temporary release root and started backend 3101 / frontend 5374.
- Backend and proxy `/agents`, `/workspaces`, `/config/connections` return HTTP 200; copied deployment has three provider connections.
- Development backend/frontend launch independently on 3100/5373 using their own schema/account.
- All 17 host/lifecycle tests passed, both deployment package builds passed, and the current frontend configuration built successfully. All three copied encrypted provider credentials were verified decryptable without printing them. Repeating the copy command made no changes.
- Lifecycle tests cover private template initialization, explicit configuration, polluted ambient environments, build/launch recovery, ownership refusals and frontend streaming proxy.

## Earlier development verification

The following records describe the earlier setup, before the port and deployment isolation adjustment:


- `docker ps` initially showed existing `backend-mysql-1` on 127.0.0.1:3306.
- `./scripts/dev.sh init` generated private config with port 13306 and project `team-work`.
- `./scripts/dev.sh start` first refused because the existing process record had a different config fingerprint; `./scripts/dev.sh restart` cleanly restarted only this project's frontend/backend processes, preserving the database.
- `curl http://127.0.0.1:3000/agents`: HTTP 200 with `[]` (no registered workspaces/agents in this development state).
- `curl http://127.0.0.1:3000/workspaces`: HTTP 200 with `{"workspaces":[]}`.
- `curl http://127.0.0.1:5273/`: HTTP 200; Vite served the app entry page.
- `./scripts/dev.sh status` and `./scripts/database.sh status`: isolated DB and both dev application processes reported running; Docker confirmed separate services at ports 13306 and 3306.
- `npm --prefix backend run check`: passed.
- `npm --prefix backend test`: 247 passed, 0 failed, 1 platform-dependent test skipped.

## File lookup

- [scripts](../../../../../../scripts): lifecycle/configuration implementation and isolated host tests.
- [scripts/host-config.mjs](../../../../../../scripts/host-config.mjs): configuration validation and generated MySQL service definition.
- [scripts/desktop.mjs](../../../../../../scripts/desktop.mjs) and [scripts/desktop.sh](../../../../../../scripts/desktop.sh): selected-environment backend plus Electron launcher.
- [scripts/copy-deployment.mjs](../../../../../../scripts/copy-deployment.mjs): explicit one-time SQL snapshot migration.
- [rsi.config.example.json](../../../../../../rsi.config.example.json): private-config template.
- [backend/package.json](../../../../../../backend/package.json), [frontend/package.json](../../../../../../frontend/package.json): dependency manifests and lifecycle scripts.
- [frontend](../../../../../../frontend): front-end source.

## Remaining work and risks

- Local private config is machine-specific and must be retained securely; template values are placeholders. Do not commit the private config.
- Database isolation does not duplicate project directories referenced by copied workspaces.
- npm audit findings require separate dependency/security triage; automatic upgrades were not attempted.
- Deployment uses committed source only; current uncommitted controller/source changes are not automatically added to Git.

## Automatic retrieval

```json
{"commands": []}
```
