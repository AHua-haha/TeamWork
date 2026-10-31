---
summary: Owns project configuration, development and deployment lifecycle, Desktop test launching, and isolated MySQL service management.
include:
  - scripts/dev.sh
  - scripts/develop.mjs
  - scripts/desktop.sh
  - scripts/desktop.mjs
  - scripts/database.sh
  - scripts/database.mjs
  - scripts/deploy.sh
  - scripts/deployment.mjs
  - scripts/host-config.mjs
  - scripts/host-common.mjs
  - scripts/backend-command.mjs
  - scripts/serve-frontend.mjs
  - scripts/copy-deployment.mjs
  - scripts/test/host-config.test.mjs
  - scripts/test/deployment.test.mjs
  - rsi.config.example.json
  - .rsi/rsi-agent/desktop/_ctx/README.md
  - desktop/package.json
---

# Operations usage contract

Operations manages the project-owned environment configuration, development and deployment processes, the optional Desktop test launcher, and the supporting MySQL service. Backend Core owns application records and schema behavior; Operations only creates/checks the configured database and account and supplies connection settings to child processes.

## Configuration and isolation

`rsi.config.json` is the only private project configuration source. Commands initialize it from `rsi.config.example.json` when it is absent, replace template placeholders, generate fresh root/application passwords and per-environment encryption keys, validate the result, and write it with private permissions. Existing configuration is preserved; legacy `.env` files, ambient application variables, another checkout's settings and hidden fallback values are not imported.

The configuration contains absolute state paths, one loopback MySQL service identity, separate development and deployment ports, schemas, application accounts, encryption keys, environment variables and context-compaction thresholds. Development and deployment database names, accounts, keys and backend ports must remain distinct. The harness permission switch is retired and ignored if present; the configured positive safe-integer `contextCompactionThresholdTokens` is passed to the selected backend as `RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS`.

Child processes receive a filtered host environment plus explicit project settings. Application variables such as `DATABASE_URL`, `CONFIG_ENCRYPTION_KEY`, `HOST`, `PORT`, `NODE_ENV`, `AGENT_BACKEND_ORIGIN`, Compose variables and `NODE_OPTIONS` do not leak from the caller. Lifecycle commands use a project state directory, per-process records, logs and a lock so concurrent mutations refuse cleanly.

## Development lifecycle

**Commands**

```sh
./scripts/dev.sh init
./scripts/dev.sh start
./scripts/dev.sh stop
./scripts/dev.sh restart
./scripts/dev.sh status
./scripts/dev.sh logs [backend|frontend]
```

`start` verifies development dependencies, starts the configured project-owned MySQL service without recreating an existing container, provisions/checks the development schema and account, then starts the TypeScript backend and Vite frontend on the configured loopback ports. The frontend receives only the selected backend origin. `stop` and `restart` stop application processes recorded for this project and preserve the MySQL service, volume and data. `status` reports MySQL and application process state without requiring source releases. `logs` prints the saved backend/frontend log paths and the last 60 lines, either for both services or for the selected service.

A busy backend or frontend port refuses before that service starts. A running process with changed settings requires `restart`; stale or mismatched PID records are ignored or removed without signaling unrelated processes. Startup failures stop a backend started by the same command and leave the database service untouched.

## Supporting MySQL service

**Commands**

```sh
./scripts/database.sh start
./scripts/database.sh stop
./scripts/database.sh status
```

The service is generated at runtime from `rsi.config.json` into `<stateDirectory>/database/compose.json`; there is no checked-in `backend/compose.yaml` used by these commands. Docker Compose runs with the configured Docker context, project identity, named container, network, volume and loopback host port. The generated service uses the configured MySQL image and health check.

`start` validates ownership of an existing container, network and volume before Compose can mutate anything, then starts MySQL with `--no-recreate` and waits for health. It provisions and verifies both configured application schemas/accounts. `stop` only stops this project's MySQL container. `status` reports whether the configured Compose service is running. Foreign resources, mismatched credentials/image/address/volume, occupied ports and invalid configuration refuse without stopping or resetting another service. These commands do not interpret, migrate or copy application records.

## Desktop test launcher

**Commands**

```sh
./scripts/desktop.sh start development
./scripts/desktop.sh start deployment
./scripts/desktop.sh stop development
./scripts/desktop.sh status development
```

