# RSI Agent

## Development and host deployment

Both environments use the same local MySQL 8.4 service, with separate databases:

| | Development | Deployment |
| --- | --- | --- |
| Database | `rsi_agent_dev` (new, initially empty) | `rsi_agent` (existing data) |
| Backend | `http://127.0.0.1:3000` | `http://127.0.0.1:3001` |
| Frontend | `http://127.0.0.1:5273` | `http://127.0.0.1:5274` |
| Source | This project checkout | Committed snapshots under `/tmp/rsi-agent-deploy/` |
| Settings | `backend/.env` | `~/.local/state/rsi-agent/deploy/backend.env` |
| Logs/PIDs | `.run/` | `~/.local/state/rsi-agent/deploy/` |

Requires Node.js 22.19+, npm, Git, tar, curl, ps and Docker Compose. Application processes run directly on the host. MySQL retains the existing `backend` Compose project and data volume.

### First transition from the existing environment

```sh
./scripts/dev.sh stop
./scripts/deploy.sh init
./scripts/deploy.sh deploy HEAD
./scripts/dev.sh start
```

Initialization preserves the existing `backend/.env` database URL and encryption key in durable deployment settings **before** creating development settings for `rsi_agent_dev` with an independent key. Saved connections, credentials, chats and workspaces stay in the deployment database. Development starts with backend defaults and no application data; repeated starts preserve new development data. No database is dropped, emptied or copied. Keep the deployment encryption key to read existing saved provider credentials.

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

Development uses Vite and the source backend. `init` initializes environment settings without launching applications. A legacy managed development process is stopped before `start` switches it to the development database. Configure development provider connections independently through its UI. Direct backend commands also read the development `backend/.env`.

### Manage deployment

```sh
./scripts/deploy.sh deploy HEAD
./scripts/deploy.sh start
./scripts/deploy.sh restart
./scripts/deploy.sh status
./scripts/deploy.sh logs frontend
./scripts/deploy.sh stop
```

`start` uses the selected commit. If its temporary source was cleaned, it rebuilds that exact commit from local Git. The source/build directories are replaceable; deployment settings, logs, release selection and user workspaces must remain outside them. No automatic boot supervisor or public exposure is configured.

`RSI_STATE_DIR` overrides durable state (otherwise `$XDG_STATE_HOME/rsi-agent` or `~/.local/state/rsi-agent`). `RSI_DEPLOY_ROOT` chooses a subdirectory of `/tmp` or the system temporary directory for source. `RSI_DEPLOY_BACKEND_PORT` and `RSI_DEPLOY_FRONTEND_PORT` override deployment ports. Use consistent overrides across lifecycle commands; changing ports/settings requires restart.

### Manage the shared database service

```sh
./scripts/database.sh start
./scripts/database.sh status
./scripts/database.sh stop
```

Application startup can ensure MySQL is running. Stopping either application or a failed application launch leaves MySQL running. Only explicit `database.sh stop` stops it; stop the applications first. The MySQL volume is preserved. Development provisioning creates the `rsi_dev` account with access only to `rsi_agent_dev`; default local credentials are in `backend/.env.example`.

### Verification

```sh
node --test scripts/test/*.test.mjs
```

Lifecycle tests use isolated Git repositories, temporary state and a fake Docker command; frontend host tests use real local HTTP/SSE/binary streams. Application package tests and builds remain under their respective directories.

- [Backend](backend/README.md): TypeScript agent runtime, Pi AI integration, MySQL persistence and API.
- [Frontend](frontend/README.md): React and assistant-ui client.

System contracts and task records live under [docs](docs/).
