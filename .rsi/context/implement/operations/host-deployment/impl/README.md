# Host deployment lifecycle — implementation context

## Result summary

Deployment is implemented by the shell wrapper `deploy.sh`, orchestrator `deployment.mjs`, shared lifecycle helpers, and `serve-frontend.mjs`. Inspection only; no source edits or tests. The contracts below describe observed behavior; failure/recovery guarantees need targeted verification.

## File lookup

| Path | Description |
|---|---|
| `scripts/deploy.sh` | Directory-independent deployment CLI wrapper. |
| `scripts/deployment.mjs` | Commit export/build, manifest selection and deployment lifecycle. |
| `scripts/host-common.mjs` | Durable paths/env validation, process identity, lock, logging/readiness. |
| `scripts/serve-frontend.mjs` | Built asset server and streaming same-origin backend proxy. |
| `scripts/test/deployment.test.mjs` | Deployment test file (not run). |
| `scripts/test/frontend-host.test.mjs` | Frontend host test file (not run). |

## Automatic retrieval

```json
{"commands": []}
```

## Implemented contract

**Inputs:** `scripts/deploy.sh {init|deploy <git-ref>|update [git-ref]|start|stop|restart|status|logs [backend|frontend]}`. Refs resolve locally with `git rev-parse --verify --end-of-options <ref>^{commit}`. State defaults to XDG state or `~/.local/state/rsi-agent`; temporary release root defaults `/tmp/rsi-agent-deploy`; ports default 3001/5274 and can be set by `RSI_DEPLOY_BACKEND_PORT` and `RSI_DEPLOY_FRONTEND_PORT` (must be distinct valid ports). `RSI_STATE_DIR` and `RSI_DEPLOY_ROOT` override paths.

**Outputs/errors:** Status reports manifest commit/source and managed process PIDs. Logs prints up to 60 lines per selected service. Deploy prints commit, release path and state directory. Errors exit nonzero. Invalid ref is resolved before deployment changes. Build errors remove the incomplete release and occur before stopping current processes.

**Effects:** Build archives the committed tree into a unique directory constrained beneath temp storage, runs `npm ci --include=dev --no-audit --no-fund` and `npm run build` for backend and frontend. Deploy then stops services, launches compiled backend and static host, waits on readiness, and saves active manifest. On launch failure it stops new processes and, if a previous release was running, attempts to relaunch it. Update defaults to HEAD; same-commit update calls start. Start rebuilds missing selected artifacts from the exact selected commit. Stop preserves manifest, settings, logs and MySQL. Deployment reuses durable DB credentials and key.

**Usage:** `scripts/deploy.sh deploy v1.2.3`; `scripts/deploy.sh update`; `scripts/deploy.sh status`; `scripts/deploy.sh logs frontend`.

## Implementation notes

Frontend server serves files from a realpath-checked build root, supports GET/HEAD and SPA fallback for extensionless HTML requests, and streams static files. `/agents`, `/config`, and `/workspaces` paths proxy request and response streams to loopback HTTP; disconnects destroy the upstream request. Other non-GET/HEAD requests get 405. Backend origin must be loopback HTTP. Backend API routing coverage is fixed to those prefixes.

Potential design/code discrepancy: design states healthy `update` to the selected commit keeps process IDs unchanged. The code's `update` calls `start()`, which invokes `launch()`; `startService()` returns without spawning when validated process records match configuration and readiness succeeds, so expected healthy behavior appears implemented but is unverified. In deploy recovery, manifest write failure after successful launch enters recovery path and may relaunch previous code; fault behavior is untested. Database schema rollback is not performed. Test files exist but were not run.

## Verification and continuation

Verify bad builds/ref, occupied ports, process recovery, deleted temporary source rebuild, same-commit PID stability, uploads and long-lived SSE against representative backend endpoints. Inspect selected commit availability and ensure no manual tests mutate user data.
