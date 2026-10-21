# Operations — implementation context

## Result summary

Operations now uses a checkout-specific Compose project and generated, mode-0600 Compose file under durable `RSI_STATE_DIR`, with a named persistent MySQL volume; the legacy `backend/compose.yaml` is not used or modified. The project and volume identity derive from the canonical checkout root, while the chosen loopback port is deterministic from that identity. Development and deployment connect to separate `rsi_agent_dev` and `rsi_agent` databases on this service with distinct encryption keys. Initialization preserves the deployment key and other settings while redirecting its database endpoint to this service; existing legacy database contents are never migrated, dropped or reset. Development startup now leaves legacy PID-record processes alone, and deployment reports frontend/backend URLs after deploy and in status. Syntax checks pass; deployment suite has one passing case, while remaining cases are blocked by process sandbox restrictions and child startup failures. Docker-backed lifecycle checks remain unverified. One requested item remains open: consolidation of development/deployment configuration into a single config file needs an agreed path, format, and precedence.

## File lookup

| Path | Description |
|---|---|
| `.rsi/context/design/operations/design.md` | Accepted single Operations design: lifecycle, dedicated service, safety and acceptance requirements. |
| `.rsi/context/design/operations/metadata.json` | Implementation mapping for the entire Operations system. |
| `scripts/host-common.mjs` | Shared durable paths, checkout-derived database identity/port, generated Compose config, environment validation, process identity, lifecycle lock, logging/readiness. |
| `scripts/develop.mjs` | Development lifecycle; no longer terminates legacy PID records at startup and leaves port conflicts untouched. |
| `scripts/deploy.sh`, `scripts/deployment.mjs` | Release build/selection and deployment lifecycle/recovery; deploys against the separate deployment database and retained key. Successful deploy and status output frontend/backend URLs. |
| `scripts/serve-frontend.mjs` | Built asset server and streaming backend proxy. |
| `scripts/database.sh`, `scripts/database.mjs` | Checkout-specific MySQL lifecycle and development provisioning; Compose settings and volume are stored under durable state. |
| `backend/compose.yaml` | Other/legacy Compose configuration; untouched and not passed to operations Compose commands. |
| `scripts/test` | Operations lifecycle tests; limited host tests run, with sandbox-dependent failures noted below. |

## Automatic retrieval

```json
{"commands": []}
```

## Implemented contract

**Inputs:** `scripts/dev.sh` accepts `init`, `start`, `stop`, `restart`, `status`, and `logs [backend|frontend]`. `scripts/deploy.sh` accepts those lifecycle commands plus `deploy <git-ref>` and `update [git-ref]`. `scripts/database.sh` accepts `start`, `stop`, and `status`. Deployment may use `RSI_STATE_DIR`, `XDG_STATE_HOME`, `RSI_DEPLOY_ROOT`, `RSI_DEPLOY_BACKEND_PORT`, and `RSI_DEPLOY_FRONTEND_PORT` as applicable. The checkout root is resolved from `scripts/host-common.mjs`; its SHA-256 prefix identifies the Compose project, named volume and generated Compose config. A deterministic loopback host port in 3307–4306 is derived from the same identity.

**Outputs:** CLIs report status/readiness/logs or fail with nonzero exit status and an error message. `scripts/database.sh status` reports the checkout's MySQL service (not the legacy service). Existing process management checks process identity before signaling; lifecycle mutation locks prevent concurrent operations.

**Effects:** The database lifecycle writes a private generated Compose YAML at `${RSI_STATE_DIR}/compose-<checkout-id>.yaml` (default state `~/.local/state/rsi-agent`) and uses project `rsi-agent-<checkout-id>` with persistent named volume `<project>-mysql-data`. It starts/stops only this project/service. Development and deployment use `rsi_agent_dev` and `rsi_agent` on that service, respectively; development uses account `rsi_dev`, deployment uses `rsi`. `dev start` starts/provisions the service; app stops leave it running. Deployment initialization preserves its encryption key and credentials but changes database URL host/port to this checkout's service, so prior records in the other service are not carried over. Development gets an independent key. No database reset/copy or legacy Compose action occurs.

**Usage:** `scripts/dev.sh start`; `scripts/deploy.sh deploy HEAD`; `scripts/deploy.sh update`; `scripts/database.sh status`; `scripts/database.sh stop` explicitly stops only this checkout's MySQL service.

## Implementation notes

`host-common.mjs` derives database identity from the absolute resolved checkout path and generates a durable Compose config rather than reusing or altering `backend/compose.yaml`. This ensures a moved checkout selects a different project/volume instead of silently attaching to the former identity; users must intentionally retain the old checkout location to resume its service. Port collisions cause Compose startup to fail without taking over the listener. A collision-resistant identity or assigned port is not enforced by a host-level reservation service; verify port availability on target hosts. The database relies on Docker Compose and its stable named volume for persistence. Tests attempted: syntax checks passed; `scripts/test/frontend-host.test.mjs` passed with workspace-owned TMPDIR. Deployment suite attempted but fails in this sandbox due child process inspection/launch restrictions (`ps EPERM`/process exited); Docker was not used, so service isolation and actual database provisioning remain to be verified on a supported host. Legacy child implementation-context entry points were removed after consolidation; this README is the sole Operations implementation context.

## Verification and continuation

`node --check scripts/develop.mjs` and `node --check scripts/deployment.mjs` pass. Development startup no longer cleans up or signals legacy PID records; a conflicting listener is left untouched and startup fails safely at the port check. Successful `deploy` reports frontend and backend URLs, and `status` displays the configured URLs. `scripts/test/deployment.test.mjs`, rerun with a workspace-owned TMPDIR, passes 1/5 cases; remaining failures include process `ps` EPERM, subprocess startup failures, and a lifecycle-lock test environment mismatch. Docker-backed tests remain unverified. The requested shared configuration file remains open pending a decision on path/format and precedence relative to current environment files and environment overrides. Next verify on a supported host that a foreign backend remains running during deploy and exercise URL output. No database reset was run.
