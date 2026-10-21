# Operations — implementation context

## Result summary

Operations now uses a checkout-specific Compose project and generated, mode-0600 Compose file under durable `RSI_STATE_DIR`, with a named persistent MySQL volume; the legacy `backend/compose.yaml` is not used or modified. The project and volume identity derive from the canonical checkout root, while the chosen loopback port is deterministic from that identity. Development and deployment connect to separate `rsi_agent_dev` and `rsi_agent` databases on this service with distinct encryption keys. Initialization preserves the deployment key and other settings while redirecting its database endpoint to this service; existing legacy database contents are never migrated, dropped or reset. Syntax checks pass. The host tests cannot fully run in this execution environment: temporary directory creation initially failed due to unset `/tmp/claude`, and after using a workspace-owned TMPDIR the frontend test passed while deployment tests encountered process inspection/launch sandbox limitations (`ps EPERM`, child exits). Docker-backed lifecycle and non-interference checks were not run.

## File lookup

| Path | Description |
|---|---|
| `.rsi/context/design/operations/design.md` | Accepted single Operations design: lifecycle, dedicated service, safety and acceptance requirements. |
| `.rsi/context/design/operations/metadata.json` | Implementation mapping for the entire Operations system. |
| `scripts/host-common.mjs` | Shared durable paths, checkout-derived database identity/port, generated Compose config, environment validation, process identity, lifecycle lock, logging/readiness. |
| `scripts/dev.sh`, `scripts/develop.mjs` | Development CLI and backend/Vite lifecycle; starts and provisions the isolated MySQL service without stopping it on app stop. |
| `scripts/deploy.sh`, `scripts/deployment.mjs` | Release build/selection and deployment lifecycle/recovery; deploys against the separate deployment database and retained key. |
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

Syntax checks passed for `scripts/host-common.mjs`, `scripts/database.mjs`, and `scripts/develop.mjs`. Host tests were attempted. First run failed because the harness TMPDIR parent `/tmp/claude` did not exist and could not be created; rerun with `TMPDIR=$HOME/tmp` passed the frontend streaming test but deployment tests exposed sandbox process restrictions (including `ps EPERM` and child service startup exiting). No Docker-backed verification ran. Next: on a Docker-enabled host, initialize alongside a running legacy service and verify its containers/data untouched; inspect generated project/container/volume/port identity; confirm both new DBs initialize empty and independently migrate; run complete deployment recovery, port-conflict, uploads and SSE acceptance tests. No DB reset was run.
