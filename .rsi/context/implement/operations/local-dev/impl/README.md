# Local development lifecycle — implementation context

## Result summary

Implemented by `dev.sh` delegating to `develop.mjs`, with shared settings, process management, locking and readiness from `host-common.mjs`; database setup uses `database.mjs`. Source was inspected; no source changed and tests were not run. Design/code details requiring follow-up are recorded below.

## File lookup

| Path | Description |
|---|---|
| `scripts/dev.sh` | Directory-independent shell wrapper. |
| `scripts/develop.mjs` | Dev init/start/stop/restart/status/logs orchestration. |
| `scripts/host-common.mjs` | Environment initialization, managed process controls and shared helpers. |
| `scripts/database.mjs` | Starts MySQL and provisions development database/account. |

## Automatic retrieval

```json
{"commands": []}
```

## Implemented contract

**Inputs:** Run `scripts/dev.sh init|start|stop|restart|status|logs [backend|frontend]` from any working directory. Requires Node, Docker Compose, development dependencies and the scripts' external tools. Fixed loopback ports: backend `3000`, Vite `5273`.

**Outputs/errors:** Status prints shared MySQL availability and whether each managed service is running with PID. Logs prints up to 60 lines per selected log. Startup prints readiness URLs. Invalid command, absent dependencies, invalid env, occupied port or readiness failure prints an error and exits nonzero.

**Effects:** Init saves the current legacy `backend/.env` settings as durable deployment settings if needed, then initializes dev env for `rsi_agent_dev` with an independent encryption key. Start checks dependencies, ensures MySQL, provisions dev DB/account, launches backend via `tsx` and Vite, and waits for readiness. Stop targets only validated process records; it does not stop MySQL or deployment. Restart is stop then start. Healthy existing services are reused; mismatched process configuration requires restart.

**Usage:** `scripts/dev.sh init && scripts/dev.sh start`; inspect with `scripts/dev.sh status`; `scripts/dev.sh logs backend`.

## Implementation notes

Backend entry is `backend/src/main.ts` with `--import tsx`; frontend entry is installed Vite. Both are bound to `127.0.0.1`. The backend environment is assembled from process environment plus `.env` values (the latter override). A legacy PID record without config fingerprint is stopped on start for safe transition. If frontend startup fails after this invocation started the backend, that backend is stopped.

`status` reports DB status via Compose and process records; logs do not require services running. Design says initialization transition failure preserves original settings for retry; implementation saves deployment config before writing development config, but this pass did not fault-inject partial-write scenarios. Compose identity and service settings remain to be checked in `backend/compose.yaml`. No scripts/tests executed.

## Verification and continuation

Run targeted local lifecycle acceptance on a disposable/non-production setup, especially occupied-port behavior and repeated init/start/stop while preserving both databases. Do not reset data during verification.
