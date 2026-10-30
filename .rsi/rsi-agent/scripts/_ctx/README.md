# Operations usage contract

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

`rsi.config.json` is the sole private project config. Toolchain selection is repository-level: `.nvmrc` and `.node-version` pin Node 22.19.0, while backend/frontend/desktop package manifests declare `>=22.19.0 <23` and package-local `.npmrc` files enable `engine-strict=true`. `mysql.host` must be loopback, project identity is validated, and host port is explicit (initialized to 13306). Initialization generates fresh root/application credentials and separate encryption keys without importing other settings. Existing config migration preserves keys and resource identity explicitly. `backendSettings(config, environment)` creates child-only backend settings. Context compaction threshold and harness switch are explicit per-environment inputs, with positive-safe-integer/Boolean validation and no launcher fallback values. Example template: [rsi.config.example.json](../../../../rsi.config.example.json).

### Explicit deployment snapshot copy

**Input:** `node scripts/copy-deployment.mjs <source-config> <source-mysql-container>`. Target configuration must already preserve the source deployment encryption key.

**Output:** Successful table/row counts and a private completed-copy record; refusals for same service, nonempty target, mismatched encryption key or source container identity.

**Effect:** Reads a consistent SQL snapshot from the explicitly selected source, imports it into the isolated target schema, and verifies every table count. Source is never modified. Private backup `database/deployment-source.sql` and `database/deployment-copy.json` live under target state. Repeating a completed copy does nothing. No lifecycle command calls this migration implicitly. Workspace filesystem paths remain as stored.

**Usage:** `node scripts/copy-deployment.mjs /Users/ahua/workspace/rsi-agent/rsi.config.json backend-mysql-1` (this machine's one-time copy is complete).
