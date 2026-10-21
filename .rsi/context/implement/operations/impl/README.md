# Operations — implementation context

## Result summary

Operations currently consists of Node.js lifecycle CLIs behind Bash entry points, shared environment/process helpers, and a Docker Compose MySQL lifecycle. The scripts inspected include all mapped parent and child implementation files. No source changes were made. Observed open design/code discrepancies are listed below; no project tests were run.

## File lookup

| Path | Description |
|---|---|
| `scripts/host-common.mjs` | Shared state/env validation, safe process identity and lifecycle helpers, lock, logging/readiness. |
| `scripts/dev.sh`, `scripts/develop.mjs` | Development CLI and backend/Vite lifecycle. |
| `scripts/deploy.sh`, `scripts/deployment.mjs` | Release build, selection, deployment lifecycle and recovery. |
| `scripts/serve-frontend.mjs` | Static frontend and streaming loopback proxy. |
| `scripts/database.sh`, `scripts/database.mjs` | Shared MySQL lifecycle and development DB provisioning. |
| `scripts/test/deployment.test.mjs`, `scripts/test/frontend-host.test.mjs` | Existing deployment/frontend-host test files (not run). |
| `backend/compose.yaml` | Compose identity/service/volume referenced by operations scripts (not inspected in this pass). |

## Automatic retrieval

```json
{"commands": []}
```

## Implemented contract

**Inputs:** Invoke `scripts/dev.sh {init|start|stop|restart|status|logs [backend|frontend]}`, `scripts/deploy.sh {init|deploy <git-ref>|update [git-ref]|start|stop|restart|status|logs [backend|frontend]}`, or `scripts/database.sh {start|stop|status}` from any directory. Deployment supports `RSI_STATE_DIR`, `XDG_STATE_HOME`, `RSI_DEPLOY_ROOT`, `RSI_DEPLOY_BACKEND_PORT`, and `RSI_DEPLOY_FRONTEND_PORT` as applicable.

**Outputs/errors:** Commands print service states, selected commit/source, readiness URLs and requested log tails. Errors print a message and exit nonzero; secrets are not intentionally printed. Invalid command/arguments, invalid refs/config, occupied ports and startup failures are errors.

**Effects:** Dev and deploy use separate database URLs and encryption keys, run on distinct loopback ports, and share the Compose MySQL service. Deploy exports committed Git content into a unique temporary release; durable settings, manifest and logs live under the state directory. Explicit database stop stops only the Compose MySQL service, not its volume. No operation here intentionally resets/copies database records or project workspaces.

**Usage:** `scripts/dev.sh start`; `scripts/deploy.sh deploy HEAD`; `scripts/deploy.sh update`; `scripts/database.sh status`.

## Implementation notes / discrepancies

`host-common.mjs` fingerprints managed processes and checks PID start-time plus command marker before signaling. Lifecycle mutations use a durable lock; readiness uses curl with proxy bypass. `initializeEnvironments()` preserves/validates deployment settings then writes development settings. Deployment selection is an atomically renamed `active.json`; builds use `git archive`, npm ci and builds before stopping the old release. Parent design states an active selection is published after readiness; `deploy()` does launch then save manifest, matching that ordering. More thorough failure/concurrency acceptance testing remains open.

The design specifies Node.js 22.19+, but this pass did not verify runtime versions. Compose YAML was referenced but not read; verify exact project, service, port and named-volume identity. Tests were not run. No source was edited.
