# RSI Agent

## Development and host deployment

Each checkout owns an isolated local MySQL service. Development and deployment share that service, with separate databases and accounts. This team-work installation uses:

| | Development | Deployment |
| --- | --- | --- |
| Database | `rsi_agent_dev` (new, initially empty) | `team_work` (one-time copy of RSI deployment) |
| Backend | `http://127.0.0.1:3100` | `http://127.0.0.1:3101` |
| Frontend | `http://127.0.0.1:5373` | `http://127.0.0.1:5374` |
| Source | This project checkout | Committed snapshots under `/tmp/team-work-deploy/` |
| Settings | `rsi.config.json` → `development` | `rsi.config.json` → `deployment` |
| Logs/PIDs | `.run/` | `~/.local/state/team-work/deploy/` |

Requires Node.js 22.19.x LTS, npm, Git, tar, curl, ps and Docker Compose. Use the repository `.nvmrc` or `.node-version`; Node 26 is outside the supported project range. Application processes run directly on the host. The team-work service listens on 13306 and retains its existing `team-work` Compose project, container, network and volume. The original RSI service on 3306 is independent and remains unchanged.

### Initialize this checkout

Select the supported Node runtime before installing dependencies:

```sh
nvm install
nvm use
node --version
```

The project packages enforce Node `>=22.19.0 <23` with `engine-strict=true`. Run each package's `npm ci` only under Node 22.19.x.


```sh
./scripts/dev.sh stop
./scripts/deploy.sh init
./scripts/deploy.sh deploy HEAD
./scripts/dev.sh start
```

Initialization creates **`rsi.config.json` at this project’s root**. It uses `rsi.config.example.json`, resolves its project/home path placeholders, and generates fresh passwords and separate encryption keys. It never imports legacy env files, another checkout’s settings or saved deployment state. Review the configured ports/resource names before first start. Initialization does not copy any data. Existing version-1 private configuration requires an explicit migration to version 2; preserve its keys and data-volume identity.

The version-2 config contains the MySQL image, container/network/volume names, Compose network key (preserve it for existing resources), host/port, separate `development` and `deployment` database accounts/keys/backend options, service ports, a pinned Docker context, and `paths` for state and temporary release source. Run `init` to generate it; use [rsi.config.example.json](rsi.config.example.json) as a field reference, not as replacement credentials. The real file is mode 0600 and Git-ignored. **Preserve both encryption keys** to keep saved provider credentials readable. Never force-add the real file to Git; deployment refuses revisions containing it.

The launchers construct settings only for their own child processes. They do not edit shell profiles, export variables into the caller, rewrite `.env` files or change Docker’s global context. Ambient `DATABASE_URL`, provider keys, `PORT`, `RSI_*`, `NODE_OPTIONS`, proxy and `COMPOSE_*` variables cannot override service inputs. Minimal OS/toolchain variables such as PATH/HOME/locale remain available. Configure intentional backend credentials/proxy options under that environment’s `environment` object. Other processes using the same OS user can still deliberately edit files permitted to that user; the config is not an OS security boundary.

`deploy <git-ref>` requires a local committed revision containing these deployment scripts. It excludes uncommitted edits, installs locked dependencies and builds both packages in a separate temporary source snapshot. The compiled backend runs with deployment settings; a host frontend server serves the built assets and streams API/uploads/SSE to that backend. Build failure leaves the current release running. Failed launch attempts recovery of the previous running release; database migrations are not rolled back.

The scripts do not copy or move registered workspace/project directories. Those files stay at their existing paths. Register different project directories in development when filesystem isolation is required.

### Manage development

Install development dependencies once with `npm ci` in `backend/` and `frontend/`:

```sh
./scripts/dev.sh start
./scripts/dev.sh restart
./scripts/dev.sh status
./scripts/dev.sh logs backend
./scripts/dev.sh stop
```

Development uses Vite and the source backend. `init` initializes the project configuration without launching applications. A legacy managed development process is stopped before `start` switches it to the development database. Configure development provider connections independently through its UI. Direct backend npm commands also read the project configuration’s development section. Vite does not load separate `.env` files.

### Run the desktop app with a selected backend

Operations can start the backend for one environment, configure the Electron app for that backend for the duration of the session, and run the desktop host in the foreground:

```sh
./scripts/desktop.sh start development
./scripts/desktop.sh start deployment
```

`development` uses the source backend and development database; `deployment` uses the selected committed deployment release and deployment database. Deployment must already have a selected release (`./scripts/deploy.sh deploy <git-ref>`). The command starts only the selected backend and Electron app; it does not start the Vite web server. When Electron exits, the launcher stops a backend it started and restores the previous per-user Desktop config. The project MySQL service remains running. Use `./scripts/desktop.sh status development|deployment` or `stop development|deployment` for the desktop launcher backend records.

### Manage deployment

```sh
./scripts/deploy.sh deploy HEAD
./scripts/deploy.sh update
./scripts/deploy.sh update <git-ref>
./scripts/deploy.sh start
./scripts/deploy.sh restart
./scripts/deploy.sh status
./scripts/deploy.sh logs frontend
./scripts/deploy.sh stop
```

`update` updates an existing deployment to the current project checkout’s committed `HEAD`; pass a branch, tag or commit to select another version. It builds before replacing the running application and uses the same recovery as `deploy`. It does not fetch/pull, switch your checkout, include uncommitted edits or change settings/database. If that commit is already selected, healthy processes are reused.

`start` uses the selected commit. If its temporary source was cleaned, it rebuilds that exact commit from local Git. The source/build directories are replaceable; deployment settings, logs, release selection and user workspaces must remain outside them. No automatic boot supervisor or public exposure is configured.

Edit the project `rsi.config.json` to change ports, paths or credentials, then restart the affected service. Each environment explicitly sets `"contextCompactionThresholdTokens"` (positive integer; example 256000). One threshold triggers private Agent compaction before model calls and after work; restart the backend to apply changes. Original group messages remain unabridged. Agent tools currently execute through File and Default React Harnesses without path/design, command, sandbox or Git approval restrictions. Commands use the backend OS account's ordinary permissions and host HOME/toolchains. Input validation, timeouts, resource cleanup and separate user member activation remain. Existing `harnessPermissionsEnabled` fields are ignored; new configuration files omit them. The former `RSI_STATE_DIR`, `XDG_STATE_HOME`, `RSI_DEPLOY_ROOT` and deployment-port environment overrides are ignored. `paths.deploymentSourceRoot` must stay beneath temporary storage. All state/log/release-selection paths come from configuration. Deployment manifests record their owning checkout and refuse foreign ownership. The lifecycle lock is `manage.lock` under the configured development state directory.

### Manage this project’s database service

```sh
./scripts/database.sh start
./scripts/database.sh status
./scripts/database.sh stop
```

Application startup can ensure MySQL is running. Stopping either application or a failed application launch leaves MySQL running. Only explicit `database.sh stop` stops it; stop the applications first. The MySQL volume is preserved. Each application startup provisions and checks its configured schema/account; `database.sh start` provisions both. Accounts have access only to their own schema. The config owns their credentials. Compose is generated under the configured state directory from `rsi.config.json`; there is no separately maintained Compose config. It receives an explicit project/file/context, `/dev/null` as its env file, and child-only interpolation values. Existing container, volume and network ownership are checked before operations. Starting an application never recreates an existing shared MySQL container; changing the database container’s binding requires an intentional infrastructure change.

### Explicit one-time deployment copy

Normal init/start/update commands never copy another project's data. An operator may run:

```sh
node scripts/copy-deployment.mjs /absolute/path/to/source/rsi.config.json source-mysql-container
```

Before copying, explicitly preserve the source deployment encryption key in the target private configuration. The command requires different database services and an empty target deployment database, takes a consistent source snapshot, imports only into the target, compares every table's row count, and records the completed copy. It refuses overwriting an existing target. The private SQL backup and copy record stay under the target state's `database/` directory. A repeated successful copy command makes no changes. Referenced workspace directories retain their existing paths; database isolation does not duplicate those files.

### Verification

```sh
node --test scripts/test/*.test.mjs
```

Lifecycle tests use isolated Git repositories, temporary state and a fake Docker command; frontend host tests use real local HTTP/SSE/binary streams. Application package tests and builds remain under their respective directories.

- [Backend](backend/README.md): TypeScript agent runtime, Pi AI integration, MySQL persistence and API.
- [Frontend](frontend/README.md): React and assistant-ui client.

System contracts and task records live under [docs](docs).
