# RSI Agent

## Development and host deployment

Both environments use the same local MySQL 8.4 service, with separate databases:

| | Development | Deployment |
| --- | --- | --- |
| Database | `rsi_agent_dev` (new, initially empty) | `rsi_agent` (existing data) |
| Backend | `http://127.0.0.1:3000` | `http://127.0.0.1:3001` |
| Frontend | `http://127.0.0.1:5273` | `http://127.0.0.1:5274` |
| Source | This project checkout | Committed snapshots under `/tmp/rsi-agent-deploy/` |
| Settings | `rsi.config.json` → `development` | `rsi.config.json` → `deployment` |
| Logs/PIDs | `.run/` | `~/.local/state/rsi-agent/deploy/` |

Requires Node.js 22.19+, npm, Git, tar, curl, ps and Docker Compose. Application processes run directly on the host. MySQL retains the existing `backend` Compose project and data volume.

### First transition from the existing environment

```sh
./scripts/dev.sh stop
./scripts/deploy.sh init
./scripts/deploy.sh deploy HEAD
./scripts/dev.sh start
```

Initialization creates **`rsi.config.json` at this project’s root**. It imports existing `backend/.env` and saved deployment `backend.env` once, preserving database accounts, encryption keys and backend credentials. Old files are left untouched and are not read again once the project config exists. If the old database addresses conflict, initialization refuses to guess. No database is dropped, emptied or copied.

The config contains a single `mysql` host/port, separate `development` and `deployment` database accounts/keys/backend options, service ports, a pinned Docker context, and `paths` for state and temporary release source. Run `init` to generate it; use [rsi.config.example.json](rsi.config.example.json) as a field reference, not as replacement credentials. The real file is mode 0600 and Git-ignored. **Preserve both encryption keys** to keep saved provider credentials readable. Never force-add the real file to Git; deployment refuses revisions containing it.

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

Edit the project `rsi.config.json` to change ports, paths or credentials, then restart the affected service. Each environment accepts optional `"contextCompactionThresholdTokens": 512000` (positive integer). One threshold triggers private Agent compaction before model calls and after work; restart the backend to apply changes. Original group messages remain unabridged. Each environment also accepts `"harnessPermissionsEnabled": true` (default). Set it to `false` to allow every member to use the available tools without file scope/path guards, the Bash sandbox or Git commit approval. Commands then have the backend OS account's ordinary permissions and host HOME/toolchains. Native tool limits/timeouts and separate user member activation remain. Set it back to `true` and restart to restore enforcement. A deployed release must include this feature before the setting can affect it. The former `RSI_STATE_DIR`, `XDG_STATE_HOME`, `RSI_DEPLOY_ROOT` and deployment-port environment overrides are ignored. `paths.deploymentSourceRoot` must stay beneath temporary storage. Default state/log/release-selection paths are retained during migration. The lifecycle lock belongs to this checkout’s `.run/manage.lock`.

### Manage the shared database service

```sh
./scripts/database.sh start
./scripts/database.sh status
./scripts/database.sh stop
```

Application startup can ensure MySQL is running. Stopping either application or a failed application launch leaves MySQL running. Only explicit `database.sh stop` stops it; stop the applications first. The MySQL volume is preserved. Development provisioning creates the `rsi_dev` account with access only to `rsi_agent_dev`; the project config owns its local credentials. Compose receives an explicit project/file/context, `/dev/null` as its env file, and config-derived interpolation values. Starting an application never recreates an existing shared MySQL container; changing the database container’s binding requires an intentional infrastructure change.

### Verification

```sh
node --test scripts/test/*.test.mjs
```

Lifecycle tests use isolated Git repositories, temporary state and a fake Docker command; frontend host tests use real local HTTP/SSE/binary streams. Application package tests and builds remain under their respective directories.

- [Backend](backend/README.md): TypeScript agent runtime, Pi AI integration, MySQL persistence and API.
- [Frontend](frontend/README.md): React and assistant-ui client.

System contracts and task records live under [docs](docs).