The environment argument defaults to `development` and must be `development` or `deployment`. `start` requires Node.js 22.19.x, initializes configuration, starts/checks the project MySQL service and selected schema/account, and starts the selected backend. Development uses the checkout's TypeScript entry; deployment uses the selected compiled release from deployment state. Deployment refuses when no release is selected or when the manifest belongs to another checkout.

The launcher writes `{ "backendOrigin": "http://127.0.0.1:<backend-port>" }` to the Electron per-user `desktop.json`, runs `npm start` in `desktop/` in the foreground, and restores the previous file when Electron exits. `npm start` builds the shared frontend, stages its output, compiles the Electron host and invokes Electron Forge; this launcher does not run Vite. If the launcher started the backend, it stops that backend after Electron exits. It leaves the supporting MySQL service and data running. `stop` stops only the selected launcher backend; `status` reports its PID. Deployment `stop`/`status` require a valid selected release because backend resolution reads the deployment manifest.

The Electron package remains responsible for its own window, preload, proxy and packaging behavior. Operations only supplies the temporary origin and process lifecycle. See the [Desktop usage contract](../../desktop/_ctx/README.md) for the renderer and proxy boundary.

## Deployment lifecycle

**Commands**

```sh
./scripts/deploy.sh init
./scripts/deploy.sh deploy <git-ref>
./scripts/deploy.sh update [git-ref]
./scripts/deploy.sh start
./scripts/deploy.sh stop
./scripts/deploy.sh restart
./scripts/deploy.sh status
./scripts/deploy.sh logs [backend|frontend]
```

`deploy <git-ref>` resolves a committed local Git ref, refuses revisions containing private `rsi.config.json`, exports the commit into the configured temporary deployment source root, installs locked backend/frontend dependencies, builds both packages, starts the deployment backend and static frontend, and records an owned `active.json` manifest. The active release is selected only after build and launch succeed.

`update` defaults to committed `HEAD`; it preserves uncommitted checkout files and accepts an explicit local ref. If a build fails, the current manifest and running release remain active. If launch fails after a switch, Operations stops the failed attempt and tries to relaunch the previous release when one was running. A selected release keeps its original compiled backend entry so older releases can restart after source layout changes. Missing release directories are rebuilt from the manifest's commit. `start`, `stop`, `restart`, `status` and `logs` operate on the selected deployment and its saved process records/logs. Deployment application settings and database remain separate from development, and stopping the application never stops MySQL.

## Explicit database snapshot copy

The one-time migration command is separate from normal lifecycle commands:

```sh
node scripts/copy-deployment.mjs <source-project-config> <source-mysql-container>
```

The target must already have its deployment encryption key set to the source key and must use a distinct MySQL service. The source container must belong to the configured source project and address. The command starts/provisions the target service, refuses a nonempty target or empty source, dumps a consistent source snapshot, imports it into the target deployment schema, verifies every table row count and records a private completion marker plus checksum. It never modifies the source, does not copy workspace filesystem paths, and does nothing on a repeat with the same completed identity. Normal `dev`, `desktop` and `deploy` commands never invoke this copy.

## Failure and recovery guarantees

Configuration, ownership, port, release and dependency failures are explicit nonzero exits with credential-safe messages. Operations does not stop unrelated processes or services, does not delete a selected release before a replacement is built, and preserves database service/data across application stop. Earlier filesystem or database effects can remain after a later failure, so recovery uses the saved state, manifest and explicit lifecycle commands. The current test fixtures cover configuration isolation, resource ownership, release build/launch recovery, stale process records, lock recovery, old release entries and snapshot safety.

## Open design discrepancies

The current DESIGN explicitly requires generated Compose configuration; implementation agrees by generating `<stateDirectory>/database/compose.json` from `scripts/host-config.mjs`. An older member instruction still lists `backend/compose.yaml` as owned implementation, but that is not a current DESIGN requirement. The DESIGN also still requires a harness-permission switch, whereas Runtime DESIGN and current launch settings retire/ignore it; this conflicting requirement needs confirmation before changing DESIGN. The one-time deployment copy command exists, but historical completion cannot be verified from checked-in files. Desktop's host and the optional Operations launcher have distinct lifecycle ownership: Electron connects to an external backend, while the launcher may start/stop that backend around a session. This boundary is consistent across current contracts; no behavior changed here.
